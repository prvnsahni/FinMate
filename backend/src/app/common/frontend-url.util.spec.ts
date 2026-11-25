import { resolveFrontendUrl } from './frontend-url.util';

/** Minimal ConfigService stand-in returning values from a fixed map. */
function makeConfig(values: Record<string, string | undefined>) {
  return {
    get<T = string>(key: string): T | undefined {
      return values[key] as T | undefined;
    },
  };
}

describe('resolveFrontendUrl', () => {
  it('returns the configured FRONTEND_URL when set', () => {
    const config = makeConfig({ FRONTEND_URL: 'https://app.example.com' });
    expect(resolveFrontendUrl(config)).toBe('https://app.example.com');
  });

  it('strips trailing slashes from the configured value', () => {
    const config = makeConfig({ FRONTEND_URL: 'https://app.example.com///' });
    expect(resolveFrontendUrl(config)).toBe('https://app.example.com');
  });

  it('trims surrounding whitespace from the configured value', () => {
    const config = makeConfig({ FRONTEND_URL: '  https://app.example.com  ' });
    expect(resolveFrontendUrl(config)).toBe('https://app.example.com');
  });

  it('honors the configured value even in production', () => {
    const config = makeConfig({
      FRONTEND_URL: 'https://app.example.com',
      NODE_ENV: 'production',
    });
    expect(resolveFrontendUrl(config)).toBe('https://app.example.com');
  });

  it('falls back to localhost in development when FRONTEND_URL is missing', () => {
    const config = makeConfig({ NODE_ENV: 'development' });
    expect(resolveFrontendUrl(config)).toBe('http://localhost:4200');
  });

  it('falls back to localhost in test when FRONTEND_URL is missing', () => {
    const config = makeConfig({ NODE_ENV: 'test' });
    expect(resolveFrontendUrl(config)).toBe('http://localhost:4200');
  });

  it('treats a blank FRONTEND_URL as unset', () => {
    const config = makeConfig({ FRONTEND_URL: '   ', NODE_ENV: 'development' });
    expect(resolveFrontendUrl(config)).toBe('http://localhost:4200');
  });

  it('throws outside development/test when FRONTEND_URL is missing', () => {
    const config = makeConfig({ NODE_ENV: 'production' });
    expect(() => resolveFrontendUrl(config)).toThrow(
      'FRONTEND_URL environment variable is required outside development/test environments',
    );
  });
});
