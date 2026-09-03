import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TAG-BATCH-C1 — custom-tag definition layer (personal + group), E2EE names.
 *
 * Purely ADDITIVE and REVERSIBLE:
 *  - creates ONE new table `custom_tags` (the definition/naming layer). The tag
 *    NAME is stored ONLY as client-produced ciphertext in `encrypted_name`
 *    (same format as `expense.title`); the server never decrypts it and there is
 *    NO plaintext/normalized/hash/search companion column;
 *  - adds ONE additive discriminator column `tag_scope` to the existing
 *    `expense_tags` assignment table, defaulting to `'global'` so every existing
 *    (canonical) assignment stays valid — **no historical backfill**, no data
 *    decrypted/transformed, no financial column touched, no second assignment or
 *    taxonomy table created;
 *  - scope invariant enforced by a CHECK (personal ⇒ owner set/group null;
 *    group ⇒ group set/owner null);
 *  - FK delete behaviour is safe: owner/group delete removes their custom-tag
 *    DEFINITIONS (`ON DELETE CASCADE`) but never touches `expense_tags` (which
 *    reference the tag by opaque id string, not a FK), so an expense's record is
 *    never corrupted; creator + key-version references are `ON DELETE SET NULL`.
 *  down() drops the added column then the table.
 */
export class AddCustomTags1720200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "custom_tags" (
        "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "scope_type" VARCHAR(20) NOT NULL,
        "owner_user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
        "group_id" UUID REFERENCES "groups"("id") ON DELETE CASCADE,
        "created_by_user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
        "group_key_version_id" UUID REFERENCES "group_key_versions"("id") ON DELETE SET NULL,
        "encrypted_name" TEXT NOT NULL,
        "status" VARCHAR(20) NOT NULL DEFAULT 'active',
        "version" INTEGER NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ,
        CONSTRAINT "chk_custom_tags_scope" CHECK (
          ("scope_type" = 'personal' AND "owner_user_id" IS NOT NULL AND "group_id" IS NULL) OR
          ("scope_type" = 'group' AND "group_id" IS NOT NULL AND "owner_user_id" IS NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_custom_tags_owner" ON "custom_tags" ("owner_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_custom_tags_group" ON "custom_tags" ("group_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_custom_tags_scope_status" ON "custom_tags" ("scope_type", "status")`,
    );

    // Additive discriminator on the existing assignment table. Existing rows are
    // all canonical, so DEFAULT 'global' is their true scope (not a fabricated
    // backfill). The existing unique(expense_id, tag_id) + tag_id index are
    // unchanged and continue to serve both canonical and custom filtering.
    await queryRunner.query(
      `ALTER TABLE "expense_tags" ADD COLUMN IF NOT EXISTS "tag_scope" VARCHAR(20) NOT NULL DEFAULT 'global'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "expense_tags" DROP COLUMN IF EXISTS "tag_scope"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_tags"`);
  }
}
