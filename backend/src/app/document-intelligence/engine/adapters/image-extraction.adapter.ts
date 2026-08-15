import {
  AdapterContent,
  AdapterExtraction,
  AdapterRequirement,
  ExtractionAdapter,
} from './extraction-adapter.types';
import { parseReceiptText } from './receipt-text-parser';

/** Local OCR provider seam. A real impl wraps tesseract.js configured LOCAL-ONLY. */
export interface OcrRecognizer {
  /** Return recognized text for the image bytes. Must not perform any network call. */
  recognize(bytes: Uint8Array, mimeType: string): Promise<string>;
}

/**
 * Real image adapter (tesseract.js) — but SAFE BY DEFAULT.
 *
 * tesseract.js v7 fetches its core/worker/language data from a CDN by default (a
 * network call) and does NOT ship `eng.traineddata`. To honour the spike's "no
 * external network / on-device only" rule, this adapter:
 *   - checks whether local OCR language data is present (`langDataAvailable`), and
 *   - **refuses to run OCR** (returns `provider_unavailable`) when it is absent,
 *     rather than triggering a CDN download.
 * It only invokes a recognizer when one is injected (tests) or local data exists. It
 * never fabricates values. Wiring a real local recognizer + committing/installing the
 * traineddata asset is a follow-up decision (see the spike doc).
 */
export class ImageExtractionAdapter implements ExtractionAdapter {
  readonly kind = 'image' as const;
  readonly requirement: AdapterRequirement = {
    requiredPackages: ['tesseract.js', 'eng.traineddata (language data — not shipped by the package)'],
    processesLocally: true,
    note: 'On-device WASM OCR. Default fetches language data from a CDN — must be configured local-only.',
  };

  constructor(
    private readonly recognizer?: OcrRecognizer,
    private readonly langDataAvailable: () => boolean = () => false,
  ) {}

  async extract(content: AdapterContent): Promise<AdapterExtraction> {
    if (content.sourceType !== 'image') {
      return { status: 'invalid_input', warnings: ['image adapter requires an image.'], unresolvedFields: [] };
    }

    if (!this.recognizer && !this.langDataAvailable()) {
      return {
        status: 'provider_unavailable',
        warnings: [
          'Local OCR language data (eng.traineddata) is not installed; refusing to fetch it over the network. ' +
            'See FINMATE_DOCUMENT_EXTRACTION_SPIKE.md for the language-data decision.',
        ],
        unresolvedFields: ['header', 'lineItems'],
      };
    }

    let text: string;
    try {
      const recognizer = this.recognizer ?? (await this.localRecognizer());
      text = await recognizer.recognize(content.bytes, content.mimeType);
    } catch {
      return {
        status: 'extraction_failed',
        warnings: ['OCR failed for this image.'],
        unresolvedFields: ['header', 'lineItems'],
      };
    }

    if (!text || text.trim().length === 0) {
      return {
        status: 'no_text_detected',
        warnings: ['OCR produced no text.'],
        unresolvedFields: ['header', 'lineItems'],
      };
    }

    const parsed = parseReceiptText(text, { adapter: 'image' });
    const complete = parsed.header?.total !== undefined && (parsed.lineItems?.length ?? 0) > 0;
    return {
      status: complete ? 'ok' : 'partial_extraction',
      ...(parsed.header ? { header: parsed.header } : {}),
      ...(parsed.lineItems ? { lineItems: parsed.lineItems } : {}),
      warnings: parsed.warnings,
      unresolvedFields: parsed.unresolvedFields,
    };
  }

  /**
   * Build a real local-only tesseract.js recognizer. Only reached when local language
   * data exists (guarded above) so it never triggers a network fetch here. Lazily
   * loaded so tesseract.js is never imported in environments that don't run OCR.
   */
  private async localRecognizer(): Promise<OcrRecognizer> {
    // NOTE: intentionally not wired to a concrete tesseract worker in DOC-3 — running
    // it requires the local traineddata asset (absent in this environment). Kept as an
    // explicit failure so no accidental network/asset assumption is made.
    throw new Error('Local OCR recognizer is not configured (no local language data).');
  }
}
