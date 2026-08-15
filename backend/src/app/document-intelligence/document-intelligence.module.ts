import { Module } from '@nestjs/common';
import { DOCUMENT_EXTRACTION_ENGINE } from './engine/document-extraction-engine.types';
import { StubDocumentExtractionEngine } from './engine/stub-document-extraction-engine';
import { CLASSIFICATION_ENGINE } from './engine/classification-engine.types';
import { StubClassificationEngine } from './engine/stub-classification-engine';

/**
 * Document Intelligence foundation (DOC-0).
 *
 * Binds the two stable, replaceable contracts via DI tokens and exports them so a
 * future consumer (DOC-1+) can inject the interface — never a concrete engine:
 *   - DOCUMENT_EXTRACTION_ENGINE → StubDocumentExtractionEngine (extracts nothing)
 *   - CLASSIFICATION_ENGINE      → StubClassificationEngine      (classifies nothing)
 *
 * A future on-device OCR / text-PDF / vision extractor or a rule-based / population
 * classifier replaces the `useClass` here with zero change to any consumer.
 *
 * DOC-0 scope: contract + stub only. No controller, no entity, no migration, no
 * external provider, no finance write, no taxonomy persistence. This module is not
 * yet registered in AppModule — nothing consumes it until DOC-1.
 */
@Module({
  providers: [
    { provide: DOCUMENT_EXTRACTION_ENGINE, useClass: StubDocumentExtractionEngine },
    { provide: CLASSIFICATION_ENGINE, useClass: StubClassificationEngine },
  ],
  exports: [DOCUMENT_EXTRACTION_ENGINE, CLASSIFICATION_ENGINE],
})
export class DocumentIntelligenceModule {}
