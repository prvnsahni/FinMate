import { Module } from '@nestjs/common';
import { TaxonomyController } from './taxonomy.controller';

/**
 * TAG-BATCH-B — exposes the read-only shared DOC-5 canonical taxonomy. No
 * providers/entities: the taxonomy is static code-seeded reference data, so the
 * controller reads it directly. No taxonomy DB table (that is future work).
 */
@Module({
  controllers: [TaxonomyController],
})
export class TaxonomyModule {}
