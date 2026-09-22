import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `settlements.recorded_by_user_id` — the registered user who recorded a
 * settlement. Needed for the one-step "record a cash payment" path with a
 * non-registered (Contact-backed) member, where the recorder may be a group
 * admin who is neither the `from` nor the `to` party. Additive and nullable;
 * existing rows are untouched (legacy settlements simply have NULL here).
 */
export class AddSettlementRecordedBy1720500000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "recorded_by_user_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" ADD CONSTRAINT "FK_settlements_recorded_by_user" ` +
        `FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "settlements" DROP CONSTRAINT IF EXISTS "FK_settlements_recorded_by_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "settlements" DROP COLUMN IF EXISTS "recorded_by_user_id"`,
    );
  }
}
