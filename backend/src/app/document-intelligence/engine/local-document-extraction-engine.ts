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
  AdapterKind,
  ExtractionAdapter,
} from './adapters/extraction-adapter.types';
import {
  SourceSignals,
  detectSourceType,
  selectAdapterKind,
} from './adapters/document-source-detector';
import { defaultSpikeAdapters } from './adapters/spike-adapters';

const ACCEPTED_INPUT: DocumentSourceType[] = ['image', 'pdf'];

/**
 * DOC-2 spike engine. Demonstrates the full replaceable architecture behind the
 * unchanged DOC-0 `DocumentExtractionEngine` contract:
 *
 *   input → source detection → adapter (image | pdf_text | pdf_scanned) → normalized
 *         → (when a total + items exist) computeReconciliation → DocumentExtractionResult
 *
 * The adapters are injected (defaulting to the spike stubs, which return
 * `provider_unavailable` because no OCR/PDF package is installed). It calls no
 * external service, never decrypts, never writes finance data, and never fabricates
 * values. It is NOT yet bound in the module — the stub remains the active engine
 * until a provider/package is approved; this engine is the ready-to-bind artifact.
 */
export class LocalDocumentExtractionEngine implements DocumentExtractionEngine {
  readonly name = 'local';
  readonly version = '0.1.0-spike';
  readonly contractVersion = DOCUMENT_EXTRACTION_CONTRACT_VERSION;

  constructor(
    private readonly adapters: Record<AdapterKind, ExtractionAdapter> = defaultSpikeAdapters(),
  ) {}

  capabilities(): DocumentExtractionCapabilities {
    return {
      name: this.name,
      version: this.version,
      contractVersion: this.contractVersion,
      kind: 'local_ocr',
      supportedInputTypes: [...ACCEPTED_INPUT],
      // No family is claimed until a real adapter is wired.
      supportedFamilies: [],
      // The architecture supports these once a provider exists.
      supportsLineItems: true,
      supportsReconciliation: true,
      supportsStatementTransactions: false,
      // All candidate adapters are on-device-first: no external provider.
      usesExternalProvider: false,
    };
  }

  /**
   * @param input Minimized document input (opaque ref + coarse metadata).
   * @param signals Optional probe signals (e.g. pdfHasTextLayer) a real engine derives.
   */
  async extract(
    input: DocumentExtractionInput,
    signals: SourceSignals = {},
  ): Promise<DocumentExtractionResult> {
    if (
      !input ||
      typeof input.documentRef !== 'string' ||
      input.documentRef.length === 0 ||
      typeof input.mimeType !== 'string' ||
      !ACCEPTED_INPUT.includes(input.sourceType)
    ) {
      return this.envelope(input?.sourceType ?? 'unknown', 'invalid_input', {
        warnings: ['Invalid or unsupported document input for extraction.'],
      });
    }

    const kind = selectAdapterKind(input, signals);
    if (kind === 'none') {
      return this.envelope(detectSourceType(input.mimeType), 'unsupported_document', {
        warnings: ['No extraction adapter matches this input.'],
      });
    }

    const adapter = this.adapters[kind];
    const out = await adapter.extract(input);

    // Map the adapter output onto the DOC-0 result. Reconciliation runs ONLY when a
    // document total and line items are both present — it surfaces the difference and
    // never alters values (FIN-002).
    const total = out.header?.total?.value;
    const reconciliation =
      typeof total === 'number' && out.lineItems && out.lineItems.length > 0
        ? computeReconciliation(
            total,
            out.lineItems.map((li) => li.lineTotal?.value),
          )
        : undefined;

    return {
      engine: {
        name: this.name,
        version: this.version,
        contractVersion: this.contractVersion,
        kind: 'local_ocr',
      },
      status: out.status,
      documentFamily: 'unknown',
      sourceType: input.sourceType,
      ...(out.header ? { header: out.header } : {}),
      ...(out.lineItems ? { lineItems: out.lineItems } : {}),
      ...(reconciliation ? { reconciliation } : {}),
      warnings: out.warnings,
      unresolvedFields: out.unresolvedFields,
      candidatesOnly: true,
      generatedAt: new Date().toISOString(),
    };
  }

  private envelope(
    sourceType: DocumentSourceType,
    status: ExtractionStatus,
    extra: { warnings?: string[] },
  ): DocumentExtractionResult {
    return {
      engine: {
        name: this.name,
        version: this.version,
        contractVersion: this.contractVersion,
        kind: 'local_ocr',
      },
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
