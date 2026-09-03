import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { REFRESH_COOKIE, CSRF_COOKIE } from './auth-transport.util';

/**
 * BATCH-06 auth transport matrix. Exercises the REAL controller with a mocked
 * AuthService (token/session semantics unchanged) and a mocked FeatureFlagsService
 * to drive the `auth.dualTransport` gate. Verifies: legacy body transport is
 * untouched when the flag is OFF; the cookie/CSRF transport + dual-emit behaves
 * per the frozen AU-2a contract when the flag is ON.
 */
describe('AuthController transport (W-AUTH)', () => {
  const user = { id: 'user-1', email: 'u@example.com' };
  let authService: {
    login: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
  };
  let flags: { isEnabled: jest.Mock };
  let controller: AuthController;

  const makeRes = () => ({ cookie: jest.fn(), clearCookie: jest.fn() });
  const makeReq = (headers: Record<string, string> = {}) =>
    ({
      headers,
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      user,
    }) as any;

  beforeEach(() => {
    authService = {
      login: jest
        .fn()
        .mockResolvedValue({ accessToken: 'A', refreshToken: 'R', user }),
      refresh: jest
        .fn()
        .mockResolvedValue({ accessToken: 'A2', refreshToken: 'R2' }),
      logout: jest.fn().mockResolvedValue(undefined),
    };
    flags = { isEnabled: jest.fn().mockReturnValue(false) };
    controller = new AuthController(authService as any, flags as any);
  });

  describe('flag OFF — legacy body transport unchanged', () => {
    it('login returns body tokens and sets NO cookies', async () => {
      const res = makeRes();
      const out = await controller.login(
        { email: 'u@example.com', password: 'p' } as any,
        makeReq(),
        res as any,
      );
      expect(res.cookie).not.toHaveBeenCalled();
      expect(out.data).toEqual({ accessToken: 'A', refreshToken: 'R', user });
      expect(out.data).not.toHaveProperty('csrfToken');
    });

    it('refresh with a body token returns both tokens in the body', async () => {
      const res = makeRes();
      const out = await controller.refresh(
        { refreshToken: 'R' } as any,
        makeReq(),
        res as any,
      );
      expect(authService.refresh).toHaveBeenCalledWith('R');
      expect(res.cookie).not.toHaveBeenCalled();
      expect(out.data).toEqual({ accessToken: 'A2', refreshToken: 'R2' });
    });

    it('refresh without a body token is rejected (legacy 400)', async () => {
      await expect(
        controller.refresh({} as any, makeReq(), makeRes() as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('logout uses the body token and clears no cookies', async () => {
      const res = makeRes();
      await controller.logout(
        { refreshToken: 'R' } as any,
        makeReq(),
        res as any,
      );
      expect(authService.logout).toHaveBeenCalledWith('R', 'user-1');
      expect(res.clearCookie).not.toHaveBeenCalled();
    });
  });

  describe('flag ON — cookie + CSRF transport (dual-emit)', () => {
    beforeEach(() => flags.isEnabled.mockReturnValue(true));

    it('login sets a host-only HttpOnly refresh cookie + CSRF cookie and dual-emits', async () => {
      const res = makeRes();
      const out = await controller.login(
        { email: 'u@example.com', password: 'p' } as any,
        makeReq(),
        res as any,
      );

      const refreshCall = res.cookie.mock.calls.find(
        (c) => c[0] === REFRESH_COOKIE,
      );
      const csrfCall = res.cookie.mock.calls.find((c) => c[0] === CSRF_COOKIE);
      expect(refreshCall).toBeDefined();
      expect(refreshCall[1]).toBe('R'); // the refresh token value
      expect(refreshCall[2]).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/api/v1/auth/refresh',
      });
      expect(refreshCall[2]).not.toHaveProperty('domain'); // host-only
      expect(csrfCall[2]).toMatchObject({
        path: '/api/v1/auth',
        httpOnly: true,
      });

      // dual-emit: body still carries the refresh token for legacy clients,
      // plus the CSRF token for the new web client to echo.
      const data = out.data as Record<string, unknown>;
      expect(data.refreshToken).toBe('R');
      expect(data.csrfToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('refresh via cookie with a valid CSRF token rotates and returns NO refresh token in the body', async () => {
      const res = makeRes();
      const req = makeReq({
        cookie: `${REFRESH_COOKIE}=CTOK; ${CSRF_COOKIE}=CS`,
        'x-csrf-token': 'CS',
      });
      const out = await controller.refresh({} as any, req, res as any);

      expect(authService.refresh).toHaveBeenCalledWith('CTOK');
      expect(res.cookie).toHaveBeenCalledTimes(2); // rotated refresh + csrf
      const data = out.data as Record<string, unknown>;
      expect(data.accessToken).toBe('A2');
      expect(data.csrfToken).toMatch(/^[0-9a-f]{64}$/);
      expect(data).not.toHaveProperty('refreshToken'); // target: not in body
    });

    it('refresh via cookie with a MISSING CSRF header is forbidden', async () => {
      const req = makeReq({
        cookie: `${REFRESH_COOKIE}=CTOK; ${CSRF_COOKIE}=CS`,
      });
      await expect(
        controller.refresh({} as any, req, makeRes() as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('refresh via cookie with an INVALID CSRF header is forbidden', async () => {
      const req = makeReq({
        cookie: `${REFRESH_COOKIE}=CTOK; ${CSRF_COOKIE}=CS`,
        'x-csrf-token': 'WRONG',
      });
      await expect(
        controller.refresh({} as any, req, makeRes() as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refresh rejects conflicting cookie + body tokens (no silent success)', async () => {
      const req = makeReq({
        cookie: `${REFRESH_COOKIE}=CTOK; ${CSRF_COOKIE}=CS`,
        'x-csrf-token': 'CS',
      });
      await expect(
        controller.refresh(
          { refreshToken: 'DIFFERENT' } as any,
          req,
          makeRes() as any,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refresh with no cookie falls back to the legacy body path', async () => {
      const res = makeRes();
      const out = await controller.refresh(
        { refreshToken: 'R' } as any,
        makeReq(),
        res as any,
      );
      expect(authService.refresh).toHaveBeenCalledWith('R');
      expect(out.data).toEqual({ accessToken: 'A2', refreshToken: 'R2' });
    });

    it('logout reads the cookie token and clears both transport cookies', async () => {
      const res = makeRes();
      const req = makeReq({
        cookie: `${REFRESH_COOKIE}=CTOK; ${CSRF_COOKIE}=CS`,
      });
      await controller.logout({} as any, req, res as any);
      expect(authService.logout).toHaveBeenCalledWith('CTOK', 'user-1');
      expect(res.clearCookie).toHaveBeenCalledTimes(2);
    });
  });
});
