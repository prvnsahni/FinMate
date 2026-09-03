import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PUBLIC-1A — public read-only group sharing: capability boundary only.
 *
 * Purely ADDITIVE and REVERSIBLE:
 *  - creates ONE new table `public_shares` holding a group owner/admin's opt-in
 *    public share of ONE group. It stores ONLY a token HASH + lifecycle — NO
 *    raw token, NO name/email/phone/user-id/member-id, NO amount/balance, NO
 *    E2EE ciphertext, NO key/key-version, and NO expense/settlement data (the
 *    public projection is built at read time from the authoritative balance
 *    calculation; nothing financial is duplicated here);
 *  - `token_hash` is UNIQUE + indexed (`sha256(token)` hex) so the raw token is
 *    never persisted and lookups are by hash;
 *  - FK delete behaviour is safe: deleting the group CASCADEs the share (a share
 *    never outlives its group); deleting the creator only SET NULLs provenance —
 *    it never deletes the share or the group;
 *  - no existing table/column is changed, no backfill, no finance column, no
 *    E2EE data. Public sharing is OFF by default (no row until explicitly created).
 *  down() drops the table.
 */
export class AddPublicShares1720300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "public_shares" (
        "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "group_id" UUID NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
        "created_by_user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
        "token_hash" VARCHAR(64) NOT NULL,
        "status" VARCHAR(20) NOT NULL DEFAULT 'active',
        "expires_at" TIMESTAMPTZ,
        "version" INTEGER NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "revoked_at" TIMESTAMPTZ,
        CONSTRAINT "uq_public_shares_token_hash" UNIQUE ("token_hash")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_public_shares_group" ON "public_shares" ("group_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "public_shares"`);
  }
}
