/**
 * Tests for the SEC-W1 secret scanner. Run with Node's built-in runner
 * (no dependencies): `node --test scripts/secret-scan.test.mjs`.
 *
 * The dummy secrets below are synthetic and inert (not real credentials).
 * This file is allowlisted in the scanner so it never self-flags.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSecrets, isAllowlisted } from './secret-scan.mjs';

test('detects an intentional dummy AWS access key id', () => {
  const findings = findSecrets('const k = "AKIA' + 'ABCDEFGHIJKLMNOP";');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'aws-access-key-id');
});

test('detects a private key block', () => {
  const findings = findSecrets('-----BEGIN RSA PRIVATE KEY-----');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'private-key-block');
});

test('detects a dummy GitHub PAT and Stripe live key', () => {
  const gh = findSecrets('token=ghp_' + 'a'.repeat(36));
  assert.equal(gh[0].rule, 'github-token');
  const stripe = findSecrets('key=sk_live_' + 'b'.repeat(24));
  assert.equal(stripe[0].rule, 'stripe-live-key');
});

test('does NOT flag placeholder env values', () => {
  assert.deepEqual(findSecrets('JWT_SECRET=change_me_in_production'), []);
  assert.deepEqual(findSecrets('ENCRYPTION_KEY=your-32-char-encryption-key-here'), []);
});

test('does NOT flag local dev-default database credentials', () => {
  assert.deepEqual(
    findSecrets('postgresql://finmate_user:finmate_password@localhost:5432/finmate_dev'),
    [],
  );
  assert.deepEqual(findSecrets('POSTGRES_PASSWORD: finmate_password'), []);
});

test('does NOT flag ordinary code / token-shaped identifiers', () => {
  assert.deepEqual(findSecrets('const refreshToken = req.body.refreshToken;'), []);
  assert.deepEqual(findSecrets('uuid = "f81d4fae-7dec-11d0-a765-00a0c91e6bf6";'), []);
});

test('allowlist exempts inert paths but not arbitrary source', () => {
  assert.equal(isAllowlisted('.env.example'), true);
  assert.equal(isAllowlisted('UI_UX_MOCKUP.jpg'), true);
  assert.equal(
    isAllowlisted(
      'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..iv.ct.tag - Copyjpeg.jpg',
    ),
    true,
  );
  assert.equal(isAllowlisted('package-lock.json'), true);
  assert.equal(isAllowlisted('backend/src/app/auth/auth.service.ts'), false);
});

test('reports location + rule but never the secret value', () => {
  const findings = findSecrets('AKIA' + 'ABCDEFGHIJKLMNOP');
  assert.ok('line' in findings[0] && 'rule' in findings[0]);
  assert.ok(!('value' in findings[0]) && !('match' in findings[0]));
});
