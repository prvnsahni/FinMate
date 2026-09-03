import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BATCH-11 Goals-v2. Additive/safe, transaction-safe, reversible while the table
 * is empty. Goals has had no write path, so no rows are expected — but this
 * migration performs NO plaintext backfill, NO server-side decryption, and
 * fabricates NO ciphertext for any pre-existing row.
 *
 * Changes:
 *  - title VARCHAR(160) → TEXT  (born-E2EE ciphertext no longer fits 160 chars)
 *  - add "encrypted_content_key" TEXT NULL  (owner's RSA-wrapped per-goal content
 *    key; DTO requires it on create so every new goal is born-E2EE)
 *  - add "priority" INTEGER NOT NULL DEFAULT 0  (deterministic ordering)
 */
export class AddGoalsV2Fields1720000000000 implements MigrationInterface {
  name = 'AddGoalsV2Fields1720000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "goals" ALTER COLUMN "title" TYPE TEXT`,
    );
    await queryRunner.query(
      `ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "encrypted_content_key" TEXT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "goals" DROP COLUMN IF EXISTS "priority"`,
    );
    await queryRunner.query(
      `ALTER TABLE "goals" DROP COLUMN IF EXISTS "encrypted_content_key"`,
    );
    // Safe to revert to VARCHAR(160) only while empty (born-E2EE ciphertext would
    // exceed 160). Goals has no write path pre-BATCH-11, so this is reversible.
    await queryRunner.query(
      `ALTER TABLE "goals" ALTER COLUMN "title" TYPE VARCHAR(160)`,
    );
  }
}
