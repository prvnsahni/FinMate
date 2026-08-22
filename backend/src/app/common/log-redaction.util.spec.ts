import { createHash } from 'crypto';
import { redactUrl, redactSensitiveKeys, hashIp } from './log-redaction.util';

describe('log-redaction.util', () => {
  describe('redactUrl (SEC-W2)', () => {
    it('returns non-query URLs unchanged', () => {
      expect(redactUrl('/api/v1/expenses')).toBe('/api/v1/expenses');
      expect(redactUrl('/api/v1/groups/123/members')).toBe(
        '/api/v1/groups/123/members',
      );
    });

    it('returns empty string for empty/nullish input', () => {
      expect(redactUrl('')).toBe('');
      expect(redactUrl(undefined)).toBe('');
      expect(redactUrl(null)).toBe('');
    });

    it('redacts a reset-token URL', () => {
      expect(redactUrl('/api/v1/auth/reset-password?token=supersecret123')).toBe(
        '/api/v1/auth/reset-password?token=[REDACTED]',
      );
    });

    it('redacts a verification-token URL', () => {
      expect(redactUrl('/api/v1/auth/verify-email?token=abc.def.ghi')).toBe(
        '/api/v1/auth/verify-email?token=[REDACTED]',
      );
    });

    it('redacts the email lookup query value', () => {
      expect(redactUrl('/api/v1/users/lookup?email=user@example.com')).toBe(
        '/api/v1/users/lookup?email=[REDACTED]',
      );
    });

    it('redacts multiple sensitive parameters', () => {
      expect(
        redactUrl('/x?token=aaa&password=bbb&secret=ccc'),
      ).toBe('/x?token=[REDACTED]&password=[REDACTED]&secret=[REDACTED]');
    });

    it('redacts repeated occurrences of the same sensitive parameter', () => {
      expect(redactUrl('/x?token=aaa&token=bbb')).toBe(
        '/x?token=[REDACTED]&token=[REDACTED]',
      );
    });

    it('redacts an encoded token value (redaction is by name, not value)', () => {
      expect(redactUrl('/x?token=a%20b%2Fc%3Dd')).toBe('/x?token=[REDACTED]');
    });

    it('matches sensitive names case-insensitively and ignores _/- separators', () => {
      expect(redactUrl('/x?Reset_Token=aaa')).toBe('/x?Reset_Token=[REDACTED]');
      expect(redactUrl('/x?REFRESH-TOKEN=aaa')).toBe(
        '/x?REFRESH-TOKEN=[REDACTED]',
      );
      expect(redactUrl('/x?accessToken=aaa')).toBe('/x?accessToken=[REDACTED]');
    });

    it('preserves non-sensitive parameters and their (token-like) values', () => {
      // a token-shaped value under an innocent name is NOT a secret and stays
      expect(redactUrl('/x?page=2&limit=20&ref=abc123DEF456')).toBe(
        '/x?page=2&limit=20&ref=abc123DEF456',
      );
    });

    it('redacts only the sensitive params in a mixed query', () => {
      expect(
        redactUrl('/x?page=2&token=secret&email=a@b.com&sort=desc'),
      ).toBe('/x?page=2&token=[REDACTED]&email=[REDACTED]&sort=desc');
    });

    it('handles a valueless sensitive param without throwing', () => {
      expect(redactUrl('/x?token&page=1')).toBe('/x?token&page=1');
    });

    it('never emits the secret value in the output', () => {
      const secret = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig';
      const out = redactUrl(
        `/api/v1/auth/refresh?refreshToken=${secret}&mfaCode=123456`,
      );
      expect(out).not.toContain(secret);
      expect(out).not.toContain('123456');
      expect(out).toContain('[REDACTED]');
    });

    // ── PUBLIC-1C-PRE — capability token in the PATH (shareable link) ──────────
    describe('public-share capability token in the path', () => {
      const RAW = 'kQ8mN3pR7sT1vW5xY9zA2bC4dE6fG0hJ_lMoPqRsTuV'; // base64url-ish

      it('redacts a valid-looking token segment (no query string)', () => {
        expect(redactUrl(`/api/v1/public/shares/${RAW}`)).toBe(
          '/api/v1/public/shares/[REDACTED]',
        );
      });

      it('redacts an invalid/short token the same way (positional, not value-based)', () => {
        expect(redactUrl('/api/v1/public/shares/not-a-real-token')).toBe(
          '/api/v1/public/shares/[REDACTED]',
        );
        expect(redactUrl('/public/shares/x')).toBe('/public/shares/[REDACTED]');
      });

      it('redacts the token even when a query string follows', () => {
        expect(redactUrl(`/api/v1/public/shares/${RAW}?foo=bar`)).toBe(
          '/api/v1/public/shares/[REDACTED]?foo=bar',
        );
      });

      it('still redacts a sensitive query param after the capability route', () => {
        expect(redactUrl(`/api/v1/public/shares/${RAW}?token=leak&page=2`)).toBe(
          '/api/v1/public/shares/[REDACTED]?token=[REDACTED]&page=2',
        );
      });

      it('never leaves the raw capability token anywhere in the output', () => {
        const out = redactUrl(`/api/v1/public/shares/${RAW}?ref=${RAW}`);
        // The path token is gone; a non-sensitive query value is not our concern
        // here, but the PATH token specifically must never survive.
        expect(out.startsWith('/api/v1/public/shares/[REDACTED]')).toBe(true);
        expect(out).not.toContain(`shares/${RAW}`);
      });

      it('leaves unrelated path segments untouched (only the capability segment is redacted)', () => {
        expect(redactUrl('/api/v1/groups/123/members')).toBe(
          '/api/v1/groups/123/members',
        );
        expect(redactUrl('/api/v1/public/health')).toBe('/api/v1/public/health');
        // A deeper segment after the token is not the capability secret.
        expect(redactUrl('/public/shares/tok/extra')).toBe(
          '/public/shares/[REDACTED]/extra',
        );
      });

      it('does not change existing query-only redaction behavior', () => {
        expect(
          redactUrl('/api/v1/auth/reset-password?token=supersecret123'),
        ).toBe('/api/v1/auth/reset-password?token=[REDACTED]');
        expect(redactUrl('/api/v1/expenses')).toBe('/api/v1/expenses');
      });
    });
  });

  describe('redactSensitiveKeys (SEC-W7)', () => {
    it('drops the email key', () => {
      expect(redactSensitiveKeys({ email: 'a@b.com', foo: 1 })).toEqual({
        foo: 1,
      });
    });

    it('drops token/password/secret/otp keys (name-insensitive)', () => {
      expect(
        redactSensitiveKeys({
          Token: 'x',
          PASSWORD: 'y',
          mfa_code: 'z',
          refresh_token: 'r',
          keep: 'ok',
        }),
      ).toEqual({ keep: 'ok' });
    });

    it('returns an empty object for empty/nullish input', () => {
      expect(redactSensitiveKeys(undefined)).toEqual({});
      expect(redactSensitiveKeys(null)).toEqual({});
      expect(redactSensitiveKeys({})).toEqual({});
    });

    it('does not mutate the input object', () => {
      const input = { email: 'a@b.com', linkedGroupIds: ['g1'] };
      const out = redactSensitiveKeys(input);
      expect(input).toHaveProperty('email');
      expect(out).not.toHaveProperty('email');
      expect(out).toEqual({ linkedGroupIds: ['g1'] });
    });
  });

  describe('hashIp (SEC-W2)', () => {
    it('hashes with unsalted SHA-256 (matches audit ipHash scheme)', () => {
      const expected = createHash('sha256').update('1.2.3.4').digest('hex');
      expect(hashIp('1.2.3.4')).toBe(expected);
    });

    it('is stable for the same IP and different for different IPs', () => {
      expect(hashIp('1.2.3.4')).toBe(hashIp('1.2.3.4'));
      expect(hashIp('1.2.3.4')).not.toBe(hashIp('5.6.7.8'));
    });

    it('returns undefined for empty input and never returns the raw IP', () => {
      expect(hashIp(undefined)).toBeUndefined();
      expect(hashIp(null)).toBeUndefined();
      expect(hashIp('')).toBeUndefined();
      expect(hashIp('9.9.9.9')).not.toContain('9.9.9.9');
    });
  });
});
