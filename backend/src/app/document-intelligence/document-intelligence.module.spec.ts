import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Attachment } from '@finmate/data-models';
import { DocumentIntelligenceModule } from './document-intelligence.module';
import { PlatformModule } from '../platform/platform.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  DOCUMENT_EXTRACTION_ENGINE,
  DocumentExtractionCapabilities,
  DocumentExtractionEngine,
  DocumentExtractionInput,
  DocumentExtractionResult,
} from './engine/document-extraction-engine.types';
import {
  CLASSIFICATION_ENGINE,
  ClassificationEngine,
} from './engine/classification-engine.types';
import { StubDocumentExtractionEngine } from './engine/stub-document-extraction-engine';
import { RuleBasedClassificationEngine } from './engine/rule-based-classification-engine';

/**
 * Compile the module with infra dependencies satisfied: PlatformModule (@Global)
 * supplies FeatureFlagsService for the enabled-guard, the Attachment repository is
 * mocked (no DB), and JwtAuthGuard is stubbed. The engine token bindings under test
 * are untouched.
 */
const testModule = (): TestingModuleBuilder =>
  Test.createTestingModule({
    imports: [DocumentIntelligenceModule, PlatformModule],
  })
    .overrideProvider(getRepositoryToken(Attachment))
    .useValue({ findOne: jest.fn() })
    .overrideGuard(JwtAuthGuard)
    .useValue({ canActivate: () => true });

describe('DocumentIntelligenceModule (DI / replaceable boundary — test §16)', () => {
  it('binds the stub engines to their tokens by default', async () => {
    const moduleRef = await testModule().compile();

    const extraction = moduleRef.get<DocumentExtractionEngine>(
      DOCUMENT_EXTRACTION_ENGINE,
    );
    const classification = moduleRef.get<ClassificationEngine>(
      CLASSIFICATION_ENGINE,
    );

    expect(extraction).toBeInstanceOf(StubDocumentExtractionEngine);
    expect(classification).toBeInstanceOf(RuleBasedClassificationEngine);
    expect(extraction.name).toBe('stub');
    expect(classification.name).toBe('rule_based');
  });

  it('a consumer resolves the engine by TOKEN, so a future engine can replace the stub', async () => {
    // A fake future engine that satisfies the SAME contract.
    class FakeLocalOcrEngine implements DocumentExtractionEngine {
      readonly name = 'fake-local-ocr';
      readonly version = '9.9.9';
      readonly contractVersion = '1.0.0';
      capabilities(): DocumentExtractionCapabilities {
        return {
          name: this.name,
          version: this.version,
          contractVersion: this.contractVersion,
          kind: 'local_ocr',
          supportedInputTypes: ['image', 'pdf'],
          supportedFamilies: ['grocery_receipt'],
          supportsLineItems: true,
          supportsReconciliation: true,
          supportsStatementTransactions: false,
          usesExternalProvider: false,
        };
      }
      async extract(
        _input: DocumentExtractionInput,
      ): Promise<DocumentExtractionResult> {
        return {
          engine: {
            name: this.name,
            version: this.version,
            contractVersion: this.contractVersion,
            kind: 'local_ocr',
          },
          status: 'ok',
          documentFamily: 'grocery_receipt',
          sourceType: 'image',
          warnings: [],
          unresolvedFields: [],
          candidatesOnly: true,
          generatedAt: '2026-01-01T00:00:00.000Z',
        };
      }
    }

    const moduleRef = await testModule()
      .overrideProvider(DOCUMENT_EXTRACTION_ENGINE)
      .useClass(FakeLocalOcrEngine)
      .compile();

    const engine = moduleRef.get<DocumentExtractionEngine>(
      DOCUMENT_EXTRACTION_ENGINE,
    );
    expect(engine).toBeInstanceOf(FakeLocalOcrEngine);
    expect(engine.name).toBe('fake-local-ocr');
    // The consumer still depends only on the interface — replacement required no consumer change.
    expect(engine.capabilities().supportsLineItems).toBe(true);
  });
});
