import { randomBytes, timingSafeEqual } from 'crypto';

/**
 * Auth transport helpers (BATCH-06 / W-AUTH). Pure and dependency-free — no
 * cookie-parser package is used; Express's built-in `res.cookie` sets cookies
 * and `parseCookies` reads the request `Cookie` header.
 *
 * Target web transport (frozen AU-2a):
 *  - refresh token in an HttpOnly, Secure, SameSite=Lax, HOST-ONLY cookie,
 *    path-scoped to the refresh endpoint (never a broad Domain attribute);
 *  - CSRF double-submit: an HttpOnly CSRF cookie plus an `X-CSRF-Token` header
 *    echoing the token that was delivered in the login response body. SameSite=Lax
 *    already blocks cross-site CSRF; double-submit additionally defends the
 *    same-site sibling-origin threat (a sibling cannot read the token via CORS).
 *
 * All of this is gated behind the `auth.dualTransport` feature flag; the legacy
 * body-token transport is always preserved during the compatibility window.
 */

export const REFRESH_COOKIE = 'finmate_refresh_token';
export const CSRF_COOKIE = 'finmate_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Host-only, path-scoped so the refresh token is only sent to the refresh call. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';
/** CSRF cookie is scoped to the auth sub-tree (sent with login/refresh/logout). */
export const CSRF_COOKIE_PATH = '/api/v1/auth';

/** 7 days — matches the refresh session lifetime (transport retention only). */
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge?: number;
  // NOTE: intentionally NO `domain` → the cookie is host-only.
}

export function refreshCookieOptions(): AuthCookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_MAX_AGE_MS,
  };
}

export function csrfCookieOptions(): AuthCookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: CSRF_COOKIE_PATH,
    maxAge: REFRESH_MAX_AGE_MS,
  };
}

/** Options for clearing a cookie — attributes must match those it was set with. */
export function clearCookieOptions(path: string): AuthCookieOptions {
  return { httpOnly: true, secure: true, sameSite: 'lax', path };
}

/** Parse a raw `Cookie` header into a name→value map. Never throws. */
export function parseCookies(header?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const rawValue = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(rawValue);
    } catch {
      out[name] = rawValue;
    }
  }
  return out;
}

/** A fresh, unguessable CSRF token (256 bits of entropy). */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/** Constant-time equality for CSRF double-submit. False on any mismatch/missing. */
export function csrfMatches(
  headerToken?: string | null,
  cookieToken?: string | null,
): boolean {
  if (!headerToken || !cookieToken) return false;
  const a = Buffer.from(String(headerToken));
  const b = Buffer.from(String(cookieToken));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
