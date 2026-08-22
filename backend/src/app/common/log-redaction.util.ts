import { createHash } from 'crypto';

/**
 * SEC-W2 / SEC-W7 log-hygiene helpers.
 *
 * These are pure, dependency-free functions used by the request logging
 * interceptor, the global exception filter, and the auth audit writer to keep
 * secrets and unnecessary PII out of application logs and audit metadata.
 *
 * Design notes:
 * - Redaction is by **parameter/key name** (not value heuristics). A secret only
 *   ever reaches a log under a known-sensitive parameter name (`token`, `code`,
 *   `email`, …); name-based redaction therefore has no false negatives for real
 *   secret parameters and never over-redacts innocent token-shaped values.
 * - Names are matched case-insensitively with `_`/`-` stripped, so `reset_token`,
 *   `reset-token`, and `resettoken` are all covered.
 * - Nothing here changes API responses, database rows, or authentication logic.
 */

const REDACTED = '[REDACTED]';

/** Query-parameter names whose VALUES must never appear in logs (SEC-W2). */
const SENSITIVE_QUERY_PARAMS = new Set<string>([
  'token',
  'refreshtoken',
  'accesstoken',
  'password',
  'pwd',
  'secret',
  'code',
  'otp',
  'mfa',
  'mfacode',
  'apikey',
  'key',
  'resettoken',
  'verifytoken',
  'verification',
  'verificationtoken',
  'auth',
  'authorization',
  'session',
  'sessionid',
  'jwt',
  'email',
]);

/** Object keys stripped from audit metadata before persistence (SEC-W7). */
const SENSITIVE_META_KEYS = new Set<string>([
  'email',
  'password',
  'pwd',
  'token',
  'refreshtoken',
  'accesstoken',
  'secret',
  'otp',
  'mfacode',
  'apikey',
  'key',
  'jwt',
  'authorization',
  'ip',
]);

/**
 * PUBLIC-1C-PRE — path prefixes whose NEXT path segment is a CAPABILITY TOKEN
 * (a password-equivalent secret) that must never reach logs. Unlike query
 * tokens (redacted by name below), these live in the URL PATH of a shareable
 * link, so they are redacted by position: the one segment following the prefix.
 */
const CAPABILITY_PATH_PREFIXES = ['/public/shares/'];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Redact the single token segment after each capability prefix, matching with or
 * without a leading API prefix (e.g. `/api/v1/public/shares/<token>`), leaving
 * every other segment intact. Pure/string-only; preserves the URL contract.
 */
function redactCapabilityPath(path: string): string {
  let out = path;
  for (const prefix of CAPABILITY_PATH_PREFIXES) {
    const re = new RegExp(`(${escapeRegExp(prefix)})[^/?#]+`, 'gi');
    out = out.replace(re, `$1${REDACTED}`);
  }
  return out;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, '');
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Redacts secrets from a URL/path for logging: the VALUES of sensitive query
 * parameters (by name), AND — PUBLIC-1C-PRE — any CAPABILITY-TOKEN path segment
 * for a shareable route (`/public/shares/<token>` → `/public/shares/[REDACTED]`),
 * so a token in the PATH is never logged even without a query string. Every other
 * path segment and non-sensitive parameter is preserved. Accepts absolute URLs or
 * Express `originalUrl`/`url` forms. Never throws; returns `''` for empty input.
 */
export function redactUrl(rawUrl: string | undefined | null): string {
  if (!rawUrl) return '';
  const queryIndex = rawUrl.indexOf('?');

  // Redact a capability token in the PATH first (present with or without a query).
  const rawPath = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
  const path = redactCapabilityPath(rawPath);
  if (queryIndex === -1) return path;

  const query = rawUrl.slice(queryIndex + 1);
  if (!query) return `${path}?`;

  // Preserve any URL fragment untouched (it never carries query params).
  const hashIndex = query.indexOf('#');
  const fragment = hashIndex === -1 ? '' : query.slice(hashIndex);
  const queryOnly = hashIndex === -1 ? query : query.slice(0, hashIndex);

  const redactedPairs = queryOnly.split('&').map((pair) => {
    if (!pair) return pair;
    const eqIndex = pair.indexOf('=');
    const rawName = eqIndex === -1 ? pair : pair.slice(0, eqIndex);
    const isSensitive = SENSITIVE_QUERY_PARAMS.has(
      normalizeName(decodeSafe(rawName)),
    );
    if (!isSensitive) return pair;
    return eqIndex === -1 ? rawName : `${rawName}=${REDACTED}`;
  });

  return `${path}?${redactedPairs.join('&')}${fragment}`;
}

/**
 * Returns a shallow copy of an audit-metadata object with known-sensitive keys
 * removed (SEC-W7). Matching is name-based (case/`_`/`-` insensitive). The user
 * is already identified by the audit row's `actorUser` FK, so dropping keys such
 * as `email` loses no legitimate audit value.
 */
export function redactSensitiveKeys(
  obj: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!obj) return out;
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_META_KEYS.has(normalizeName(key))) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Hashes a client IP for logging (SEC-W2 "unnecessary IP exposure"). Uses the
 * same unsalted SHA-256 scheme already applied to `audit_logs.ipHash`, so the
 * same IP correlates across request logs and audit rows without exposing the
 * raw address. Returns `undefined` for empty input.
 *
 * NOTE: which IP source is trusted (proxy / X-Forwarded-For correctness) is a
 * separate concern tracked as SEC-W9 and is intentionally NOT addressed here.
 */
export function hashIp(ip?: string | null): string | undefined {
  if (!ip) return undefined;
  return createHash('sha256').update(String(ip)).digest('hex');
}
