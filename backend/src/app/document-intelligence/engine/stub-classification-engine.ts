import {
  CLASSIFICATION_CONTRACT_VERSION,
  ClassificationCapabilities,
  ClassificationEngine,
  ClassificationInput,
  ClassificationResult,
} from './classification-engine.types';

/**
 * DOC-0 safe stub `ClassificationEngine`.
 *
 * It returns an explicit `unsupported` result with NO candidate tags. It NEVER:
 * generates tags, consults or creates a taxonomy, persists anything, calls AI, or
 * touches the network. It exists only to lock the contract so a future rule-based /
 * population / model classifier can replace it through the `CLASSIFICATION_ENGINE`
 * token without any consumer change.
 */
export class StubClassificationEngine implements ClassificationEngine {
  readonly name = 'stub';
  readonly version = '0.0.0';
  readonly contractVersion = CLASSIFICATION_CONTRACT_VERSION;

  capabilities(): ClassificationCapabilities {
    return {
      name: this.name,
      version: this.version,
      contractVersion: this.contractVersion,
      kind: 'stub',
      usesExternalProvider: false,
    };
  }

  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    const invalid =
      !input || (input.itemLabel === undefined && input.category === undefined);
    return {
      engine: {
        name: this.name,
        version: this.version,
        contractVersion: this.contractVersion,
        kind: 'stub',
      },
      status: invalid ? 'invalid_input' : 'unsupported',
      candidateTags: [],
      warnings: [
        'DOC-0 stub: classification is not implemented. No taxonomy, tagging, or learning is wired.',
      ],
      candidatesOnly: true,
      generatedAt: new Date().toISOString(),
    };
  }
}
