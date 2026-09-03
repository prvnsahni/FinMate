import {
  AdapterContent,
  AdapterExtraction,
  AdapterRequirement,
  ExtractionAdapter,
} from './extraction-adapter.types';

/**
 * Scanned-PDF adapter (render pages → OCR). The render step requires rasterizing PDF
 * pages to pixels, which pdfjs-dist can only do through a canvas implementation
 * (`canvas` / `@napi-rs/canvas`) — NOT in the approved package set (pdfjs-dist +
 * tesseract.js only). DOC-3 therefore reports this boundary honestly: it returns
 * `provider_unavailable`, makes no network call, and fabricates nothing. Enabling
 * this path is a follow-up package decision (see the spike doc).
 */
export class PdfScanExtractionAdapter implements ExtractionAdapter {
  readonly kind = 'pdf_scanned' as const;
  readonly requirement: AdapterRequirement = {
    requiredPackages: [
      'pdfjs-dist',
      'a rasterizer (canvas / @napi-rs/canvas) — NOT approved',
      'tesseract.js',
    ],
    processesLocally: true,
    note: 'Render pages then OCR. Blocked: PDF→pixels needs a rasterizer outside the approved set.',
  };

  async extract(content: AdapterContent): Promise<AdapterExtraction> {
    if (content.sourceType !== 'pdf') {
      return {
        status: 'invalid_input',
        warnings: ['pdf_scanned adapter requires a PDF.'],
        unresolvedFields: [],
      };
    }
    return {
      status: 'provider_unavailable',
      warnings: [
        'Scanned-PDF OCR requires rasterizing pages (a canvas package), which is not in the ' +
          'approved package set (pdfjs-dist + tesseract.js only). See FINMATE_DOCUMENT_EXTRACTION_SPIKE.md.',
      ],
      unresolvedFields: ['header', 'lineItems'],
    };
  }
}
