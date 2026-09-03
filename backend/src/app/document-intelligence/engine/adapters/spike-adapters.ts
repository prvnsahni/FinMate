import {
  AdapterContent,
  AdapterExtraction,
  AdapterKind,
  AdapterRequirement,
  ExtractionAdapter,
} from './extraction-adapter.types';

/**
 * DOC-2 spike adapters — architecture only, NO extraction.
 *
 * No OCR/PDF/rasterizer package is installed (root deps: only `xlsx`). Each adapter
 * therefore returns an explicit `provider_unavailable` with empty payloads — it never
 * fabricates a value — and declares the package(s) a real implementation would need,
 * so the engine wiring, source detection, and reconciliation mapping can be verified
 * today and a real adapter can drop in later without touching the engine or consumers.
 */
abstract class BaseSpikeAdapter implements ExtractionAdapter {
  abstract readonly kind: AdapterKind;
  abstract readonly requirement: AdapterRequirement;

  async extract(_content: AdapterContent): Promise<AdapterExtraction> {
    return {
      status: 'provider_unavailable',
      warnings: [
        `DOC-2 spike: the ${this.kind} adapter has no extraction provider wired ` +
          `(requires ${this.requirement.requiredPackages.join(', ') || 'a provider'}). No value is fabricated.`,
      ],
      unresolvedFields: ['header', 'lineItems'],
    };
  }
}

/** Image OCR adapter (image/jpeg, image/png, …). Candidate: on-device WASM OCR. */
export class ImageExtractionAdapter extends BaseSpikeAdapter {
  readonly kind = 'image' as const;
  readonly requirement: AdapterRequirement = {
    requiredPackages: ['tesseract.js'],
    processesLocally: true,
    note: 'On-device WASM OCR candidate — bytes stay in-process; no external call.',
  };
}

/** Text-PDF adapter — direct text/table extraction from the PDF text layer. */
export class PdfTextExtractionAdapter extends BaseSpikeAdapter {
  readonly kind = 'pdf_text' as const;
  readonly requirement: AdapterRequirement = {
    requiredPackages: ['pdfjs-dist (or pdf-parse)'],
    processesLocally: true,
    note: 'Local text-layer + table extraction candidate — highest accuracy, no OCR.',
  };
}

/** Scanned-PDF adapter — render pages to images, then OCR. */
export class PdfScanExtractionAdapter extends BaseSpikeAdapter {
  readonly kind = 'pdf_scanned' as const;
  readonly requirement: AdapterRequirement = {
    requiredPackages: [
      'pdfjs-dist',
      'a rasterizer (node-canvas/@napi-rs/canvas)',
      'tesseract.js',
    ],
    processesLocally: true,
    note: 'Render pages then on-device OCR — heaviest path; used only when no text layer.',
  };
}

/** Default adapter set used by the LocalDocumentExtractionEngine spike. */
export function defaultSpikeAdapters(): Record<AdapterKind, ExtractionAdapter> {
  return {
    image: new ImageExtractionAdapter(),
    pdf_text: new PdfTextExtractionAdapter(),
    pdf_scanned: new PdfScanExtractionAdapter(),
  };
}
