import { TestBed } from '@angular/core/testing';
import { NgxsModule, Store } from '@ngxs/store';
import { Router } from '@angular/router';
import { firstValueFrom, of, throwError } from 'rxjs';
import {
  AuthState,
  Login,
  Logout,
  RefreshTokenSuccess,
} from './auth.state';
import { AuthService } from './auth.service';
import { ClientEncryptionService } from '../services/encryption.service';
import { GroupKeyService } from '../services/group-key.service';
import { CryptoSessionManager } from '../services/crypto-session-manager.service';

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
  const refreshToken = 'refresh-token-abc';

  function dispatch(action: unknown) {
    return firstValueFrom(store.dispatch(action));
  }

  beforeEach(() => {
    localStorage.clear();

    authService = {
      login: jest.fn().mockReturnValue(of({ accessToken, refreshToken })),
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

  afterEach(() => {
    localStorage.clear();
  });

  describe('Login', () => {
    it('stores both tokens in localStorage and in state', async () => {
      await dispatch(new Login({ email: 'a@finmate.app', password: 'secret' }));

      expect(localStorage.getItem('finmate_token')).toBe(accessToken);
      expect(localStorage.getItem('finmate_refresh_token')).toBe(
        refreshToken,
      );
      expect(store.selectSnapshot(AuthState.getToken)).toBe(accessToken);
      expect(store.selectSnapshot(AuthState.getRefreshToken)).toBe(
        refreshToken,
      );
      expect(store.selectSnapshot(AuthState.isAuthenticated)).toBe(true);
    });

    it('derives the E2EE key with the submitted password and email', async () => {
      await dispatch(new Login({ email: 'a@finmate.app', password: 'secret' }));

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

      await dispatch(new Login({ email: 'a@finmate.app', password: 'secret' }));

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

    it('clears both tokens from localStorage and resets state', async () => {
      await loginFirst();

      await dispatch(new Logout());

      expect(localStorage.getItem('finmate_token')).toBeNull();
      expect(localStorage.getItem('finmate_refresh_token')).toBeNull();
      expect(store.selectSnapshot(AuthState.getToken)).toBeNull();
      expect(store.selectSnapshot(AuthState.getRefreshToken)).toBeNull();
      expect(store.selectSnapshot(AuthState.getUser)).toBeNull();
      expect(store.selectSnapshot(AuthState.isAuthenticated)).toBe(false);
    });

    it('calls the backend logout endpoint with the stored refresh token', async () => {
      await loginFirst();

      await dispatch(new Logout());

      expect(authService.logout).toHaveBeenCalledWith(refreshToken);
    });

    it('does not call the backend logout endpoint when there is no refresh token', async () => {
      // No prior Login — state starts from whatever is (now cleared) in localStorage.
      await dispatch(new Logout());

      expect(authService.logout).not.toHaveBeenCalled();
      expect(localStorage.getItem('finmate_token')).toBeNull();
    });

    it(
      'clears local tokens/state and redirects even when the backend logout call fails ' +
        '(client safety must not depend on API success)',
      async () => {
        await loginFirst();
        authService.logout.mockReturnValue(
          throwError(() => new Error('network down')),
        );

        await dispatch(new Logout()).catch(() => undefined);

        expect(localStorage.getItem('finmate_token')).toBeNull();
        expect(localStorage.getItem('finmate_refresh_token')).toBeNull();
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

    it('always redirects to /auth/login with replaceUrl (cannot navigate back into a protected screen)', async () => {
      await loginFirst();

      await dispatch(new Logout());

      expect(router.navigate).toHaveBeenCalledWith(['/auth/login'], {
        replaceUrl: true,
      });
    });
  });

  describe('RefreshTokenSuccess', () => {
    it('overwrites the access token and refresh token in localStorage and state', async () => {
      const newAccess = jwt({ userId: 'user-1', email: 'a@finmate.app' });

      await dispatch(new RefreshTokenSuccess(newAccess, 'new-refresh-token'));

      expect(localStorage.getItem('finmate_token')).toBe(newAccess);
      expect(localStorage.getItem('finmate_refresh_token')).toBe(
        'new-refresh-token',
      );
      expect(store.selectSnapshot(AuthState.getToken)).toBe(newAccess);
      expect(store.selectSnapshot(AuthState.getRefreshToken)).toBe(
        'new-refresh-token',
      );
    });

    it('retains the existing refresh token when the server omits one (cookie-transport shape)', async () => {
      await dispatch(new Login({ email: 'a@finmate.app', password: 'secret' }));
      const newAccess = jwt({ userId: 'user-1', email: 'a@finmate.app' });

      await dispatch(new RefreshTokenSuccess(newAccess));

      expect(store.selectSnapshot(AuthState.getToken)).toBe(newAccess);
      expect(store.selectSnapshot(AuthState.getRefreshToken)).toBe(
        refreshToken,
      );
      // The body-token localStorage slot is untouched when no new refresh
      // token is supplied — only the access token is overwritten.
      expect(localStorage.getItem('finmate_refresh_token')).toBe(
        refreshToken,
      );
    });
  });
});
