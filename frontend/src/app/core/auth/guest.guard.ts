import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { Store } from '@ngxs/store';
import { map } from 'rxjs/operators';
import { AuthState } from './auth.state';
import { isTokenValid } from './token.util';
import { TokenRefreshService } from './token-refresh.service';

/**
 * Guards the auth screens (login/register/forgot-password/reset-password). An
 * already-authenticated user must never see the Login screen — send them to
 * the dashboard instead. Uses {@link TokenRefreshService.trySilentRefresh},
 * never the Logout-dispatching `refresh()` — a failed silent refresh here just
 * means "show the auth screen," never a Logout-driven redirect that would
 * otherwise bounce an anonymous visitor away from e.g. `/auth/register`.
 */
export const guestGuard: CanActivateFn = () => {
  const store = inject(Store);
  const router = inject(Router);
  const tokenRefresh = inject(TokenRefreshService);

  const accessToken = store.selectSnapshot(AuthState.getToken);
  if (isTokenValid(accessToken)) {
    return router.createUrlTree(['/dashboard']);
  }

  return tokenRefresh
    .trySilentRefresh()
    .pipe(map((ok) => (ok ? router.createUrlTree(['/dashboard']) : true)));
};
