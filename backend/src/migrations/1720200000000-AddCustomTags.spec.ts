import { QueryRunner } from 'typeorm';
import { AddCustomTags1720200000000 } from './1720200000000-AddCustomTags';

/**
 * TAG-BATCH-C1 — guards the custom-tag migration's safety contract: additive,
 * reversible, E2EE-only name (no plaintext companion), safe FK behaviour, no
 * backfill, no finance/canonical-semantics change, no second taxonomy table.
 */
describe('AddCustomTags1720200000000', () => {
  const runMigration = async (method: 'up' | 'down'): Promise<string> => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    } as unknown as QueryRunner;
    await new AddCustomTags1720200000000()[method](queryRunner);
    return queries.join('\n');
  };

  it('up() creates custom_tags and adds only the expense_tags discriminator (additive)', async () => {
    const sql = await runMigration('up');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "custom_tags"');
    expect(sql).toMatch(
      /ALTER TABLE "expense_tags" ADD COLUMN IF NOT EXISTS "tag_scope" VARCHAR\(20\) NOT NULL DEFAULT 'global'/,
    );
    // Never drops/alters an existing table's structure beyond the additive column.
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/ALTER TABLE "expense_tags" DROP/i);
    expect(sql).not.toMatch(/DROP INDEX/i);
    expect(sql).not.toMatch(/DROP CONSTRAINT/i);
  });

  it('stores the name E2EE-only — no plaintext/normalized/hash/search companion', async () => {
    const sql = await runMigration('up');
    expect(sql).toMatch(/"encrypted_name" TEXT NOT NULL/);
    expect(sql).not.toMatch(
      /normalized_key|name_hash|name_search|plaintext_name|"name"\s+(VAR|TEXT)/i,
    );
  });

  it('enforces the scope invariant with a CHECK constraint', async () => {
    const sql = await runMigration('up');
    expect(sql).toMatch(/CONSTRAINT "chk_custom_tags_scope" CHECK/);
    expect(sql).toMatch(
      /"scope_type" = 'personal' AND "owner_user_id" IS NOT NULL AND "group_id" IS NULL/,
    );
    expect(sql).toMatch(
      /"scope_type" = 'group' AND "group_id" IS NOT NULL AND "owner_user_id" IS NULL/,
    );
  });

  it('uses safe FK delete behaviour', async () => {
    const sql = await runMigration('up');
    // Owner/group deletion removes the DEFINITION only.
    expect(sql).toMatch(
      /"owner_user_id"[\s\S]*REFERENCES "users"\("id"\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /"group_id"[\s\S]*REFERENCES "groups"\("id"\) ON DELETE CASCADE/,
    );
    // Creator + key-version references null out, never cascade.
    expect(sql).toMatch(
      /"created_by_user_id"[\s\S]*REFERENCES "users"\("id"\) ON DELETE SET NULL/,
    );
    expect(sql).toMatch(
      /"group_key_version_id"[\s\S]*REFERENCES "group_key_versions"\("id"\) ON DELETE SET NULL/,
    );
  });

  it('performs NO backfill and touches NO financial column', async () => {
    const sql = await runMigration('up');
    expect(sql).not.toMatch(/INSERT INTO/i);
    expect(sql).not.toMatch(/UPDATE /i);
    expect(sql).not.toMatch(
      /amount_total|currency|paid_by|split|refund|settlement|balance/i,
    );
  });

  it('creates NO second taxonomy table (canonical stays code-curated)', async () => {
    const sql = await runMigration('up');
    expect(sql).not.toMatch(/taxonomy/i);
    // Only one new table is created.
    expect((sql.match(/CREATE TABLE/gi) ?? []).length).toBe(1);
  });

  it('indexes the future access patterns', async () => {
    const sql = await runMigration('up');
    expect(sql).toMatch(/CREATE INDEX[\s\S]*"custom_tags" \("owner_user_id"\)/);
    expect(sql).toMatch(/CREATE INDEX[\s\S]*"custom_tags" \("group_id"\)/);
    expect(sql).toMatch(
      /CREATE INDEX[\s\S]*"custom_tags" \("scope_type", "status"\)/,
    );
  });

  it('down() is reversible — drops only the added column and new table', async () => {
    const sql = await runMigration('down');
    expect(sql).toMatch(
      /ALTER TABLE "expense_tags" DROP COLUMN IF EXISTS "tag_scope"/,
    );
    expect(sql).toContain('DROP TABLE IF EXISTS "custom_tags"');
    // Never DROPs a pre-existing table (expense_tags only loses the added column).
    expect(sql).not.toMatch(
      /DROP TABLE IF EXISTS "(expenses|users|groups|expense_tags)"/,
    );
  });
});
