import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CustomTag,
  GroupKeyVersion,
  GroupMember,
} from '@finmate/data-models';
import {
  CustomTagsController,
  GroupCustomTagsController,
} from './custom-tags.controller';
import { CustomTagsService } from './custom-tags.service';

/**
 * TAG-BATCH-C2 — custom-tag management (personal + group). CRUD + authorization
 * only; no filtering/analytics/export (C3), classifier (C4) or governance (C5).
 * The canonical taxonomy stays in `TaxonomyModule` (read-only) and is not
 * touched here.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CustomTag, GroupMember, GroupKeyVersion]),
  ],
  controllers: [CustomTagsController, GroupCustomTagsController],
  providers: [CustomTagsService],
  exports: [CustomTagsService],
})
export class CustomTagsModule {}
