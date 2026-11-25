import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { Observable, of, throwError } from 'rxjs';
import { catchError, finalize, map, shareReplay, tap } from 'rxjs/operators';
import { RefreshTokenResponse } from '@finmate/data-models';
import { AuthService } from './auth.service';
import { AuthState, Logout, RefreshTokenSuccess } from './auth.state';
import { isTokenValid } from './token.util';
import { isNativeAuthTransport } from '../platform/auth-transport';

/**
 * Single-flight access-token refresh.
 *
 * Web (AU-6): the refresh token itself is not visible to the frontend at all
 * — it lives only in the HttpOnly cookie. There is nothing to validate
 * client-side before calling the backend; every refresh attempt just sends
 * the cookie (automatically attached by the browser, see `jwtInterceptor`)
 * plus the in-memory CSRF token, and the backend is the only one that can say
 * whether a session actually exists.
 *
 * Native (interim pre-AU-6 scheme — see `isNativeAuthTransport`): the refresh
 * token IS client-visible (stored in `AuthState`/`localStorage`, mirroring the
 * behavior from before the AU-6 cookie migration), so the same client-side
 * validity pre-check this service always used is restored for that path —
 * `AU-7`/`ADR-013`: a Capacitor WebView's origin is cross-site from the real
 * API host, so the `SameSite=Lax` web cookie is never sent to it, and native
 * keeps this scheme until the native header transport ships.
 *
 * The backend rotates the refresh token on every `/auth/refresh` call (the old
 * one is revoked). Without coordination, concurrent callers — common on app
 * start-up when several requests fire at once, or a route guard's silent
 * refresh racing an interceptor's reactive refresh — would each call refresh
 * against the same token/cookie; the first rotates it away and the rest would
 * fail with a stale-token error. `inFlight$` shares one request across every
 * caller, including both public methods below.
 */
@Injectable({ providedIn: 'root' })
export class TokenRefreshService {
  private readonly authService = inject(AuthService);
  private readonly store = inject(Store);
  private inFlight$: Observable<string> | null = null;
  // `refresh()`'s catchError below runs once per *subscriber* to the shared,
  // replayed `inFlight$` — without this guard a failed cycle with N concurrent
  // `refresh()` callers would dispatch Logout N times. Reset per cycle.
  private loggedOutForCurrentCycle = false;

  private startRefresh(): Observable<string> {
    if (this.inFlight$) {
      return this.inFlight$;
    }

    this.loggedOutForCurrentCycle = false;

    if (isNativeAuthTransport()) {
      const refreshToken = this.store.selectSnapshot(AuthState.getRefreshToken);
      if (!isTokenValid(refreshToken)) {
        // No valid refresh token to even attempt a call with — unambiguous,
        // same as a 401 from the server (restores the pre-AU-6 short-circuit
        // that avoided a pointless network call).
        this.inFlight$ = throwError(
          () =>
            new HttpErrorResponse({
              status: 401,
              statusText: 'No valid refresh token',
            }),
        ).pipe(
          finalize(() => {
            this.inFlight$ = null;
          }),
          shareReplay(1),
        );
        return this.inFlight$;
      }

      this.inFlight$ = this.authService
        .refresh({ refreshToken: refreshToken as string })
        .pipe(
          tap((res: RefreshTokenResponse) =>
            this.store.dispatch(
              new RefreshTokenSuccess(
                res.accessToken,
                undefined,
                res.refreshToken,
              ),
            ),
          ),
          map((res: RefreshTokenResponse) => res.accessToken),
          finalize(() => {
            this.inFlight$ = null;
          }),
          shareReplay(1),
        );
      return this.inFlight$;
    }

    const csrfToken = this.store.selectSnapshot(AuthState.getCsrfToken);
    this.inFlight$ = this.authService.refresh({ csrfToken }).pipe(
      tap((res: RefreshTokenResponse) =>
        this.store.dispatch(
          new RefreshTokenSuccess(res.accessToken, res.csrfToken),
        ),
      ),
      map((res: RefreshTokenResponse) => res.accessToken),
      finalize(() => {
        this.inFlight$ = null;
      }),
      shareReplay(1),
    );

    return this.inFlight$;
  }

  /**
   * Used by the HTTP interceptor's reactive 401-retry path: a failure here
   * means a session that was believed valid just turned out not to be, so it
   * is correct to log out and redirect — exactly once per failed cycle, no
   * matter how many concurrent callers share it.
   *
   * P1 fix: only a `401`/`403` from the refresh call itself means the session
   * is genuinely gone — that is the only case that logs out. A network error,
   * timeout, or `5xx` means the *server couldn't be reached or is having
   * trouble*, not that the session is invalid; logging out on those would
   * strand a user on a flaky connection for no reason. Those errors are
   * propagated to the caller (the original request fails this one time) and
   * the next request's 401 will simply retry the refresh.
   */
  refresh(): Observable<string> {
    return this.startRefresh().pipe(
      catchError((err) => {
        const isAuthFailure =
          err instanceof HttpErrorResponse &&
          (err.status === 401 || err.status === 403);
        if (isAuthFailure && !this.loggedOutForCurrentCycle) {
          this.loggedOutForCurrentCycle = true;
          this.store.dispatch(new Logout());
        }
        return throwError(() => err);
      }),
    );
  }

  /**
   * Used by the route guards on a fresh page load to silently re-establish a
   * session (from the refresh cookie on web, or the stored refresh token on
   * native), if one exists. Never throws and never dispatches `Logout` — a
   * failure here just means "no session," which for an anonymous visitor
   * (e.g. navigating straight to `/auth/register`) must not trigger a
   * Logout-driven redirect to `/auth/login`.
   */
  trySilentRefresh(): Observable<boolean> {
    return this.startRefresh().pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }
}
