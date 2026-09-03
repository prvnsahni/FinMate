#!/usr/bin/env node
/**
 * FinMate SEC-W1 — dependency-free repository secret scanner.
 *
 * Scans the CONTENT of tracked text files for high-confidence provider secrets
 * and private keys, and fails (exit 1) on any finding. It uses only Node
 * built-ins (`node:child_process`, `node:fs`) — no packages are installed.
 *
 * Design goals (per BATCH-02 requirements):
 * - High precision: only unambiguous secret formats (private keys, provider
 *   token prefixes). No generic entropy heuristics → avoids unusable false
 *   positives on dev defaults, DTOs, and test data.
 * - Fail-closed: any confirmed match exits non-zero.
 * - Never prints the matched secret value — only `path`, `line`, and rule name.
 * - Documented allowlist: templates, binary/image assets (including the known
 *   orphaned JWE-encrypted `.jpg` fixtures at the repo root — SEC-W1 blob
 *   backlog, tracked separately for history purge), lockfiles, and this
 *   scanner's own source/test (which necessarily contain patterns/dummies).
 *   The allowlist NEVER exempts an actual secret value — only inert paths.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** High-confidence secret rules. Names are reported; values never are. */
export const RULES = [
  {
    name: 'private-key-block',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/,
  },
  { name: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: 'github-token',
    re: /\bghp_[0-9A-Za-z]{36}\b|\bgithub_pat_[0-9A-Za-z_]{40,}\b/,
  },
  { name: 'slack-token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'stripe-live-key', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/ },
  { name: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{26,}\b/ },
  { name: 'resend-api-key', re: /\bre_[0-9A-Za-z]{20,}\b/ },
];

const ALLOWLIST_EXACT = new Set(['.env.example']);

const ALLOWLIST_SUFFIX = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.ico',
  '.svg',
  '.pdf',
  '.lock',
  'package-lock.json',
];

const ALLOWLIST_REGEX = [
  /scripts\/secret-scan\.mjs$/,
  /scripts\/secret-scan\.test\.mjs$/,
];

/** True if a repo-relative path is exempt from scanning (inert paths only). */
export function isAllowlisted(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (ALLOWLIST_EXACT.has(p)) return true;
  if (ALLOWLIST_SUFFIX.some((s) => p.toLowerCase().endsWith(s))) return true;
  if (ALLOWLIST_REGEX.some((r) => r.test(p))) return true;
  return false;
}

/**
 * Returns findings for a single file's content: `{ line, rule }[]`.
 * Pure and side-effect-free so it can be unit-tested. Never returns the value.
 */
export function findSecrets(content) {
  const findings = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((text, i) => {
    for (const rule of RULES) {
      if (rule.re.test(text)) {
        findings.push({ line: i + 1, rule: rule.name });
      }
    }
  });
  return findings;
}

function listTrackedFiles() {
  const out = execSync('git ls-files -z', {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

function looksBinary(buf) {
  // Treat a NUL byte in the first 8 KB as binary; skip such files.
  const slice = buf.subarray(0, 8192);
  return slice.includes(0);
}

function main() {
  const files = listTrackedFiles();
  const findings = [];
  for (const file of files) {
    if (isAllowlisted(file)) continue;
    let buf;
    try {
      buf = readFileSync(file);
    } catch {
      continue;
    }
    if (looksBinary(buf)) continue;
    for (const f of findSecrets(buf.toString('utf8'))) {
      findings.push({ file, ...f });
    }
  }

  if (findings.length > 0) {
    console.error('SEC-W1 secret scan FAILED — potential secrets detected:');
    for (const f of findings) {
      // NEVER print the value — only location + rule.
      console.error(`  ${f.file}:${f.line}  [${f.rule}]  (value redacted)`);
    }
    console.error(
      '\nIf a finding is a false positive or an inert encrypted fixture, add its ' +
        'PATH (never its value) to the allowlist in scripts/secret-scan.mjs with a ' +
        'justification. Rotate and purge any confirmed real secret.',
    );
    process.exit(1);
  }

  console.log(
    `SEC-W1 secret scan passed (${files.length} tracked files, 0 findings).`,
  );
}

// Only run the scanner when invoked directly, not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith('secret-scan.mjs')) {
  main();
}
