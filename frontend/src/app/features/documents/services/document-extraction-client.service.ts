import { Injectable } from '@angular/core';
import { DocumentSourceType } from '../document-processing.model';
import { DocumentExtractionResult } from '../document-review.model';
import { parseReceiptText } from '../receipt-text-parser';
import { BrowserOcrService } from './browser-ocr.service';

/** Local OCR seam: recognize text from image bytes. Must never perform an external call. */
export type ImageOcrFn = (
  bytes: Uint8Array,
  mimeType: string,
) => Promise<string>;

/** Minimal pdfjs surface the client extraction uses (keeps the bundler/loader pluggable). */
export interface ClientPdfjs {
  getDocument(src: { data: Uint8Array }): { promise: Promise<ClientPdfDoc> };
}
export interface ClientPdfDoc {
  numPages: number;
  getPage(
    n: number,
  ): Promise<{ getTextContent(): Promise<{ items: Array<{ str: string }> }> }>;
}
export type PdfjsLoader = () => Promise<ClientPdfjs>;

const sourceOf = (mimeType: string): DocumentSourceType => {
  const m = (mimeType || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  return 'unknown';
};

const envelope = (
  status: DocumentExtractionResult['status'],
  sourceType: DocumentSourceType,
  warnings: string[],
  extra: Partial<DocumentExtractionResult> = {},
): DocumentExtractionResult => ({
  status,
  sourceType,
  warnings,
  candidatesOnly: true,
  ...extra,
});

/**
 * DOC-4/DOC-3E client-side extraction. Both real paths run **in-browser** — no
 * server-side decryption, no external service, no finance mutation, nothing fabricated:
 *   - PDF text (pdfjs, code-split); and
 *   - image OCR (DOC-3E: local Tesseract WASM via `BrowserOcrService`), so E2EE receipt
 *     bytes never leave the device. When local OCR assets are missing the browser OCR
 *     fails closed and this returns `provider_unavailable` — never a network fetch.
 * Extraction runs on bytes the user supplied (a picked File).
 *
 * The pdfjs loader and the image-OCR fn are injectable so unit tests supply fakes (real
 * ESM pdfjs / Tesseract WASM do not run in the Jest VM; both are code-split at runtime).
 */
@Injectable({ providedIn: 'root' })
export class DocumentExtractionClientService {
  /** Pluggable pdfjs loader (real, code-split browser import by default). */
  private loadPdfjs: PdfjsLoader = defaultPdfjsLoader;

  /**
   * Pluggable local image-OCR fn — browser Tesseract by default. `BrowserOcrService` is
   * stateless (no injected deps), so it is created on demand; this keeps the service usable
   * via `new` (tests) without an Angular injection context, mirroring the pdfjs-loader seam.
   */
  private ocr: ImageOcrFn = (bytes, mimeType) =>
    new BrowserOcrService().recognize(bytes, mimeType);

  /** Override the pdfjs loader (tests inject a fake; real ESM pdfjs can't load in Jest). */
  useLoader(loader: PdfjsLoader): this {
    this.loadPdfjs = loader;
    return this;
  }

  /** Override the image-OCR fn (tests inject a fake; real Tesseract WASM can't run in Jest). */
  useOcr(ocr: ImageOcrFn): this {
    this.ocr = ocr;
    return this;
  }

  /** Extract candidates from a user-picked file. */
  async extractFromFile(file: File): Promise<DocumentExtractionResult> {
    const sourceType = sourceOf(file.type);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (sourceType === 'image') {
      return this.extractImage(bytes, file.type);
    }
    if (sourceType !== 'pdf') {
      return envelope('unsupported_document', 'unknown', [
        'Unsupported document type.',
      ]);
    }
    return this.extractPdf(bytes);
  }

  /**
   * Extract from image bytes via local, in-browser OCR (DOC-3E). Bytes never leave the
   * device; a missing/failed local model yields `provider_unavailable` (fail-closed, no
   * network); empty OCR yields `no_text_detected`. Fabricates nothing.
   */
  async extractImage(
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<DocumentExtractionResult> {
    let text: string;
    try {
      text = await this.ocr(bytes, mimeType);
    } catch {
      return envelope('provider_unavailable', 'image', [
        'Local image OCR is unavailable on this device. You can switch to Total-only and enter the amount.',
      ]);
    }
    if (text.trim().length === 0) {
      return envelope('no_text_detected', 'image', [
        'No text was detected in the image.',
      ]);
    }
    const parsed = parseReceiptText(text);
    const complete =
      parsed.header?.total !== undefined && (parsed.lineItems?.length ?? 0) > 0;
    return envelope(complete ? 'ok' : 'partial_extraction', 'image', [], {
      ...(parsed.header ? { header: parsed.header } : {}),
      ...(parsed.lineItems ? { lineItems: parsed.lineItems } : {}),
    });
  }

  /** Extract from PDF bytes (exposed for testing/reuse). */
  async extractPdf(bytes: Uint8Array): Promise<DocumentExtractionResult> {
    let doc: ClientPdfDoc;
    try {
      const pdfjs = await this.loadPdfjs();
      doc = await pdfjs.getDocument({ data: bytes }).promise;
    } catch {
      return envelope('document_corrupt', 'pdf', [
        'The PDF could not be read.',
      ]);
    }

    let text = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      text +=
        (await page.getTextContent()).items.map((i) => i.str).join('\n') + '\n';
    }

    if (text.trim().length === 0) {
      return envelope('no_text_detected', 'pdf', [
        'This PDF has no text layer (likely scanned). OCR is not available yet.',
      ]);
    }

    const parsed = parseReceiptText(text);
    const complete =
      parsed.header?.total !== undefined && (parsed.lineItems?.length ?? 0) > 0;
    return envelope(complete ? 'ok' : 'partial_extraction', 'pdf', [], {
      ...(parsed.header ? { header: parsed.header } : {}),
      ...(parsed.lineItems ? { lineItems: parsed.lineItems } : {}),
    });
  }
}

/**
 * Default browser pdfjs loader — code-split at build time and only loaded when the
 * user actually extracts a PDF. Configured for local, in-browser text extraction.
 */
async function defaultPdfjsLoader(): Promise<ClientPdfjs> {
  const pdfjs = (await import('pdfjs-dist')) as unknown as ClientPdfjs & {
    GlobalWorkerOptions?: { workerSrc: string };
  };
  // Text extraction runs without a separate worker file; guard if the field exists.
  if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = '';
  }
  return pdfjs;
}
