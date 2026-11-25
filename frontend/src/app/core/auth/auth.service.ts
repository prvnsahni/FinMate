import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  CurrentUserResponse,
  LoginDto,
  LoginResponse,
  RefreshTokenResponse,
  RegisterDto,
  RegisterResponse,
  UpdateProfileDto,
} from '@finmate/data-models';
import { ClientEncryptionService } from '../services/encryption.service';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiBaseUrl}/auth`;
  private encryptionService = inject(ClientEncryptionService);

  login(credentials: LoginDto): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.baseUrl}/login`, credentials);
  }

  register(data: RegisterDto): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(`${this.baseUrl}/register`, data);
  }

  /**
   * Logout. Web (AU-6): no body — the refresh cookie identifies the session.
   * Native (interim, pre-AU-6 scheme — see `isNativeAuthTransport`): pass the
   * body-stored refresh token, exactly as before the cookie migration.
   */
  logout(refreshToken?: string): Observable<void> {
    this.encryptionService.clearKey();
    return this.http.post<void>(
      `${this.baseUrl}/logout`,
      refreshToken ? { refreshToken } : {},
    );
  }

  /**
   * Refresh. Web (AU-6): no body token — the HttpOnly refresh cookie carries
   * it; `csrfToken` is the value echoed back from the previous login/refresh
   * response, required for the CSRF double-submit check. Native (interim,
   * pre-AU-6 scheme): pass the body-stored refresh token instead, exactly as
   * before the cookie migration — no CSRF header is sent or needed for that path.
   */
  refresh(
    opts: {
      csrfToken?: string | null;
      refreshToken?: string;
    } = {},
  ): Observable<RefreshTokenResponse> {
    const { csrfToken, refreshToken } = opts;
    return this.http.post<RefreshTokenResponse>(
      `${this.baseUrl}/refresh`,
      refreshToken ? { refreshToken } : {},
      csrfToken ? { headers: { 'X-CSRF-Token': csrfToken } } : {},
    );
  }

  getMe(): Observable<CurrentUserResponse> {
    return this.http.get<CurrentUserResponse>(
      `${environment.apiBaseUrl}/users/me`,
    );
  }

  updateProfile(
    profileData: UpdateProfileDto,
  ): Observable<CurrentUserResponse> {
    return this.http.patch<CurrentUserResponse>(
      `${environment.apiBaseUrl}/users/me`,
      profileData,
    );
  }

  /**
   * Change password (current password known). The caller must supply the
   * private wrapping key re-encrypted under the new master key so encrypted
   * data stays accessible. Zero-knowledge — server never sees key plaintext.
   */
  changePassword(payload: {
    currentPassword: string;
    newPassword: string;
    encryptedPrivateWrappingKey: string;
    recoveryWrappedKey?: string;
  }): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/change-password`, payload);
  }

  /**
   * Forgot-password step 1: ask the server to email a reset link. The response
   * is always generic (never reveals whether the address is registered).
   */
  requestPasswordReset(email: string): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/forgot-password`, { email });
  }

  /**
   * Forgot-password step 2: fetch the zero-knowledge reset context for a token
   * (account email as PBKDF2 salt, whether a recovery key exists, and the
   * recovery-wrapped private-key ciphertext). Throws for an invalid/expired token.
   */
  getResetContext(token: string): Observable<{
    email: string;
    hasRecoveryKey: boolean;
    recoveryWrappedKey: string | null;
  }> {
    return this.http.get<{
      email: string;
      hasRecoveryKey: boolean;
      recoveryWrappedKey: string | null;
    }>(`${this.baseUrl}/reset-password`, { params: { token } });
  }

  /**
   * Forgot-password step 3: submit the new password with the private wrapping
   * key re-encrypted under the new master key, so encrypted data stays
   * accessible. Zero-knowledge — the server never sees plaintext key material.
   */
  resetPassword(payload: {
    token: string;
    newPassword: string;
    encryptedPrivateWrappingKey: string;
  }): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/reset-password`, payload);
  }

  /** Store the client-produced recovery-wrapped key blob. */
  setRecoveryKey(recoveryWrappedKey: string): Observable<unknown> {
    return this.http.post(`${environment.apiBaseUrl}/users/me/recovery-key`, {
      recoveryWrappedKey,
    });
  }

  /** Whether the current user has a recovery key configured. */
  getRecoveryKeyStatus(): Observable<{
    hasRecoveryKey: boolean;
    recoveryKeyCreatedAt: string | null;
  }> {
    return this.http.get<{
      hasRecoveryKey: boolean;
      recoveryKeyCreatedAt: string | null;
    }>(`${environment.apiBaseUrl}/users/me/recovery-key/status`);
  }

  /**
   * Permanently delete the account (PII-only policy). Anonymizes personal data
   * and revokes access server-side; financial history is preserved. Irreversible.
   */
  deleteAccount(): Observable<unknown> {
    this.encryptionService.clearKey();
    return this.http.delete(`${environment.apiBaseUrl}/users/me`);
  }
}
