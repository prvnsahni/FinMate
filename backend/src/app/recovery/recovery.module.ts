import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '@finmate/data-models';
import { RecoveryStatusService } from './recovery-status.service';
import { RecoveryRequiredGuard } from './recovery-required.guard';

/**
 * REC-1 enforcement (recovery mandatory before new Class-A E2EE data). Global so
 * any module can apply `RecoveryRequiredGuard` / inject `RecoveryStatusService`
 * without re-importing. Read-only (User) — no schema change, no migration.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [RecoveryStatusService, RecoveryRequiredGuard],
  exports: [RecoveryStatusService, RecoveryRequiredGuard],
})
export class RecoveryModule {}
