import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { Store } from '@ngxs/store';
import { firstValueFrom, of } from 'rxjs';
import { authGuard } from './auth.guard';
import { guestGuard } from './guest.guard';
import { AuthState } from './auth.state';
import { TokenRefreshService } from './token-refresh.service';

function jwt(expOffsetSeconds: number): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ exp: Math.floor(Date.now() / 1000) + expOffsetSeconds })}.sig`;
}
const validJwt = () => jwt(600);
const expiredJwt = () => jwt(-10);

describe('auth route guards', () => {
  let selectSnapshot: jest.Mock;
  let createUrlTree: jest.Mock;
  let trySilentRefresh: jest.Mock;

  /**
   * AU-6: the access token lives in memory only, so a fresh page load has no
   * client-visible refresh token to fall back on — the guards instead attempt
   * one silent, cookie-based refresh. `silentRefreshOk` simulates whether that
   * cookie-backed attempt succeeds.
   */
  function configure(access: string | null, silentRefreshOk: boolean) {
    selectSnapshot = jest.fn((selector: unknown) => {
      if (selector === AuthState.getToken) return access;
      return null;
    });
    createUrlTree = jest.fn(
      (commands: unknown[], extras?: unknown) =>
        ({ __urlTree: commands, __extras: extras }) as unknown as UrlTree,
    );
    trySilentRefresh = jest.fn(() => of(silentRefreshOk));
    TestBed.configureTestingModule({
      providers: [
        { provide: Store, useValue: { selectSnapshot } },
        { provide: Router, useValue: { createUrlTree } },
        { provide: TokenRefreshService, useValue: { trySilentRefresh } },
      ],
    });
  }

  const routeStub = {} as any;
  const stateStub = { url: '/groups/123' } as any;

  /** Normalizes a guard's sync (fast-path) or Observable (silent-refresh) result into a Promise. */
  async function run(guard: typeof authGuard) {
    const result = TestBed.runInInjectionContext(() =>
      guard(routeStub, stateStub),
    );
    if (result && typeof (result as any).subscribe === 'function') {
      return firstValueFrom(result as any);
    }
    return result;
  }

  describe('authGuard', () => {
    it('allows access synchronously with a valid access token (no refresh attempt)', async () => {
      configure(validJwt(), true);
      expect(await run(authGuard)).toBe(true);
      expect(trySilentRefresh).not.toHaveBeenCalled();
    });

    it('attempts a silent cookie-based refresh when there is no valid access token, and allows access on success', async () => {
      configure(null, true);
      expect(await run(authGuard)).toBe(true);
      expect(trySilentRefresh).toHaveBeenCalled();
    });

    it('allows access when the access token is expired but a silent refresh succeeds', async () => {
      configure(expiredJwt(), true);
      expect(await run(authGuard)).toBe(true);
    });

    it('redirects to /auth/login (with returnUrl) when the silent refresh fails', async () => {
      configure(null, false);
      const result = (await run(authGuard)) as any;
      expect(result.__urlTree).toEqual(['/auth/login']);
      expect(createUrlTree).toHaveBeenCalledWith(['/auth/login'], {
        queryParams: { returnUrl: '/groups/123' },
      });
    });
  });

  describe('guestGuard', () => {
    it('redirects an authenticated user to /dashboard synchronously (no refresh attempt)', async () => {
      configure(validJwt(), true);
      const result = (await run(guestGuard)) as any;
      expect(result.__urlTree).toEqual(['/dashboard']);
      expect(trySilentRefresh).not.toHaveBeenCalled();
    });

    it('redirects to /dashboard when a silent refresh succeeds', async () => {
      configure(null, true);
      const result = (await run(guestGuard)) as any;
      expect(result.__urlTree).toEqual(['/dashboard']);
    });

    it('allows an unauthenticated user to see the auth screen when the silent refresh fails (never a Logout-driven redirect)', async () => {
      configure(null, false);
      expect(await run(guestGuard)).toBe(true);
    });
  });
});
