import { QueryRunner } from 'typeorm';
import { AddDirectLedgerContactIdentity1720400000000 } from './1720400000000-AddDirectLedgerContactIdentity';

/**
 * P2P-1 — guards the direct-ledger Contact-identity migration's safety
 * contract: additive (existing User↔User rows untouched), User FKs relaxed to
 * nullable, Contact FKs added, correct XOR + same-kind CHECKs, and a
 * NON-destructive, guarded down().
 */
describe('AddDirectLedgerContactIdentity1720400000000', () => {
  const runMigration = async (method: 'up' | 'down'): Promise<string> => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    } as unknown as QueryRunner;
    await new AddDirectLedgerContactIdentity1720400000000()[method](
      queryRunner,
    );
    return queries.join('\n');
  };

  it('up() is additive: relaxes User FKs to nullable and adds nullable Contact FKs', async () => {
    const sql = await runMigration('up');
    expect(sql).toMatch(
      /ALTER TABLE "direct_ledger_entries" ALTER COLUMN "from_user_id" DROP NOT NULL/,
    );
    expect(sql).toMatch(
      /ALTER TABLE "direct_ledger_entries" ALTER COLUMN "to_user_id" DROP NOT NULL/,
    );
    expect(sql).toMatch(
      /ADD COLUMN "from_contact_id" UUID REFERENCES "contacts"\("id"\) ON DELETE RESTRICT/,
    );
    expect(sql).toMatch(
      /ADD COLUMN "to_contact_id" UUID REFERENCES "contacts"\("id"\) ON DELETE RESTRICT/,
    );
    // Never drops the table, rewrites, backfills, or deletes rows.
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/INSERT INTO/i);
    expect(sql).not.toMatch(/UPDATE\s+"direct_ledger_entries"/i);
    expect(sql).not.toMatch(/DELETE FROM/i);
  });

  it('up() enforces exactly one identity per side (User XOR Contact)', async () => {
    const sql = await runMigration('up');
    expect(sql).toMatch(
      /ADD CONSTRAINT "chk_dle_from_identity" CHECK \([\s\S]*"from_user_id" IS NOT NULL AND "from_contact_id" IS NULL[\s\S]*"from_user_id" IS NULL AND "from_contact_id" IS NOT NULL/,
    );
    expect(sql).toMatch(
      /ADD CONSTRAINT "chk_dle_to_identity" CHECK \([\s\S]*"to_user_id" IS NOT NULL AND "to_contact_id" IS NULL[\s\S]*"to_user_id" IS NULL AND "to_contact_id" IS NOT NULL/,
    );
  });

  it('up() replaces the distinctness check with a same-kind guard (rejects userA→userA and contactC→contactC, allows cross-kind)', async () => {
    const sql = await runMigration('up');
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS "chk_dle_distinct_parties"/);
    expect(sql).toMatch(
      /ADD CONSTRAINT "chk_dle_distinct_parties" CHECK \([\s\S]*"from_user_id" IS NULL OR "to_user_id" IS NULL OR "from_user_id" <> "to_user_id"[\s\S]*"from_contact_id" IS NULL OR "to_contact_id" IS NULL OR "from_contact_id" <> "to_contact_id"/,
    );
  });

  it('up() adds Contact indexes mirroring the user-side indexes', async () => {
    const sql = await runMigration('up');
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "idx_dle_from_contact" ON "direct_ledger_entries" \("from_contact_id"\)/,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "idx_dle_to_contact" ON "direct_ledger_entries" \("to_contact_id"\)/,
    );
  });

  it('down() is guarded against destroying financial history and reverses the schema', async () => {
    const sql = await runMigration('down');
    // Refuses to roll back while Contact-backed rows exist (never silently deletes history).
    expect(sql).toMatch(/RAISE EXCEPTION/i);
    expect(sql).toMatch(
      /from_contact_id" IS NOT NULL OR "to_contact_id" IS NOT NULL/,
    );
    // Reverses columns/indexes/constraints and restores the original NOT NULL + check.
    expect(sql).toMatch(/DROP COLUMN IF EXISTS "to_contact_id"/);
    expect(sql).toMatch(/DROP COLUMN IF EXISTS "from_contact_id"/);
    expect(sql).toMatch(/ALTER COLUMN "to_user_id" SET NOT NULL/);
    expect(sql).toMatch(/ALTER COLUMN "from_user_id" SET NOT NULL/);
    expect(sql).not.toMatch(/DELETE FROM/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
  });
});
