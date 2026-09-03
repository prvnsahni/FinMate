/**
 * SEC-W5 / SEC-W9 bootstrap security configuration helpers (pure + testable).
 *
 * These are consumed by `main.ts` at startup. They contain no business logic and
 * never change API, auth, CORS, encryption, or financial behaviour.
 */

/**
 * Environment inputs relevant to Swagger gating. The index signature lets
 * `process.env` (NodeJS.ProcessEnv) be passed directly while documenting the
 * two keys this helper actually reads.
 */
export interface SwaggerEnv {
  NODE_ENV?: string;
  ENABLE_SWAGGER?: string;
  [key: string]: string | undefined;
}

/**
 * SEC-W5 (Swagger): decide whether the `/docs` Swagger UI is mounted.
 *
 * - `ENABLE_SWAGGER=true|1` → force ON (e.g. a locked-down UAT host).
 * - `ENABLE_SWAGGER=false|0` → force OFF.
 * - otherwise → ON only when `NODE_ENV` is not `production`.
 *
 * Default posture: developer/test machines get Swagger; production does not.
 */
export function isSwaggerEnabled(env: SwaggerEnv): boolean {
  const flag = (env.ENABLE_SWAGGER ?? '').trim().toLowerCase();
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;
  return (env.NODE_ENV ?? '').trim().toLowerCase() !== 'production';
}

/**
 * SEC-W5 (CSP): build the helmet Content-Security-Policy directives.
 *
 * The backend serves JSON only (no SPA — the Angular app is a separate host), so
 * the sole consumer of inline scripts/styles is the Swagger UI page. When Swagger
 * is not mounted (production), a strict CSP with **no `unsafe-inline`** is used.
 * When Swagger is mounted (non-production), the looser CSP it requires is used.
 */
export function buildCspDirectives(
  swaggerEnabled: boolean,
): Record<string, string[]> {
  if (swaggerEnabled) {
    return {
      defaultSrc: [`'self'`],
      styleSrc: [`'self'`, `'unsafe-inline'`],
      imgSrc: [`'self'`, 'data:', 'validator.swagger.io'],
      scriptSrc: [`'self'`, `'unsafe-inline'`],
    };
  }
  return {
    defaultSrc: [`'self'`],
    styleSrc: [`'self'`],
    imgSrc: [`'self'`, 'data:'],
    scriptSrc: [`'self'`],
  };
}

/**
 * SEC-W9 (trust proxy): parse the `TRUST_PROXY` env var into an Express
 * `trust proxy` setting, distinguishing trusted infrastructure from arbitrary
 * client-supplied forwarding headers.
 *
 * Accepted forms:
 * - unset / empty      → `1` (SAFE DEFAULT: trust exactly one hop; a client
 *                         cannot spoof its IP by injecting `X-Forwarded-For`).
 * - `false|0|off|no`   → `false` (use the socket IP; ignore forwarding headers).
 * - `true|on|yes`      → `true`  (trust all proxies — spoofable; opt-in only).
 * - a non-negative int → that many trusted proxy hops.
 * - CSV of IP/CIDR     → trust only those proxy addresses/ranges.
 *
 * NOTE: the exact production value (hop count matching the real proxy chain, or
 * the proxy CIDR) is deployment-specific and MUST be set by operations. This
 * helper only provides a safe, non-spoofable default and a configuration point.
 */
export function parseTrustProxy(raw?: string): boolean | number | string[] {
  const value = (raw ?? '').trim();
  if (value === '') return 1;

  const lower = value.toLowerCase();
  if (lower === 'false' || lower === '0' || lower === 'off' || lower === 'no') {
    return false;
  }
  if (lower === 'true' || lower === 'on' || lower === 'yes') {
    return true;
  }
  if (/^\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}
