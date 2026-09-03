import {
  REFRESH_COOKIE_PATH,
  CSRF_COOKIE_PATH,
  refreshCookieOptions,
  csrfCookieOptions,
  clearCookieOptions,
  parseCookies,
  generateCsrfToken,
  csrfMatches,
} from './auth-transport.util';

describe('auth-transport.util (W-AUTH)', () => {
  describe('cookie options', () => {
    it('refresh cookie is HttpOnly, Secure, SameSite=Lax, host-only, path-scoped', () => {
      const o = refreshCookieOptions();
      expect(o.httpOnly).toBe(true);
      expect(o.secure).toBe(true);
      expect(o.sameSite).toBe('lax');
      expect(o.path).toBe(REFRESH_COOKIE_PATH);
      expect(o.path).toBe('/api/v1/auth/refresh');
      expect(o).not.toHaveProperty('domain'); // host-only: never a broad Domain
      expect(o.maxAge).toBeGreaterThan(0);
    });

    it('csrf cookie is HttpOnly, Secure, SameSite=Lax, host-only, auth-scoped', () => {
      const o = csrfCookieOptions();
      expect(o.httpOnly).toBe(true);
      expect(o.secure).toBe(true);
      expect(o.sameSite).toBe('lax');
      expect(o.path).toBe(CSRF_COOKIE_PATH);
      expect(o).not.toHaveProperty('domain');
    });

    it('clear options match attributes and carry no maxAge', () => {
      const o = clearCookieOptions(REFRESH_COOKIE_PATH);
      expect(o.httpOnly).toBe(true);
      expect(o.secure).toBe(true);
      expect(o.sameSite).toBe('lax');
      expect(o.path).toBe(REFRESH_COOKIE_PATH);
      expect(o.maxAge).toBeUndefined();
    });
  });

  describe('parseCookies', () => {
    it('parses a standard Cookie header into a map', () => {
      const c = parseCookies(
        'finmate_refresh_token=abc.def.ghi; finmate_csrf=deadbeef; other=1',
      );
      expect(c.finmate_refresh_token).toBe('abc.def.ghi');
      expect(c.finmate_csrf).toBe('deadbeef');
      expect(c.other).toBe('1');
    });

    it('URL-decodes values and tolerates empty/malformed input', () => {
      expect(parseCookies('x=a%20b').x).toBe('a b');
      expect(parseCookies(undefined)).toEqual({});
      expect(parseCookies('')).toEqual({});
      expect(parseCookies('novalue')).toEqual({});
    });
  });

  describe('generateCsrfToken', () => {
    it('is a 64-char hex string and unique per call', () => {
      const a = generateCsrfToken();
      const b = generateCsrfToken();
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(a).not.toBe(b);
    });
  });

  describe('csrfMatches (constant-time double-submit)', () => {
    it('true only when both present and equal', () => {
      expect(csrfMatches('token123', 'token123')).toBe(true);
    });
    it('false on mismatch, missing, or different length', () => {
      expect(csrfMatches('token123', 'tokenXYZ')).toBe(false);
      expect(csrfMatches('token123', 'token1234')).toBe(false);
      expect(csrfMatches(undefined, 'token123')).toBe(false);
      expect(csrfMatches('token123', undefined)).toBe(false);
      expect(csrfMatches('', '')).toBe(false);
    });
  });
});
