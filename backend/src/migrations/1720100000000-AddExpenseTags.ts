import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TAG-BATCH-A — adds the `expense_tags` table: confirmed DOC-5 taxonomy tags
 * persisted against an expense as descriptive, server-readable Zone-2 metadata
 * (the same classification as the existing plaintext `expenses.category`).
 *
 * Purely additive and reversible:
 *  - creates ONE new table; touches NO existing table or column (no change to
 *    any financial column, so FIN-002 is unaffected);
 *  - NO backfill — existing expenses stay valid with zero tags; no historical
 *    tags are fabricated;
 *  - `expense_id` FK is `ON DELETE CASCADE`, so hard-deleting an expense (e.g. a
 *    draft) removes its tags — no orphans. A posted expense is soft-deleted, so
 *    its rows remain with the still-present expense row and survive restore;
 *  - `created_by_user_id` is `ON DELETE SET NULL` (provenance is best-effort);
 *  - a unique `(expense_id, tag_id)` index enforces one row per tag per expense
 *    and serves the eventual (Batch B) filter; `tag_id` alone is indexed for
 *    "all expenses carrying tag X". down() drops the table.
 */
export class AddExpenseTags1720100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "expense_tags" (
        "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "expense_id" UUID NOT NULL REFERENCES "expenses"("id") ON DELETE CASCADE,
        "tag_id" VARCHAR(64) NOT NULL,
        "authority" VARCHAR(20) NOT NULL,
        "source" VARCHAR(20) NOT NULL,
        "confidence" DECIMAL(4, 3),
        "taxonomy_version" INTEGER NOT NULL,
        "created_by_user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at" TIMESTAMPTZ DEFAULT now() NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_expense_tags_expense_tag" ON "expense_tags" ("expense_id", "tag_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_expense_tags_tag" ON "expense_tags" ("tag_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "expense_tags"`);
  }
}
