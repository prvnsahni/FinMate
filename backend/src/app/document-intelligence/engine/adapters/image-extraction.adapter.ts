import {
  AdapterContent,
  AdapterExtraction,
  AdapterRequirement,
  ExtractionAdapter,
} from './extraction-adapter.types';
import { parseReceiptText } from './receipt-text-parser';
import { LocalTesseractRecognizer, engLangDataAvailable } from './local-tesseract-recognizer';

/** Local OCR provider seam. A real impl wraps tesseract.js configured LOCAL-ONLY. */
export interface OcrRecognizer {
  /** Return recognized text for the image bytes. Must not perform any network call. */
  recognize(bytes: Uint8Array, mimeType: string): Promise<string>;
}

/**
 * Real image adapter (tesseract.js) — SAFE BY DEFAULT, LOCAL-ONLY (DOC-6).
 *
 * tesseract.js v7 would fetch its language data from a CDN when `langPath` is unset. To
 * honour the "no external network / on-device only" rule, this adapter:
 *   - checks whether local OCR language data is present (`langDataAvailable`, a pure
 *     filesystem check by default), and
 *   - **refuses to run OCR** (returns `provider_unavailable`) when it is absent, rather
 *     than triggering a CDN download; and
 *   - when present, runs a LOCAL-ONLY `LocalTesseractRecognizer` (core/worker from the
 *     local packages, `eng.traineddata` from the committed asset, `langPath` local so the
 *     CDN fallback is unreachable).
 * A recognizer may also be injected (tests). It never fabricates values, never mutates
 * finance data, and never receives keys/tokens/E2EE plaintext.
 */
export class ImageExtractionAdapter implements ExtractionAdapter {
  readonly kind = 'image' as const;
  readonly requirement: AdapterRequirement = {
    requiredPackages: ['tesseract.js', 'eng.traineddata (committed local asset — backend/src/assets/tessdata/)'],
    processesLocally: true,
    note: 'On-device WASM OCR, configured LOCAL-ONLY (langPath → committed asset; no CDN, no network).',
  };

  constructor(
    private readonly recognizer?: OcrRecognizer,
    private readonly langDataAvailable: () => boolean = engLangDataAvailable,
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
   * data exists (guarded above) so it never triggers a network fetch here. The
   * recognizer lazily imports tesseract.js, so it is never loaded in environments that
   * do not run OCR.
   */
  private async localRecognizer(): Promise<OcrRecognizer> {
    return new LocalTesseractRecognizer();
  }
}
