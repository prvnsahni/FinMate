import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { Store } from '@ngxs/store';
import { map } from 'rxjs/operators';
import { AuthState } from './auth.state';
import { isTokenValid } from './token.util';
import { TokenRefreshService } from './token-refresh.service';

/**
 * Guards every protected route. Access is allowed when the in-memory access
 * token is still valid. Otherwise (most commonly: a fresh page load, since
 * AU-6 keeps the access token in memory only and it does not survive a
 * reload) one silent, cookie-based refresh is attempted before concluding
 * there is no session — mirroring what the HTTP interceptor would otherwise
 * discover on the first request, just done proactively so no protected
 * screen flashes before a redirect.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const store = inject(Store);
  const router = inject(Router);
  const tokenRefresh = inject(TokenRefreshService);

  const accessToken = store.selectSnapshot(AuthState.getToken);
  if (isTokenValid(accessToken)) {
    return true;
  }

  return tokenRefresh.trySilentRefresh().pipe(
    map((ok) =>
      ok
        ? true
        : router.createUrlTree(['/auth/login'], {
            queryParams: { returnUrl: state.url },
          }),
    ),
  );
};
