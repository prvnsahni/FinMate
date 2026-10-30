import {
  isSwaggerEnabled,
  buildCspDirectives,
  buildCorsOrigins,
  parseTrustProxy,
} from './security-config.util';

describe('security-config.util', () => {
  describe('isSwaggerEnabled (SEC-W5 Swagger)', () => {
    it('is OFF in production by default', () => {
      expect(isSwaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
    });

    it('is ON when NODE_ENV is development/test/unset', () => {
      expect(isSwaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
      expect(isSwaggerEnabled({ NODE_ENV: 'test' })).toBe(true);
      expect(isSwaggerEnabled({})).toBe(true);
    });

    it('ENABLE_SWAGGER=true forces ON even in production (locked UAT opt-in)', () => {
      expect(
        isSwaggerEnabled({ NODE_ENV: 'production', ENABLE_SWAGGER: 'true' }),
      ).toBe(true);
    });

    it('ENABLE_SWAGGER=false forces OFF even outside production', () => {
      expect(
        isSwaggerEnabled({ NODE_ENV: 'development', ENABLE_SWAGGER: 'false' }),
      ).toBe(false);
    });
  });

  describe('buildCspDirectives (SEC-W5 CSP)', () => {
    it('production (Swagger off) forbids unsafe-inline in script and style', () => {
      const d = buildCspDirectives(false);
      expect(d.scriptSrc).not.toContain(`'unsafe-inline'`);
      expect(d.styleSrc).not.toContain(`'unsafe-inline'`);
      expect(d.scriptSrc).toEqual([`'self'`]);
      expect(d.imgSrc).not.toContain('validator.swagger.io');
    });

    it('non-production (Swagger on) allows the inline needed by Swagger UI only', () => {
      const d = buildCspDirectives(true);
      expect(d.scriptSrc).toContain(`'unsafe-inline'`);
      expect(d.styleSrc).toContain(`'unsafe-inline'`);
      expect(d.imgSrc).toContain('validator.swagger.io');
    });
  });

  describe('buildCorsOrigins (CORS)', () => {
    it('splits a comma-separated CORS_ORIGINS list and trims each entry', () => {
      expect(
        buildCorsOrigins({
          CORS_ORIGINS: ' https://a.finmate.app , https://b.finmate.app ',
        }),
      ).toEqual(['https://a.finmate.app', 'https://b.finmate.app']);
    });

    it('returns a single-entry array for a CORS_ORIGINS value with no comma', () => {
      expect(
        buildCorsOrigins({ CORS_ORIGINS: 'https://finmate.app' }),
      ).toEqual(['https://finmate.app']);
    });

    it('falls back to FRONTEND_URL when CORS_ORIGINS is unset', () => {
      expect(
        buildCorsOrigins({ FRONTEND_URL: 'https://finmate.app' }),
      ).toEqual(['https://finmate.app']);
    });

    it('falls back to the localhost default when neither var is set', () => {
      expect(buildCorsOrigins({})).toEqual(['http://localhost:4200']);
    });

    it('treats an empty-string CORS_ORIGINS the same as unset (falls back)', () => {
      expect(
        buildCorsOrigins({
          CORS_ORIGINS: '',
          FRONTEND_URL: 'https://finmate.app',
        }),
      ).toEqual(['https://finmate.app']);
    });

    it('falls back to localhost when FRONTEND_URL is also an empty string', () => {
      expect(
        buildCorsOrigins({ CORS_ORIGINS: '', FRONTEND_URL: '' }),
      ).toEqual(['http://localhost:4200']);
    });

    it(
      'does not filter empty entries produced by a malformed list ' +
        '(preserves existing behaviour exactly — not sanitized here)',
      () => {
        expect(buildCorsOrigins({ CORS_ORIGINS: 'a,,b' })).toEqual([
          'a',
          '',
          'b',
        ]);
      },
    );

    it('a whitespace-only CORS_ORIGINS is truthy and is NOT treated as unset', () => {
      // Matches the existing inline logic's truthiness check exactly: a
      // non-empty (even if whitespace-only) string takes the split branch.
      expect(buildCorsOrigins({ CORS_ORIGINS: '   ' })).toEqual(['']);
    });
  });

  describe('parseTrustProxy (SEC-W9)', () => {
    it('defaults to a single trusted hop (non-spoofable, NOT `true`) when unset', () => {
      expect(parseTrustProxy(undefined)).toBe(1);
      expect(parseTrustProxy('')).toBe(1);
      expect(parseTrustProxy('   ')).toBe(1);
      // regression guard: the default must never be the spoofable `true`
      expect(parseTrustProxy(undefined)).not.toBe(true);
    });

    it('maps false-like values to false (ignore forwarding headers)', () => {
      for (const v of ['false', '0', 'off', 'no', 'FALSE']) {
        expect(parseTrustProxy(v)).toBe(false);
      }
    });

    it('maps true-like values to true (explicit opt-in only)', () => {
      for (const v of ['true', 'on', 'yes', 'TRUE']) {
        expect(parseTrustProxy(v)).toBe(true);
      }
    });

    it('maps a non-negative integer to a hop count', () => {
      expect(parseTrustProxy('1')).toBe(1);
      expect(parseTrustProxy('2')).toBe(2);
      expect(parseTrustProxy('10')).toBe(10);
    });

    it('maps a CSV of IP/CIDR to a trusted-subnet list', () => {
      expect(parseTrustProxy('10.0.0.0/8, 192.168.0.0/16')).toEqual([
        '10.0.0.0/8',
        '192.168.0.0/16',
      ]);
      expect(parseTrustProxy('127.0.0.1')).toEqual(['127.0.0.1']);
    });
  });
});
