import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group, GroupMember, PublicShare } from '@finmate/data-models';
import { PublicSharesController } from './public-shares.controller';
import { PublicSharesService } from './public-shares.service';

/**
 * PUBLIC-1B — authenticated owner/admin management of group public shares.
 * `Group` is registered so the service can take a `pessimistic_write` lock on the
 * group row (serializing create/regenerate/revoke to keep at most one active
 * share) without any schema change. No anonymous/public route lives here.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PublicShare, GroupMember, Group])],
  controllers: [PublicSharesController],
  providers: [PublicSharesService],
  exports: [PublicSharesService],
})
export class PublicSharesModule {}
