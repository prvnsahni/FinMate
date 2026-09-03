/**
 * Classification contract boundary (DOC-0).
 *
 * A SEPARATE, replaceable engine from `DocumentExtractionEngine` (readiness §11/§A7,
 * DOC-0 spec §11–§12). Extraction reads a document; classification proposes candidate
 * tags for an item. They are decoupled so either can be replaced independently:
 *
 *   DocumentExtractionEngine → normalized result → ClassificationEngine → candidate tags
 *
 * DOC-0 defines the contract and a safe stub ONLY. It implements NO automatic tag
 * generation, NO global/dynamic taxonomy, NO tag persistence, NO governance, NO ML /
 * population learning — those belong to later DOC batches. Candidate tags are never
 * persisted here.
 *
 * PRIVACY (readiness §A7/§18): the classifier receives a MINIMIZED, non-sensitive
 * descriptor only — never raw E2EE free-text, encryption keys, tokens, or PII. Note a
 * derived tag can itself be sensitive; storage/persistence is a later, classified,
 * counsel-reviewed decision — not part of this contract.
 */

import {
  ExtractionAuthority,
  FieldConfidence,
} from './document-extraction-engine.types';

/** Bump on a breaking change to this contract. */
export const CLASSIFICATION_CONTRACT_VERSION = '1.0.0';

export type ClassificationEngineKind =
  | 'stub'
  | 'rule_based'
  | 'population'
  | 'model';

export type ClassificationStatus = 'ok' | 'unsupported' | 'invalid_input';

/**
 * A proposed tag. NOT persisted in DOC-0. `authority` reuses the extraction authority
 * scale so a USER_CONFIRMED tag always outranks an INFERRED one.
 */
export interface CandidateTag {
  /** Canonical label candidate (e.g. 'dairy'). No taxonomy identity is assigned yet. */
  tag: string;
  authority: ExtractionAuthority;
  source: ClassificationEngineKind;
  confidence?: FieldConfidence;
}

/**
 * Minimized classification input. Only coarse, user-visible/Zone-2 signals — never
 * raw E2EE free-text, keys, or PII.
 */
export interface ClassificationInput {
  /** Short item label the user already sees (may be omitted). */
  itemLabel?: string;
  /** Coarse user-supplied category (Zone-2, server-readable today). */
  category?: string;
  currency?: string;
}

export interface ClassificationResult {
  engine: {
    name: string;
    version: string;
    contractVersion: string;
    kind: ClassificationEngineKind;
  };
  status: ClassificationStatus;
  /** Proposed tags — candidates only, never persisted by this contract. */
  candidateTags: CandidateTag[];
  warnings: string[];
  readonly candidatesOnly: true;
  generatedAt: string;
}

export interface ClassificationCapabilities {
  name: string;
  version: string;
  contractVersion: string;
  kind: ClassificationEngineKind;
  /** MUST be false unless routed through the AI Firewall. DOC-0 stub: false. */
  usesExternalProvider: boolean;
}

/** Stable classification interface. The only surface a consumer may depend on. */
export interface ClassificationEngine {
  readonly name: string;
  readonly version: string;
  readonly contractVersion: string;
  classify(input: ClassificationInput): Promise<ClassificationResult>;
  capabilities(): ClassificationCapabilities;
}

/** DI token so the concrete classifier can be swapped without touching any consumer. */
export const CLASSIFICATION_ENGINE = Symbol('CLASSIFICATION_ENGINE');
