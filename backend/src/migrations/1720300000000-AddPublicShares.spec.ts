import { QueryRunner } from 'typeorm';
import { AddPublicShares1720300000000 } from './1720300000000-AddPublicShares';

/**
 * PUBLIC-1A — guards the public-shares migration's safety contract: additive,
 * reversible, hash-only token, safe FK behaviour, and NO existing-table change,
 * backfill, finance/E2EE/PII column, or raw token.
 */
describe('AddPublicShares1720300000000', () => {
  const runMigration = async (method: 'up' | 'down'): Promise<string> => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    } as unknown as QueryRunner;
    await new AddPublicShares1720300000000()[method](queryRunner);
    return queries.join('\n');
  };

  it('up() creates ONLY the new public_shares table (additive — no existing table touched)', async () => {
    const sql = await runMigration('up');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "public_shares"');
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_public_shares_group" ON "public_shares" ("group_id")',
    );
    // Never alters/drops an existing table, column, index or constraint.
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/ALTER TABLE/i);
    expect(sql).not.toMatch(/DROP INDEX/i);
    expect(sql).not.toMatch(/DROP CONSTRAINT/i);
    // No data written — creation only, no backfill.
    expect(sql).not.toMatch(/INSERT INTO/i);
    expect(sql).not.toMatch(/UPDATE\s+"/i);
  });

  it('stores a UNIQUE token HASH, never a raw token', async () => {
    const sql = await runMigration('up');
    expect(sql).toMatch(/"token_hash" VARCHAR\(64\) NOT NULL/);
    expect(sql).toMatch(
      /CONSTRAINT "uq_public_shares_token_hash" UNIQUE \("token_hash"\)/,
    );
    // No raw/plaintext token column.
    expect(sql).not.toMatch(/"token"\s+(VAR|TEXT)|plaintext_token|raw_token/i);
  });

  it('has safe FK behaviour: group CASCADE, creator SET NULL', async () => {
    const sql = await runMigration('up');
    expect(sql).toMatch(
      /"group_id" UUID NOT NULL REFERENCES "groups"\("id"\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /"created_by_user_id" UUID REFERENCES "users"\("id"\) ON DELETE SET NULL/,
    );
  });

  it('persists NO finance, E2EE, or PII column', async () => {
    const sql = await runMigration('up');
    expect(sql).not.toMatch(
      /amount|balance|currency|total|encrypted|ciphertext|"title"|"description"|"note"|"name"|email|phone|username|wrapped_key|"key"/i,
    );
  });

  it('down() drops ONLY the new table (reversible, nothing else touched)', async () => {
    const sql = await runMigration('down');
    expect(sql).toBe('DROP TABLE IF EXISTS "public_shares"');
    expect(sql).not.toMatch(/ALTER TABLE/i);
  });
});
