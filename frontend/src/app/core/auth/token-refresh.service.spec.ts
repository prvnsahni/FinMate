import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Subject } from 'rxjs';
import { RefreshTokenResponse } from '@finmate/data-models';
import { TokenRefreshService } from './token-refresh.service';
import { AuthService } from './auth.service';
import { AuthState, Logout, RefreshTokenSuccess } from './auth.state';
import { isNativeAuthTransport } from '../platform/auth-transport';

jest.mock('../platform/auth-transport', () => ({
  isNativeAuthTransport: jest.fn(),
}));
const mockIsNative = isNativeAuthTransport as jest.Mock;

function jwt(expOffsetSeconds: number): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ exp: Math.floor(Date.now() / 1000) + expOffsetSeconds })}.sig`;
}

describe('TokenRefreshService', () => {
  let service: TokenRefreshService;
  let refresh$: Subject<RefreshTokenResponse>;
  let authService: { refresh: jest.Mock };
  let store: { dispatch: jest.Mock; selectSnapshot: jest.Mock };

  function setup(selectorMap: Record<string, unknown> = {}) {
    refresh$ = new Subject<RefreshTokenResponse>();
    authService = { refresh: jest.fn(() => refresh$.asObservable()) };
    store = {
      dispatch: jest.fn(),
      selectSnapshot: jest.fn((selector: unknown) => {
        if (selector === AuthState.getCsrfToken) {
          return selectorMap['csrf'] ?? 'csrf-abc';
        }
        if (selector === AuthState.getRefreshToken) {
          return selectorMap['refreshToken'] ?? null;
        }
        return null;
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        TokenRefreshService,
        { provide: AuthService, useValue: authService },
        { provide: Store, useValue: store },
      ],
    });
    service = TestBed.inject(TokenRefreshService);
  }

  describe('web (AU-6 cookie transport)', () => {
    beforeEach(() => {
      mockIsNative.mockReturnValue(false);
      setup();
    });

    describe('refresh() — used by the HTTP interceptor', () => {
      it('sends the in-memory CSRF token and no body token (the cookie carries the refresh token)', () => {
        service.refresh().subscribe();

        expect(authService.refresh).toHaveBeenCalledWith({
          csrfToken: 'csrf-abc',
        });
      });

      it('shares a single refresh request across concurrent callers (no logout storm)', () => {
        const results: string[] = [];
        service.refresh().subscribe((t) => results.push(t));
        service.refresh().subscribe((t) => results.push(t));
        service.refresh().subscribe((t) => results.push(t));

        expect(authService.refresh).toHaveBeenCalledTimes(1);

        refresh$.next({ accessToken: 'new-access', csrfToken: 'new-csrf' });
        refresh$.complete();

        expect(results).toEqual(['new-access', 'new-access', 'new-access']);
        expect(store.dispatch).toHaveBeenCalledWith(
          new RefreshTokenSuccess('new-access', 'new-csrf'),
        );
        expect(store.dispatch).not.toHaveBeenCalledWith(expect.any(Logout));
      });

      it('starts a fresh refresh after the previous one completes', () => {
        service.refresh().subscribe();
        refresh$.next({ accessToken: 'a1', csrfToken: 'c1' });
        refresh$.complete();

        refresh$ = new Subject<RefreshTokenResponse>();
        authService.refresh.mockReturnValue(refresh$.asObservable());
        service.refresh().subscribe();
        expect(authService.refresh).toHaveBeenCalledTimes(2);
      });
    });

    describe('trySilentRefresh() — used by the route guards', () => {
      it('resolves true and dispatches RefreshTokenSuccess on success', async () => {
        const resultPromise = new Promise<boolean>((resolve) =>
          service.trySilentRefresh().subscribe(resolve),
        );

        refresh$.next({ accessToken: 'new-access', csrfToken: 'new-csrf' });
        refresh$.complete();

        expect(await resultPromise).toBe(true);
        expect(store.dispatch).toHaveBeenCalledWith(
          new RefreshTokenSuccess('new-access', 'new-csrf'),
        );
      });

      it('resolves false and never dispatches Logout on failure', async () => {
        const resultPromise = new Promise<boolean>((resolve) =>
          service.trySilentRefresh().subscribe(resolve),
        );

        refresh$.error(
          new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' }),
        );

        expect(await resultPromise).toBe(false);
        expect(store.dispatch).not.toHaveBeenCalledWith(expect.any(Logout));
      });

      it('shares the in-flight request with refresh() to avoid a rotation race', () => {
        service.trySilentRefresh().subscribe();
        service.refresh().subscribe();

        expect(authService.refresh).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('native (interim pre-AU-6 body/localStorage transport — AU-7/ADR-013)', () => {
    beforeEach(() => mockIsNative.mockReturnValue(true));

    it('sends the stored refresh token in the body, no CSRF header', () => {
      setup({ refreshToken: jwt(600) });

      service.refresh().subscribe();

      expect(authService.refresh).toHaveBeenCalledWith({
        refreshToken: expect.any(String),
      });
    });

    it('dispatches RefreshTokenSuccess with the rotated native refresh token', () => {
      setup({ refreshToken: jwt(600) });

      service.refresh().subscribe();
      refresh$.next({
        accessToken: 'new-access',
        refreshToken: 'new-native-refresh',
      });
      refresh$.complete();

      expect(store.dispatch).toHaveBeenCalledWith(
        new RefreshTokenSuccess('new-access', undefined, 'new-native-refresh'),
      );
    });

    it('short-circuits (no network call) and fails like a 401 when there is no valid stored refresh token', (done) => {
      setup({ refreshToken: null });

      service.refresh().subscribe({
        error: (err) => {
          expect(authService.refresh).not.toHaveBeenCalled();
          expect(err).toBeInstanceOf(HttpErrorResponse);
          expect(err.status).toBe(401);
          expect(store.dispatch).toHaveBeenCalledWith(expect.any(Logout));
          done();
        },
      });
    });

    it('short-circuits the same way for an expired stored refresh token', (done) => {
      setup({ refreshToken: jwt(-10) });

      service.refresh().subscribe({
        error: (err) => {
          expect(authService.refresh).not.toHaveBeenCalled();
          expect(err.status).toBe(401);
          done();
        },
      });
    });
  });

  describe('P1 — refresh-failure handling logs out only on a genuine auth failure', () => {
    beforeEach(() => {
      mockIsNative.mockReturnValue(false);
      setup();
    });

    it('logs out (once) on a 401 from the refresh call', () => {
      const errors: unknown[] = [];
      service.refresh().subscribe({ error: (e) => errors.push(e) });
      service.refresh().subscribe({ error: (e) => errors.push(e) });

      refresh$.error(
        new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' }),
      );

      expect(errors).toHaveLength(2);
      const logoutDispatches = store.dispatch.mock.calls.filter(
        (c) => c[0] instanceof Logout,
      );
      expect(logoutDispatches).toHaveLength(1);
    });

    it('logs out on a 403 from the refresh call (CSRF/forbidden)', () => {
      let error: unknown;
      service.refresh().subscribe({ error: (e) => (error = e) });

      refresh$.error(
        new HttpErrorResponse({ status: 403, statusText: 'Forbidden' }),
      );

      expect(error).toBeInstanceOf(HttpErrorResponse);
      expect(store.dispatch).toHaveBeenCalledWith(expect.any(Logout));
    });

    it.each([
      ['a network error (status 0)', 0],
      ['a request timeout', 0],
      ['a 500 server error', 500],
      ['a 503 service-unavailable error', 503],
    ])(
      'does NOT log out on %s — fails this request only, session is preserved',
      (_label, status) => {
        let error: unknown;
        service.refresh().subscribe({ error: (e) => (error = e) });

        refresh$.error(new HttpErrorResponse({ status, statusText: 'x' }));

        expect(error).toBeInstanceOf(HttpErrorResponse);
        expect(store.dispatch).not.toHaveBeenCalledWith(expect.any(Logout));
      },
    );

    it('a non-HttpErrorResponse error (e.g. a thrown JS error) does not log out either', () => {
      let error: unknown;
      service.refresh().subscribe({ error: (e) => (error = e) });

      refresh$.error(new Error('unexpected client-side failure'));

      expect(error).toBeInstanceOf(Error);
      expect(store.dispatch).not.toHaveBeenCalledWith(expect.any(Logout));
    });

    it('still shares a single in-flight refresh across a concurrent burst even when it ultimately 401s (logs out exactly once)', () => {
      const errors: unknown[] = [];
      for (let i = 0; i < 5; i++) {
        service.refresh().subscribe({ error: (e) => errors.push(e) });
      }

      expect(authService.refresh).toHaveBeenCalledTimes(1);

      refresh$.error(
        new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' }),
      );

      expect(errors).toHaveLength(5);
      const logoutDispatches = store.dispatch.mock.calls.filter(
        (c) => c[0] instanceof Logout,
      );
      expect(logoutDispatches).toHaveLength(1);
    });

    it('a burst that fails with a network error shares one request and triggers no logout at all', () => {
      const errors: unknown[] = [];
      for (let i = 0; i < 5; i++) {
        service.refresh().subscribe({ error: (e) => errors.push(e) });
      }

      refresh$.error(new HttpErrorResponse({ status: 0, statusText: 'x' }));

      expect(errors).toHaveLength(5);
      expect(store.dispatch).not.toHaveBeenCalledWith(expect.any(Logout));
    });

    it('a subsequent refresh cycle after a network-error failure can still succeed normally', () => {
      service.refresh().subscribe({ error: () => undefined });
      refresh$.error(new HttpErrorResponse({ status: 0, statusText: 'x' }));

      refresh$ = new Subject<RefreshTokenResponse>();
      authService.refresh.mockReturnValue(refresh$.asObservable());

      let result: string | undefined;
      service.refresh().subscribe((t) => (result = t));
      refresh$.next({ accessToken: 'recovered-access', csrfToken: 'c2' });
      refresh$.complete();

      expect(result).toBe('recovered-access');
      expect(store.dispatch).not.toHaveBeenCalledWith(expect.any(Logout));
    });
  });
});
