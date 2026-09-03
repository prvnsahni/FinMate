import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Goal } from '@finmate/data-models';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';
import { GoalsEnabledGuard } from './goals-enabled.guard';
import { GOAL_ENGINE } from './engine/goal-engine.types';
import { DeterministicGoalEngine } from './engine/deterministic-goal-engine';

/**
 * Goals-v2 (BATCH-11 / W-GOAL-01..03). Owner-scoped, born-E2EE goals + the
 * deterministic Goal Engine bound via the stable GOAL_ENGINE token — a future
 * model/population engine can replace it without touching the controller/API.
 * FeatureFlagsService (PlatformModule) and RecoveryStatusService (RecoveryModule)
 * are global.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Goal])],
  controllers: [GoalsController],
  providers: [
    GoalsService,
    GoalsEnabledGuard,
    { provide: GOAL_ENGINE, useClass: DeterministicGoalEngine },
  ],
})
export class GoalsModule {}
