import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attachment } from '@finmate/data-models';
import { DOCUMENT_EXTRACTION_ENGINE } from './engine/document-extraction-engine.types';
import { StubDocumentExtractionEngine } from './engine/stub-document-extraction-engine';
import { CLASSIFICATION_ENGINE } from './engine/classification-engine.types';
import { RuleBasedClassificationEngine } from './engine/rule-based-classification-engine';
import { DocumentIntakeController } from './intake/document-intake.controller';
import { DocumentIntakeService } from './intake/document-intake.service';
import { DocumentIntelligenceEnabledGuard } from './intake/document-intelligence-enabled.guard';

/**
 * Document Intelligence module.
 *
 * DOC-0 — binds the two stable, replaceable contracts via DI tokens (a consumer
 * injects the interface, never a concrete engine):
 *   - DOCUMENT_EXTRACTION_ENGINE → StubDocumentExtractionEngine (extracts nothing)
 *   - CLASSIFICATION_ENGINE      → RuleBasedClassificationEngine (DOC-5 shared taxonomy)
 * A future on-device OCR / text-PDF / vision extractor or rule-based classifier
 * replaces the `useClass` here with zero change to any consumer.
 *
 * DOC-1 — adds the intake boundary (TOTAL_ONLY vs ITEMIZED) over the EXISTING
 * attachment infrastructure: an owner-scoped, flag-gated (`document.intelligence`,
 * default OFF) endpoint that either skips extraction (TOTAL_ONLY) or invokes the
 * engine (ITEMIZED → stub's explicit unavailable). No new table/migration (the mode
 * is request-level), no finance write, no server-side decryption, no OCR.
 * `TypeOrmModule.forFeature([Attachment])` reuses the existing entity for the
 * ownership check only.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Attachment])],
  controllers: [DocumentIntakeController],
  providers: [
    { provide: DOCUMENT_EXTRACTION_ENGINE, useClass: StubDocumentExtractionEngine },
    { provide: CLASSIFICATION_ENGINE, useClass: RuleBasedClassificationEngine },
    DocumentIntakeService,
    DocumentIntelligenceEnabledGuard,
  ],
  exports: [DOCUMENT_EXTRACTION_ENGINE, CLASSIFICATION_ENGINE],
})
export class DocumentIntelligenceModule {}
