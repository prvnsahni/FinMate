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
