import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { State, Action, StateContext, Selector } from '@ngxs/store';
import { jwtDecode } from 'jwt-decode';
import { AuthService } from './auth.service';
import { decodeToken } from './token.util';
import { isNativeAuthTransport } from '../platform/auth-transport';
import { from, of } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import {
  JwtPayload,
  LoginDto,
  LoginResponse,
  RegisterDto,
} from '@finmate/data-models';
import { ClientEncryptionService } from '../services/encryption.service';
import { GroupKeyService } from '../services/group-key.service';
import { CryptoSessionManager } from '../services/crypto-session-manager.service';

export class Login {
  static readonly type = '[Auth] Login';
  constructor(public payload: LoginDto) {}
}

export class Register {
  static readonly type = '[Auth] Register';
  constructor(public payload: RegisterDto) {}
}

export class Logout {
  static readonly type = '[Auth] Logout';
}

export class RefreshTokenSuccess {
  static readonly type = '[Auth] Refresh Token Success';
  constructor(
    public accessToken: string,
    /** Web only (AU-6). */
    public csrfToken?: string,
    /** Native only (interim pre-AU-6 scheme). */
    public refreshToken?: string,
  ) {}
}

export class SetPersistenceWarning {
  static readonly type = '[Auth] Set Persistence Warning';
  constructor(public payload: string | null) {}
}

/**
 * The CSRF double-submit value is deliberately persisted (unlike the access
 * token) — real-browser testing of this migration found that keeping it
 * in-memory only breaks the silent-refresh-on-reload flow entirely, since the
 * value needed to be wiped by every reload for the cookie-based refresh to
 * ever succeed again.
 *
 * This does NOT reintroduce AU-6's XSS/token-exfiltration concern: a CSRF
 * token is not a bearer credential and is not secret from same-origin
 * JavaScript by design — the double-submit pattern specifically requires the
 * client to be able to read and re-send it. It defends against cross-site
 * request forgery (a different site driving a request using the ambiently
 * attached cookie), not against script injection on this origin. The refresh
 * token itself — the actual credential AU-6 removed from JS-reachable
 * storage — is still never written anywhere but the HttpOnly cookie (web).
 *
 * Web only — native never reads or writes this key.
 */
const CSRF_STORAGE_KEY = 'finmate_csrf_token';

