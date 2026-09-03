import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { appRoutes } from './app.routes';
import { optimisticLockInterceptor } from './core/interceptors/optimistic-lock.interceptor';
import { jwtInterceptor } from './core/interceptors/jwt.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { recoveryRequiredInterceptor } from './core/interceptors/recovery-required.interceptor';
import { responseInterceptor } from './core/interceptors/response.interceptor';
import { provideStore } from '@ngxs/store';
import { withNgxsReduxDevtoolsPlugin } from '@ngxs/devtools-plugin';
import { withNgxsLoggerPlugin } from '@ngxs/logger-plugin';
import { AuthState } from './core/auth/auth.state';
import { RecurringExpensesState } from './core/recurring-expenses/recurring-expenses.state';
import { environment } from '../environments/environment';
import { CRYPTO_UNLOCK_PROVIDERS } from './core/services/crypto-unlock-provider';
import { PasswordUnlockProvider } from './core/services/password-unlock-provider.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideHttpClient(
      withInterceptors([
        responseInterceptor,
        jwtInterceptor,
        optimisticLockInterceptor,
        recoveryRequiredInterceptor,
        errorInterceptor,
      ]),
    ),
    provideStore(
      [AuthState, RecurringExpensesState], // Register AuthState and RecurringExpensesState
      ...(environment.production
        ? []
        : [withNgxsReduxDevtoolsPlugin(), withNgxsLoggerPlugin()]),
    ),
    // Extension point for future unlock methods (PIN, biometric): register
    // another CRYPTO_UNLOCK_PROVIDERS entry here, no panel changes needed.
    {
      provide: CRYPTO_UNLOCK_PROVIDERS,
      useClass: PasswordUnlockProvider,
      multi: true,
    },
  ],
};
