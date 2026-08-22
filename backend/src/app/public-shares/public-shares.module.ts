import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Expense, Group, GroupMember, PublicShare } from '@finmate/data-models';
import { PublicSharesController } from './public-shares.controller';
import { PublicSharesService } from './public-shares.service';
import { PublicProjectionController } from './public-projection.controller';
import { PublicProjectionService } from './public-projection.service';
import { SettlementsModule } from '../settlements/settlements.module';

/**
 * PUBLIC-1B — authenticated owner/admin management of group public shares
 * (`Group` registered so the service can take a `pessimistic_write` lock on the
 * group row to keep at most one active share without a schema change).
 *
 * PUBLIC-1C — the ANONYMOUS read-only projection controller/service. It imports
 * `SettlementsModule` to reuse the ONLY authoritative balance calculator
 * (`SettlementsService.calculateGroupBalances`) — no second calculator — and the
 * `Expense` repo for the descriptive (no-math) entry list. `FeatureFlagsService`
 * (default-OFF `public.groupShare`) comes from the global `PlatformModule`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PublicShare, GroupMember, Group, Expense]),
    SettlementsModule,
  ],
  controllers: [PublicSharesController, PublicProjectionController],
  providers: [PublicSharesService, PublicProjectionService],
  exports: [PublicSharesService],
})
export class PublicSharesModule {}