function readStoredCsrfToken(): string | null {
  try {
    return localStorage.getItem(CSRF_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistCsrfToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(CSRF_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(CSRF_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (private browsing / quota) — the in-memory value
    // still works for the current tab; only reload-survival is lost.
  }
}

export interface AuthStateModel {
  /**
   * Web (AU-6): in-memory only, never persisted, does not survive a reload.
   * Native (interim scheme below): persisted to `localStorage`, exactly as
   * before the AU-6 migration.
   */
  token: string | null;
  /** CSRF double-submit value for the next cookie-based refresh call. Web only (AU-6). */
  csrfToken: string | null;
  /**
   * Native-only (interim pre-AU-6 scheme — see `isNativeAuthTransport`).
   * Always `null` on web; AU-6 removed the client-visible refresh token for
   * web entirely, since the HttpOnly cookie carries it instead.
   *
   * Why native still does this: a Capacitor WebView's origin
   * (`capacitor://localhost` / `https://localhost`) is cross-SITE from the
   * real API host, so the `SameSite=Lax` refresh cookie is never sent to it —
   * `ADR-013`'s own "Problem" statement already names this ("cookies don't
   * behave reliably inside a Capacitor WebView"), which is why `AU-1` mandates
   * a header-based transport for native instead. That transport (tracked as
   * `AU-7`) has not been built yet, so native keeps the pre-AU-6 body-token +
   * `localStorage` scheme as an interim measure until it ships.
   */
  refreshToken: string | null;
  user: JwtPayload | null;
  persistenceWarning: string | null;
}

@State<AuthStateModel>({
  name: 'auth',
  defaults: {
    // Native (interim scheme — see AuthStateModel.refreshToken doc above):
    // bootstrap from localStorage exactly as before AU-6. Web: no localStorage
    // read for the access token — it lives only in memory, and a fresh page
    // load starts with no token until the auth route guards' silent
    // cookie-based refresh (see auth.guard.ts) re-establishes one, if a valid
    // session cookie exists. The CSRF token alone IS restored on web (see the
    // comment above `CSRF_STORAGE_KEY`) — without it, that silent refresh
    // could never pass the CSRF check.
    token: isNativeAuthTransport()
      ? localStorage.getItem('finmate_token')
      : null,
    csrfToken: isNativeAuthTransport() ? null : readStoredCsrfToken(),
    refreshToken: isNativeAuthTransport()
      ? localStorage.getItem('finmate_refresh_token')
      : null,
    user: isNativeAuthTransport()
      ? decodeToken<JwtPayload>(localStorage.getItem('finmate_token'))
      : null,
    persistenceWarning: null,
  },
})
@Injectable()
export class AuthState {
  private authService = inject(AuthService);
  private encryptionService = inject(ClientEncryptionService);
  private groupKeyService = inject(GroupKeyService);
  private cryptoSession = inject(CryptoSessionManager);
  private router = inject(Router);

  @Selector()
  static isAuthenticated(state: AuthStateModel): boolean {
    return !!state.token;
  }

  @Selector()
  static getToken(state: AuthStateModel): string | null {
    return state.token;
  }

  @Selector()
  static getCsrfToken(state: AuthStateModel): string | null {
    return state.csrfToken;
  }

  /** Native-only (interim scheme). Always `null` on web. */
  @Selector()
  static getRefreshToken(state: AuthStateModel): string | null {
    return state.refreshToken;
  }

  @Selector()
  static getUser(state: AuthStateModel): JwtPayload | null {
    return state.user;
  }

  @Selector()
  static getPersistenceWarning(state: AuthStateModel): string | null {
    return state.persistenceWarning;
  }

  @Action(Login)
  login(ctx: StateContext<AuthStateModel>, action: Login) {
    return this.authService.login(action.payload).pipe(
      mergeMap((result: LoginResponse) => {
        if (isNativeAuthTransport()) {
          // Interim native scheme (pre-AU-6, unchanged) — see
          // AuthStateModel.refreshToken doc above for why.
          localStorage.setItem('finmate_token', result.accessToken);
          if (result.refreshToken) {
            localStorage.setItem('finmate_refresh_token', result.refreshToken);
          }
          ctx.patchState({
            token: result.accessToken,
            refreshToken: result.refreshToken ?? null,
            user: jwtDecode<JwtPayload>(result.accessToken),
          });
        } else {
          // AU-6 (web): never persist the access token. The `refreshToken`
          // field in the dual-emit response body is intentionally ignored —
          // the HttpOnly cookie the backend also set on this response is the
          // real transport. The CSRF token is persisted — see CSRF_STORAGE_KEY.
          persistCsrfToken(result.csrfToken ?? null);
          ctx.patchState({
            token: result.accessToken,
            csrfToken: result.csrfToken ?? null,
            user: jwtDecode<JwtPayload>(result.accessToken),
          });
        }

        // Derive and store key, blocking navigation until complete
        return from(
          this.encryptionService.deriveAndStoreKey(
            action.payload.password,
            action.payload.email,
          ),
        ).pipe(
          mergeMap(async (res) => {
            if (!res.persisted) {
              ctx.dispatch(
                new SetPersistenceWarning(
                  "Secure key persistence is unavailable in your browser. Your encrypted data will remain accessible during this session, but you'll need to sign in again after refreshing or reopening the app.",
                ),
              );
            }
            try {
              await this.cryptoSession.ensureCryptoContext('login');
              await this.groupKeyService.getMyAsymmetricKeys();
            } catch (err) {
              console.error(
                'Failed to auto-provision asymmetric keys on login',
                err,
              );
            }
            return result;
          }),
        );
      }),
    );
  }

  @Action(SetPersistenceWarning)
  setPersistenceWarning(
    ctx: StateContext<AuthStateModel>,
    action: SetPersistenceWarning,
  ) {
    ctx.patchState({
      persistenceWarning: action.payload,
    });
  }

  @Action(Register)
  register(ctx: StateContext<AuthStateModel>, action: Register) {
    return this.authService.register(action.payload);
  }

  @Action(Logout)
  logout(ctx: StateContext<AuthStateModel>) {
    const state = ctx.getState();
    const native = isNativeAuthTransport();
    // Native: same "only call the backend if there's plausibly a session"
    // optimization as before AU-6, keyed off the body refresh token. Web
    // (AU-6): no client-visible refresh token to decide this with any more —
    // key it off the access token instead; the backend reads the actual
    // session from the cookie.
    const logout$ = native
      ? state.refreshToken
        ? this.authService.logout(state.refreshToken)
        : of(void 0)
      : state.token
        ? this.authService.logout()
        : of(void 0);

    this.cryptoSession.beginLogout();

    if (state.user?.email) {
      void this.encryptionService.clearKey(state.user.email);
    }
    void this.groupKeyService.clearPersistentCache();

    // Clear state regardless of API success to ensure client safety.
    if (native) {
      localStorage.removeItem('finmate_token');
      localStorage.removeItem('finmate_refresh_token');
    } else {
      persistCsrfToken(null);
    }
    ctx.setState({
      token: null,
      csrfToken: null,
      refreshToken: null,
      user: null,
      persistenceWarning: null,
    });

    // Centralized redirect: every logout path — the logout button, an account
    // deletion, a password change, a crypto-recovery failure, or a failed token
    // refresh in the HTTP interceptor — lands on Login. `replaceUrl` plus the
    // route guards means the user cannot navigate back into a protected screen.
    void this.router.navigate(['/auth/login'], { replaceUrl: true });

    return logout$;
  }

  @Action(RefreshTokenSuccess)
  refreshTokenSuccess(
    ctx: StateContext<AuthStateModel>,
    action: RefreshTokenSuccess,
  ) {
    if (isNativeAuthTransport()) {
      localStorage.setItem('finmate_token', action.accessToken);
      if (action.refreshToken) {
        localStorage.setItem('finmate_refresh_token', action.refreshToken);
      }
      ctx.patchState({
        token: action.accessToken,
        refreshToken: action.refreshToken || ctx.getState().refreshToken,
        user: jwtDecode<JwtPayload>(action.accessToken),
      });
      return;
    }

    const csrfToken = action.csrfToken ?? ctx.getState().csrfToken;
    if (action.csrfToken) {
      persistCsrfToken(action.csrfToken);
    }
    ctx.patchState({
      token: action.accessToken,
      csrfToken,
      user: jwtDecode<JwtPayload>(action.accessToken),
    });
  }
}
