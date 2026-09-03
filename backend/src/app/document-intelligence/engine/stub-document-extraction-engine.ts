import {
  DOCUMENT_EXTRACTION_CONTRACT_VERSION,
  DocumentExtractionCapabilities,
  DocumentExtractionEngine,
  DocumentExtractionInput,
  DocumentExtractionResult,
  DocumentSourceType,
  ExtractionStatus,
} from './document-extraction-engine.types';

/** Input source types the CONTRACT accepts for routing (not families it can extract). */
const ACCEPTED_INPUT_TYPES: DocumentSourceType[] = ['image', 'pdf'];

/**
 * DOC-0 safe stub `DocumentExtractionEngine`.
 *
 * It validates that a well-formed image/PDF input was provided, then returns an
 * explicit `unsupported_document` result. It NEVER: calls OCR, calls AI/vision,
 * touches the network, decrypts anything, mutates finance data, or fabricates any
 * extracted value (no header/lineItems/reconciliation/statement payloads). Its only
 * purpose is to exercise and lock the contract so future real engines can replace it
 * through the `DOCUMENT_EXTRACTION_ENGINE` token without any consumer change.
 */
export class StubDocumentExtractionEngine implements DocumentExtractionEngine {
  readonly name = 'stub';
  readonly version = '0.0.0';
  readonly contractVersion = DOCUMENT_EXTRACTION_CONTRACT_VERSION;

  capabilities(): DocumentExtractionCapabilities {
    return {
      name: this.name,
      version: this.version,
      contractVersion: this.contractVersion,
      kind: 'stub',
      // The contract can route these inputs; the stub still extracts nothing.
      supportedInputTypes: [...ACCEPTED_INPUT_TYPES],
      // No document family is actually supported yet.
      supportedFamilies: [],
      supportsLineItems: false,
      supportsReconciliation: false,
      supportsStatementTransactions: false,
      usesExternalProvider: false,
    };
  }

  async extract(
    input: DocumentExtractionInput,
  ): Promise<DocumentExtractionResult> {
    // Reject malformed / unsupported input explicitly (distinct from "recognised
    // input we simply cannot extract yet").
    if (
      !input ||
      typeof input.documentRef !== 'string' ||
      input.documentRef.length === 0 ||
      typeof input.mimeType !== 'string' ||
      input.mimeType.length === 0 ||
      !ACCEPTED_INPUT_TYPES.includes(input.sourceType)
    ) {
      return this.envelope(input?.sourceType ?? 'unknown', 'invalid_input', {
        warnings: ['Invalid or unsupported document input for extraction.'],
      });
    }

    // Well-formed image/PDF accepted, but DOC-0 wires no extractor. No fabrication.
    return this.envelope(input.sourceType, 'unsupported_document', {
      warnings: [
        'DOC-0 stub: document extraction is not implemented. No OCR/PDF/vision provider is wired.',
      ],
      unresolvedFields: [
        'header',
        'lineItems',
        'reconciliation',
        'statementTransactions',
      ],
    });
  }

  /** Build a result envelope carrying no fabricated payload sections. */
  private envelope(
    sourceType: DocumentSourceType,
    status: ExtractionStatus,
    extra: { warnings?: string[]; unresolvedFields?: string[] },
  ): DocumentExtractionResult {
    return {
      engine: {
        name: this.name,
        version: this.version,
        contractVersion: this.contractVersion,
        kind: 'stub',
      },
      status,
      documentFamily: 'unknown',
      sourceType,
      warnings: extra.warnings ?? [],
      unresolvedFields: extra.unresolvedFields ?? [],
      candidatesOnly: true,
      generatedAt: new Date().toISOString(),
    };
  }
}
