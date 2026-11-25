import { TestBed } from '@angular/core/testing';
import { NgxsModule, Store } from '@ngxs/store';
import { Router } from '@angular/router';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AuthState, Login, Logout, RefreshTokenSuccess } from './auth.state';
import { AuthService } from './auth.service';
import { ClientEncryptionService } from '../services/encryption.service';
import { GroupKeyService } from '../services/group-key.service';
import { CryptoSessionManager } from '../services/crypto-session-manager.service';
import { isNativeAuthTransport } from '../platform/auth-transport';

jest.mock('../platform/auth-transport', () => ({
  isNativeAuthTransport: jest.fn(),
}));
const mockIsNative = isNativeAuthTransport as jest.Mock;

/** Same unsigned-JWT construction pattern already used in auth-guards.spec.ts. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

describe('AuthState', () => {
  let store: Store;
  let authService: {
    login: jest.Mock;
    register: jest.Mock;
    logout: jest.Mock;
  };
  let encryptionService: { deriveAndStoreKey: jest.Mock; clearKey: jest.Mock };
  let groupKeyService: {
    getMyAsymmetricKeys: jest.Mock;
    clearPersistentCache: jest.Mock;
  };
  let cryptoSession: { ensureCryptoContext: jest.Mock; beginLogout: jest.Mock };
  let router: { navigate: jest.Mock };

  const accessToken = jwt({ userId: 'user-1', email: 'a@finmate.app' });
  const csrfToken = 'csrf-abc';
  const nativeRefreshToken = 'native-refresh-token-abc';

  function dispatch(action: unknown) {
    return firstValueFrom(store.dispatch(action));
  }

  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  beforeEach(() => {
    authService = {
      // The dual-emit login response may still carry a `refreshToken` body
      // field (for native, this IS the credential; on web it must be ignored).
      login: jest.fn().mockReturnValue(
        of({
          accessToken,
          refreshToken: nativeRefreshToken,
          csrfToken,
        }),
      ),
      register: jest.fn(),
      logout: jest.fn().mockReturnValue(of({})),
    };
    encryptionService = {
      deriveAndStoreKey: jest.fn().mockResolvedValue({ persisted: true }),
      clearKey: jest.fn(),
    };
    groupKeyService = {
      getMyAsymmetricKeys: jest.fn().mockResolvedValue(undefined),
      clearPersistentCache: jest.fn(),
    };
    cryptoSession = {
      ensureCryptoContext: jest.fn().mockResolvedValue(undefined),
      beginLogout: jest.fn(),
    };
    router = { navigate: jest.fn() };

    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([AuthState])],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ClientEncryptionService, useValue: encryptionService },
        { provide: GroupKeyService, useValue: groupKeyService },
        { provide: CryptoSessionManager, useValue: cryptoSession },
        { provide: Router, useValue: router },
      ],
    });

    store = TestBed.inject(Store);
  });

  describe('Web (AU-6 cookie transport)', () => {
    beforeEach(() => mockIsNative.mockReturnValue(false));

    it('starts logged out with no in-memory token', () => {
      expect(store.selectSnapshot(AuthState.getToken)).toBeNull();
      expect(store.selectSnapshot(AuthState.isAuthenticated)).toBe(false);
    });

    describe('Login', () => {
      it('stores the access token and CSRF token in memory, ignoring the body refresh token', async () => {
        await dispatch(
          new Login({ email: 'a@finmate.app', password: 'secret' }),
        );

        expect(store.selectSnapshot(AuthState.getToken)).toBe(accessToken);
        expect(store.selectSnapshot(AuthState.getCsrfToken)).toBe(csrfToken);
        expect(store.selectSnapshot(AuthState.getRefreshToken)).toBeNull();
        expect(store.selectSnapshot(AuthState.isAuthenticated)).toBe(true);
      });

      it('never persists the access or refresh token to localStorage', async () => {
        const setSpy = jest.spyOn(Storage.prototype, 'setItem');

        await dispatch(
          new Login({ email: 'a@finmate.app', password: 'secret' }),
        );

        expect(setSpy).not.toHaveBeenCalledWith(
          'finmate_token',
          expect.anything(),
        );
        expect(setSpy).not.toHaveBeenCalledWith(
          'finmate_refresh_token',
          expect.anything(),
        );
      });

      it('DOES persist the CSRF token to localStorage', async () => {
        const setSpy = jest.spyOn(Storage.prototype, 'setItem');

        await dispatch(
          new Login({ email: 'a@finmate.app', password: 'secret' }),
        );

        expect(setSpy).toHaveBeenCalledWith('finmate_csrf_token', csrfToken);
      });

      it('derives the E2EE key with the submitted password and email', async () => {
        await dispatch(
          new Login({ email: 'a@finmate.app', password: 'secret' }),
        );

        expect(encryptionService.deriveAndStoreKey).toHaveBeenCalledWith(
          'secret',
          'a@finmate.app',
        );
        expect(cryptoSession.ensureCryptoContext).toHaveBeenCalledWith('login');
        expect(groupKeyService.getMyAsymmetricKeys).toHaveBeenCalled();
      });

      it('sets a persistence warning when the key cannot be persisted', async () => {
        encryptionService.deriveAndStoreKey.mockResolvedValue({
          persisted: false,
        });

        await dispatch(
          new Login({ email: 'a@finmate.app', password: 'secret' }),
        );

        expect(store.selectSnapshot(AuthState.getPersistenceWarning)).toMatch(
          /secure key persistence is unavailable/i,
        );
      });
    });

    describe('Logout', () => {
      function loginFirst() {
        return dispatch(
          new Login({ email: 'a@finmate.app', password: 'secret' }),
        );
      }

      it('resets state to logged out', async () => {
        await loginFirst();

        await dispatch(new Logout());

        expect(store.selectSnapshot(AuthState.getToken)).toBeNull();
        expect(store.selectSnapshot(AuthState.getCsrfToken)).toBeNull();
        expect(store.selectSnapshot(AuthState.getUser)).toBeNull();
        expect(store.selectSnapshot(AuthState.isAuthenticated)).toBe(false);
      });

      it('calls the backend logout endpoint with no body token (cookie carries the session)', async () => {
        await loginFirst();

        await dispatch(new Logout());

        expect(authService.logout).toHaveBeenCalledWith();
      });

      it('does not call the backend logout endpoint when there is no access token', async () => {
        await dispatch(new Logout());

        expect(authService.logout).not.toHaveBeenCalled();
      });

      it('removes the persisted CSRF token on logout', async () => {
        await loginFirst();
        const removeSpy = jest.spyOn(Storage.prototype, 'removeItem');

        await dispatch(new Logout());

        expect(removeSpy).toHaveBeenCalledWith('finmate_csrf_token');
      });

      it(
        'clears state and redirects even when the backend logout call fails ' +
          '(client safety must not depend on API success)',
        async () => {
          await loginFirst();
          authService.logout.mockReturnValue(
            throwError(() => new Error('network down')),
          );

          await dispatch(new Logout()).catch(() => undefined);

          expect(store.selectSnapshot(AuthState.getToken)).toBeNull();
          expect(store.selectSnapshot(AuthState.isAuthenticated)).toBe(false);
          expect(router.navigate).toHaveBeenCalledWith(['/auth/login'], {
            replaceUrl: true,
          });
        },
      );

      it('tears down the crypto session and clears cached keys on every logout', async () => {
        await loginFirst();

        await dispatch(new Logout());

        expect(cryptoSession.beginLogout).toHaveBeenCalled();
        expect(encryptionService.clearKey).toHaveBeenCalledWith(
          'a@finmate.app',
        );
        expect(groupKeyService.clearPersistentCache).toHaveBeenCalled();
      });
    });

    describe('RefreshTokenSuccess', () => {
      it('overwrites the access token and CSRF token in memory', async () => {
        const newAccess = jwt({ userId: 'user-1', email: 'a@finmate.app' });

        await dispatch(new RefreshTokenSuccess(newAccess, 'new-csrf'));

        expect(store.selectSnapshot(AuthState.getToken)).toBe(newAccess);
        expect(store.selectSnapshot(AuthState.getCsrfToken)).toBe('new-csrf');
      });

      it('retains the existing CSRF token when the server omits one', async () => {
        await dispatch(
          new Login({ email: 'a@finmate.app', password: 'secret' }),
        );
        const newAccess = jwt({ userId: 'user-1', email: 'a@finmate.app' });

        await dispatch(new RefreshTokenSuccess(newAccess));

        expect(store.selectSnapshot(AuthState.getToken)).toBe(newAccess);
        expect(store.selectSnapshot(AuthState.getCsrfToken)).toBe(csrfToken);
      });

      it('never persists the access token, but DOES persist a newly-rotated CSRF token', async () => {
        const setSpy = jest.spyOn(Storage.prototype, 'setItem');
        const newAccess = jwt({ userId: 'user-1', email: 'a@finmate.app' });

        await dispatch(new RefreshTokenSuccess(newAccess, 'new-csrf'));

        expect(setSpy).not.toHaveBeenCalledWith(
          'finmate_token',
          expect.anything(),
        );
        expect(setSpy).toHaveBeenCalledWith('finmate_csrf_token', 'new-csrf');
      });

      it('does not re-write localStorage when the server omits a new CSRF token', async () => {
        await dispatch(
          new Login({ email: 'a@finmate.app', password: 'secret' }),
        );
        const setSpy = jest.spyOn(Storage.prototype, 'setItem');
        const newAccess = jwt({ userId: 'user-1', email: 'a@finmate.app' });

        await dispatch(new RefreshTokenSuccess(newAccess));

        expect(setSpy).not.toHaveBeenCalledWith(
          'finmate_csrf_token',
          expect.anything(),
        );
      });
    });
  });

  describe('Native (interim pre-AU-6 body/localStorage transport — AU-7/ADR-013)', () => {
    beforeEach(() => mockIsNative.mockReturnValue(true));

    describe('Login', () => {
      it('stores the access token AND refresh token in localStorage and state', async () => {
        await dispatch(
          new Login({ email: 'a@finmate.app', password: 'secret' }),
        );

        expect(localStorage.getItem('finmate_token')).toBe(accessToken);
        expect(localStorage.getItem('finmate_refresh_token')).toBe(
          nativeRefreshToken,
        );
        expect(store.selectSnapshot(AuthState.getToken)).toBe(accessToken);
        expect(store.selectSnapshot(AuthState.getRefreshToken)).toBe(
          nativeRefreshToken,
        );
        expect(store.selectSnapshot(AuthState.isAuthenticated)).toBe(true);
      });

      it('never writes the CSRF storage key (irrelevant to the native transport)', async () => {
        const setSpy = jest.spyOn(Storage.prototype, 'setItem');

        await dispatch(
          new Login({ email: 'a@finmate.app', password: 'secret' }),
        );

        expect(setSpy).not.toHaveBeenCalledWith(
          'finmate_csrf_token',
          expect.anything(),
        );
      });
    });

    describe('Logout', () => {
      function loginFirst() {
        return dispatch(
          new Login({ email: 'a@finmate.app', password: 'secret' }),
        );
      }

      it('clears both tokens from localStorage and resets state', async () => {
        await loginFirst();

        await dispatch(new Logout());

        expect(localStorage.getItem('finmate_token')).toBeNull();
        expect(localStorage.getItem('finmate_refresh_token')).toBeNull();
        expect(store.selectSnapshot(AuthState.getToken)).toBeNull();
        expect(store.selectSnapshot(AuthState.getRefreshToken)).toBeNull();
        expect(store.selectSnapshot(AuthState.isAuthenticated)).toBe(false);
      });

      it('calls the backend logout endpoint WITH the stored refresh token', async () => {
        await loginFirst();

        await dispatch(new Logout());

        expect(authService.logout).toHaveBeenCalledWith(nativeRefreshToken);
      });

      it('does not call the backend logout endpoint when there is no refresh token', async () => {
        await dispatch(new Logout());

        expect(authService.logout).not.toHaveBeenCalled();
      });
    });

    describe('RefreshTokenSuccess', () => {
      it('overwrites both tokens in localStorage and state', async () => {
        const newAccess = jwt({ userId: 'user-1', email: 'a@finmate.app' });

        await dispatch(
          new RefreshTokenSuccess(newAccess, undefined, 'new-native-refresh'),
        );

        expect(localStorage.getItem('finmate_token')).toBe(newAccess);
        expect(localStorage.getItem('finmate_refresh_token')).toBe(
          'new-native-refresh',
        );
        expect(store.selectSnapshot(AuthState.getToken)).toBe(newAccess);
        expect(store.selectSnapshot(AuthState.getRefreshToken)).toBe(
          'new-native-refresh',
        );
      });

      it('retains the existing refresh token when the server omits one', async () => {
        await dispatch(
          new Login({ email: 'a@finmate.app', password: 'secret' }),
        );
        const newAccess = jwt({ userId: 'user-1', email: 'a@finmate.app' });

        await dispatch(new RefreshTokenSuccess(newAccess));

        expect(store.selectSnapshot(AuthState.getToken)).toBe(newAccess);
        expect(store.selectSnapshot(AuthState.getRefreshToken)).toBe(
          nativeRefreshToken,
        );
      });
    });
  });
});

// Note: the one-time, module-init-time `defaults` evaluation inside the
// `@State` decorator (which bootstrap platform the app's first page load
// reads localStorage for) is not covered here — reliably re-triggering a
// decorator evaluation inside Angular's TestBed per-test requires fighting
// its DI/module-init machinery in a way that produced a flaky, not very
// meaningful test. That specific behavior (web never reads localStorage on
// boot, restores only the CSRF token; native restores both tokens) is instead
// exercised for web by the real-browser reload test in
// `frontend-e2e/src/cookie-auth-migration.spec.ts`. The native bootstrap path
// has no equivalent real-device coverage — flagged as unverified.
