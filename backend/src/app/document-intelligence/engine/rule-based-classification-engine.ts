import { classifyLabel } from '@finmate/data-models';
import {
  CLASSIFICATION_CONTRACT_VERSION,
  ClassificationCapabilities,
  ClassificationEngine,
  ClassificationInput,
  ClassificationResult,
} from './classification-engine.types';

/**
 * DOC-5 deterministic rule-based classifier — the first real ClassificationEngine
 * behind the stable DOC-0 contract (stub → rule_based → future model/population, no
 * contract change). It classifies against the SHARED canonical taxonomy
 * (`@finmate/data-models`) using only the MINIMIZED input the contract allows
 * (`itemLabel`, `category`) — never E2EE title/description, never keys/PII. Output is
 * advisory INFERRED candidates; `confidence` is match certainty, NOT financial
 * correctness, and classification never mutates finance data. No ML, no external call,
 * no persistence.
 */
export class RuleBasedClassificationEngine implements ClassificationEngine {
  readonly name = 'rule_based';
  readonly version = '1.0.0';
  readonly contractVersion = CLASSIFICATION_CONTRACT_VERSION;

  capabilities(): ClassificationCapabilities {
    return {
      name: this.name,
      version: this.version,
      contractVersion: this.contractVersion,
      kind: 'rule_based',
      usesExternalProvider: false,
    };
  }

  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    const invalid = !input || (input.itemLabel === undefined && input.category === undefined);
    const base = {
      engine: {
        name: this.name,
        version: this.version,
        contractVersion: this.contractVersion,
        kind: 'rule_based' as const,
      },
      candidatesOnly: true as const,
      generatedAt: new Date().toISOString(),
    };

    if (invalid) {
      return { ...base, status: 'invalid_input', candidateTags: [], warnings: ['No label or category supplied.'] };
    }

    const tags = classifyLabel(input.itemLabel, input.category).map((t) => ({
      tag: t.canonicalName,
      authority: t.authority,
      source: 'rule_based' as const,
      confidence: { score: t.confidence, band: this.band(t.confidence) },
    }));

    return {
      ...base,
      status: 'ok',
      candidateTags: tags,
      warnings: [],
    };
  }

  private band(score: number): 'low' | 'medium' | 'high' {
    return score >= 0.66 ? 'high' : score >= 0.4 ? 'medium' : 'low';
  }
}
