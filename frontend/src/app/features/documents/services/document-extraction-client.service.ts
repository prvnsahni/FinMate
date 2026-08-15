import { Injectable } from '@angular/core';
import { DocumentSourceType } from '../document-processing.model';
import { DocumentExtractionResult } from '../document-review.model';
import { parseReceiptText } from '../receipt-text-parser';

/** Minimal pdfjs surface the client extraction uses (keeps the bundler/loader pluggable). */
export interface ClientPdfjs {
  getDocument(src: { data: Uint8Array }): { promise: Promise<ClientPdfDoc> };
}
export interface ClientPdfDoc {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str: string }> }> }>;
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
): DocumentExtractionResult => ({ status, sourceType, warnings, candidatesOnly: true, ...extra });

/**
 * DOC-4 client-side extraction. PDF text is the WORKING path (pdfjs, in-browser — no
 * server-side decryption, no external service). Images honestly report
 * `provider_unavailable` (no OCR in this batch). Extraction runs on bytes the user
 * supplied (a picked File); it never touches finance data and fabricates nothing.
 *
 * The pdfjs loader is injectable so unit tests supply a fake (real ESM pdfjs does not
 * load in the Jest VM; it is code-split for the browser at runtime).
 */
@Injectable({ providedIn: 'root' })
export class DocumentExtractionClientService {
  /** Pluggable pdfjs loader (real, code-split browser import by default). */
  private loadPdfjs: PdfjsLoader = defaultPdfjsLoader;

  /** Override the pdfjs loader (tests inject a fake; real ESM pdfjs can't load in Jest). */
  useLoader(loader: PdfjsLoader): this {
    this.loadPdfjs = loader;
    return this;
  }

  /** Extract candidates from a user-picked file. */
  async extractFromFile(file: File): Promise<DocumentExtractionResult> {
    const sourceType = sourceOf(file.type);
    if (sourceType === 'image') {
      return envelope('provider_unavailable', 'image', [
        'Image OCR is not available yet. You can switch to Total-only and enter the amount.',
      ]);
    }
    if (sourceType !== 'pdf') {
      return envelope('unsupported_document', 'unknown', ['Unsupported document type.']);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    return this.extractPdf(bytes);
  }

  /** Extract from PDF bytes (exposed for testing/reuse). */
  async extractPdf(bytes: Uint8Array): Promise<DocumentExtractionResult> {
    let doc: ClientPdfDoc;
    try {
      const pdfjs = await this.loadPdfjs();
      doc = await pdfjs.getDocument({ data: bytes }).promise;
    } catch {
      return envelope('document_corrupt', 'pdf', ['The PDF could not be read.']);
    }

    let text = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      text += (await page.getTextContent()).items.map((i) => i.str).join('\n') + '\n';
    }

    if (text.trim().length === 0) {
      return envelope('no_text_detected', 'pdf', [
        'This PDF has no text layer (likely scanned). OCR is not available yet.',
      ]);
    }

    const parsed = parseReceiptText(text);
    const complete = parsed.header?.total !== undefined && (parsed.lineItems?.length ?? 0) > 0;
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
