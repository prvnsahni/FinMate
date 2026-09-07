import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P2P-1 — extend `direct_ledger_entries` to support a non-member `Contact` on
 * either side, mirroring the dual-identity model already used by
 * `expense_splits` / `expense_payments`. Each side becomes `User XOR Contact`.
 *
 * Additive and non-destructive:
 *  - existing User↔User rows are untouched (they keep both user FKs and satisfy
 *    the new per-side "exactly one identity" checks);
 *  - the User FK columns are relaxed to NULLABLE (never rewritten);
 *  - two nullable Contact FK columns + indexes are added;
 *  - the old same-user distinctness check is replaced with a same-kind check
 *    that still rejects userA→userA and now also rejects contactC→contactC,
 *    while allowing User→Contact and Contact→User.
 *
 * No backfill, no data mutation, no dropped rows.
 */
export class AddDirectLedgerContactIdentity1720400000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Relax the existing User FK columns to nullable (preserves all rows).
    await queryRunner.query(
      `ALTER TABLE "direct_ledger_entries" ALTER COLUMN "from_user_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "direct_ledger_entries" ALTER COLUMN "to_user_id" DROP NOT NULL`,
    );

    // 2. Add nullable Contact FK columns (RESTRICT — Contacts are archived,
    //    never hard-deleted, matching the User FK behaviour on this table).
    await queryRunner.query(
      `ALTER TABLE "direct_ledger_entries" ADD COLUMN "from_contact_id" UUID REFERENCES "contacts"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "direct_ledger_entries" ADD COLUMN "to_contact_id" UUID REFERENCES "contacts"("id") ON DELETE RESTRICT`,
    );

    // 3. Replace the same-user distinctness check with a same-kind check.
    await queryRunner.query(
      `ALTER TABLE "direct_ledger_entries" DROP CONSTRAINT IF EXISTS "chk_dle_distinct_parties"`,
    );
    await queryRunner.query(`
      ALTER TABLE "direct_ledger_entries" ADD CONSTRAINT "chk_dle_distinct_parties" CHECK (
        ("from_user_id" IS NULL OR "to_user_id" IS NULL OR "from_user_id" <> "to_user_id") AND
        ("from_contact_id" IS NULL OR "to_contact_id" IS NULL OR "from_contact_id" <> "to_contact_id")
      )
    `);

    // 4. Exactly one identity per side (User XOR Contact).
    await queryRunner.query(`
      ALTER TABLE "direct_ledger_entries" ADD CONSTRAINT "chk_dle_from_identity" CHECK (
        ("from_user_id" IS NOT NULL AND "from_contact_id" IS NULL) OR
        ("from_user_id" IS NULL AND "from_contact_id" IS NOT NULL)
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "direct_ledger_entries" ADD CONSTRAINT "chk_dle_to_identity" CHECK (
        ("to_user_id" IS NOT NULL AND "to_contact_id" IS NULL) OR
        ("to_user_id" IS NULL AND "to_contact_id" IS NOT NULL)
      )
    `);

    // 5. Indexes mirroring the existing from/to user indexes.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_dle_from_contact" ON "direct_ledger_entries" ("from_contact_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_dle_to_contact" ON "direct_ledger_entries" ("to_contact_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Guard: refuse to roll back if Contact-backed rows exist — restoring the
    // User FK NOT NULL would otherwise require deleting financial history, which
    // this migration must never do silently.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "direct_ledger_entries"
          WHERE "from_contact_id" IS NOT NULL OR "to_contact_id" IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'Cannot roll back AddDirectLedgerContactIdentity: Contact-backed direct_ledger_entries exist. Handle those rows before restoring NOT NULL.';
        END IF;
      END $$;
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dle_to_contact"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dle_from_contact"`);
    await queryRunner.query(
      `ALTER TABLE "direct_ledger_entries" DROP CONSTRAINT IF EXISTS "chk_dle_to_identity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "direct_ledger_entries" DROP CONSTRAINT IF EXISTS "chk_dle_from_identity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "direct_ledger_entries" DROP CONSTRAINT IF EXISTS "chk_dle_distinct_parties"`,
    );
    await queryRunner.query(
      `ALTER TABLE "direct_ledger_entries" ADD CONSTRAINT "chk_dle_distinct_parties" CHECK ("from_user_id" <> "to_user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "direct_ledger_entries" DROP COLUMN IF EXISTS "to_contact_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "direct_ledger_entries" DROP COLUMN IF EXISTS "from_contact_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "direct_ledger_entries" ALTER COLUMN "to_user_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "direct_ledger_entries" ALTER COLUMN "from_user_id" SET NOT NULL`,
    );
  }
}
