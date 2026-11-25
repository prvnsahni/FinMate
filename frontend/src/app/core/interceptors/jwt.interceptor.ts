import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { catchError, switchMap, throwError } from 'rxjs';
import { TokenRefreshService } from '../auth/token-refresh.service';
import { AuthState } from '../auth/auth.state';
import { isNativeAuthTransport } from '../platform/auth-transport';

/**
 * Attaches the access token to outgoing requests and transparently recovers
 * from an expired one: on a 401 (other than the auth endpoints themselves) it
 * asks {@link TokenRefreshService} for a fresh token — a single shared refresh
 * across all concurrent 401s — then retries the original request. If the
 * refresh fails, that service clears the session and redirects to Login, so
 * here we simply propagate the error.
 *
 * Web (AU-6): the access token is read from in-memory state, never
 * `localStorage`. Every request carries `withCredentials: true` so the
 * browser attaches the HttpOnly refresh/CSRF cookies on auth calls — a no-op
 * elsewhere, since those cookies are path-scoped to `/api/v1/auth*` only.
 *
 * Native (interim pre-AU-6 scheme — see `isNativeAuthTransport`): byte-for-byte
 * the original behavior — the access token still comes from `AuthState` (which
 * now mirrors `localStorage` on native, see `auth.state.ts`), but
 * `withCredentials` is never set, since native has no cookie to send and the
 * pre-AU-6 behavior never set it either (`AU-7`/`ADR-013`: cookies don't work
 * reliably in a Capacitor WebView, so native doesn't rely on them at all).
 */
export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const tokenRefresh = inject(TokenRefreshService);
  const store = inject(Store);
  const token = store.selectSnapshot(AuthState.getToken);
  const useCredentials = !isNativeAuthTransport();

  const authReq = req.clone({
    ...(token ? { setHeaders: { Authorization: `Bearer ${token}` } } : {}),
    ...(useCredentials ? { withCredentials: true } : {}),
  });

  return next(authReq).pipe(
    catchError((error) => {
      const isAuthEndpoint =
        req.url.includes('/auth/login') ||
        req.url.includes('/auth/register') ||
        req.url.includes('/auth/refresh');

      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !isAuthEndpoint
      ) {
        return tokenRefresh.refresh().pipe(
          switchMap((accessToken) =>
            next(
              req.clone({
                setHeaders: { Authorization: `Bearer ${accessToken}` },
                ...(useCredentials ? { withCredentials: true } : {}),
              }),
            ),
          ),
        );
      }

      return throwError(() => error);
    }),
  );
};
