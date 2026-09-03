import {
  DOCUMENT_EXTRACTION_CONTRACT_VERSION,
  DocumentExtractionCapabilities,
  DocumentExtractionEngine,
  DocumentExtractionInput,
  DocumentExtractionResult,
  DocumentSourceType,
  ExtractionStatus,
} from './document-extraction-engine.types';
import { computeReconciliation } from './reconciliation';
import {
  AdapterContent,
  AdapterKind,
  ExtractionAdapter,
} from './adapters/extraction-adapter.types';
import {
  SourceSignals,
  detectSourceType,
  selectAdapterKind,
} from './adapters/document-source-detector';
import { defaultLocalAdapters } from './adapters/local-adapters';

const ACCEPTED_INPUT: DocumentSourceType[] = ['image', 'pdf'];

/**
 * DOC-3 local extraction engine. Real on-device adapters (pdfjs-dist text, tesseract
 * image, scanned-PDF boundary) behind the UNCHANGED DOC-0 contract:
 *
 *   content → source detection → adapter → normalized → (total+items) reconciliation
 *
 * Two surfaces:
 *  - `extract(input)` (DOC-0 interface): the production path receives only an OPAQUE
 *    reference, never bytes. For E2EE attachments the server has no plaintext, so this
 *    path cannot supply content and returns an explicit result — it never decrypts or
 *    resolves the reference (DOC-3 §13 boundary).
 *  - `extractFromContent(content)` (spike): operates ONLY on bytes explicitly supplied
 *    (fixtures/tests), routes to the matching real adapter, and reconciles totals.
 *
 * Calls no external service (`usesExternalProvider=false`), never mutates finance data,
 * never fabricates values. NOT bound in the module (the stub stays the active engine).
 */
export class LocalDocumentExtractionEngine implements DocumentExtractionEngine {
  readonly name = 'local';
  readonly version = '0.2.0-spike';
  readonly contractVersion = DOCUMENT_EXTRACTION_CONTRACT_VERSION;

  constructor(
    private readonly adapters: Record<
      AdapterKind,
      ExtractionAdapter
    > = defaultLocalAdapters(),
  ) {}

  capabilities(): DocumentExtractionCapabilities {
    return {
      name: this.name,
      version: this.version,
      contractVersion: this.contractVersion,
      kind: 'local_ocr',
      supportedInputTypes: [...ACCEPTED_INPUT],
      supportedFamilies: [],
      supportsLineItems: true,
      supportsReconciliation: true,
      supportsStatementTransactions: false,
      usesExternalProvider: false,
    };
  }

  /**
   * DOC-0 interface path. Receives an opaque reference only — no bytes. The server
   * cannot resolve E2EE plaintext here, so no extraction is performed and nothing is
   * decrypted. Use `extractFromContent` with explicitly-supplied bytes for the spike.
   */
  async extract(
    input: DocumentExtractionInput,
  ): Promise<DocumentExtractionResult> {
    return this.envelope(
      ACCEPTED_INPUT.includes(input?.sourceType) ? input.sourceType : 'unknown',
      'invalid_input',
      {
        warnings: [
          'No document content supplied. This engine extracts only from bytes handed to ' +
            'extractFromContent(); it never resolves/decrypts an attachment reference (E2EE boundary).',
        ],
      },
    );
  }

  /**
   * Spike extraction over explicitly-supplied content.
   * @param content Document bytes + mimeType + sourceType (from a fixture/test).
   * @param signals Optional probe signals (e.g. pdfHasTextLayer) for routing.
   */
  async extractFromContent(
    content: AdapterContent,
    signals: SourceSignals = {},
  ): Promise<DocumentExtractionResult> {
    if (
      !content ||
      !(content.bytes instanceof Uint8Array) ||
      content.bytes.length === 0 ||
      !ACCEPTED_INPUT.includes(content.sourceType)
    ) {
      return this.envelope(content?.sourceType ?? 'unknown', 'invalid_input', {
        warnings: ['Invalid or empty document content.'],
      });
    }

    const kind = selectAdapterKind(
      { mimeType: content.mimeType, sourceType: content.sourceType },
      signals,
    );
    if (kind === 'none') {
      return this.envelope(
        detectSourceType(content.mimeType),
        'unsupported_document',
        {
          warnings: ['No extraction adapter matches this input.'],
        },
      );
    }

    const out = await this.adapters[kind].extract(content);

    const total = out.header?.total?.value;
    const reconciliation =
      typeof total === 'number' && out.lineItems && out.lineItems.length > 0
        ? computeReconciliation(
            total,
            out.lineItems.map((li) => li.lineTotal?.value),
          )
        : undefined;

    return {
      engine: this.engineInfo(),
      status: out.status,
      documentFamily: 'unknown',
      sourceType: content.sourceType,
      ...(out.header ? { header: out.header } : {}),
      ...(out.lineItems ? { lineItems: out.lineItems } : {}),
      ...(reconciliation ? { reconciliation } : {}),
      warnings: out.warnings,
      unresolvedFields: out.unresolvedFields,
      candidatesOnly: true,
      generatedAt: new Date().toISOString(),
    };
  }

  private engineInfo() {
    return {
      name: this.name,
      version: this.version,
      contractVersion: this.contractVersion,
      kind: 'local_ocr' as const,
    };
  }

  private envelope(
    sourceType: DocumentSourceType,
    status: ExtractionStatus,
    extra: { warnings?: string[] },
  ): DocumentExtractionResult {
    return {
      engine: this.engineInfo(),
      status,
      documentFamily: 'unknown',
      sourceType,
      warnings: extra.warnings ?? [],
      unresolvedFields: [],
      candidatesOnly: true,
      generatedAt: new Date().toISOString(),
    };
  }
}
