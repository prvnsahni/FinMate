import {
  isSwaggerEnabled,
  buildCspDirectives,
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
