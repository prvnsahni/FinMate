import { ExtractedDocumentHeader } from '../document-extraction-engine.types';
import {
  AdapterContent,
  AdapterExtraction,
  AdapterRequirement,
  ExtractionAdapter,
} from './extraction-adapter.types';
import { PdfjsModule, loadPdfjs } from './pdfjs-loader';
import { ParsedReceipt, parseReceiptText } from './receipt-text-parser';

/** Injectable pdfjs loader so tests can supply a fake (real ESM pdfjs needs Node, not Jest's VM). */
export type PdfjsLoader = () => Promise<PdfjsModule>;

/** First-defined value per header field across pages (so a total on the last page still wins). */
function mergeHeaders(
  headers: Array<ExtractedDocumentHeader | undefined>,
): ExtractedDocumentHeader {
  const out: ExtractedDocumentHeader = {};
  for (const h of headers) {
    if (!h) continue;
    if (!out.merchant && h.merchant) out.merchant = h.merchant;
    if (!out.documentDate && h.documentDate) out.documentDate = h.documentDate;
    if (!out.currency && h.currency) out.currency = h.currency;
    if (out.total === undefined && h.total) out.total = h.total;
  }
  return out;
}

/**
 * Real text-PDF adapter (pdfjs-dist). Reads the PDF text layer directly — NO OCR, NO
 * network, NO canvas — preserving per-page provenance, then parses candidate fields.
 * If no usable text layer exists it returns `no_text_detected` (the document should
 * be routed to the scanned/OCR path). Fabricates nothing.
 */
export class PdfTextExtractionAdapter implements ExtractionAdapter {
  readonly kind = 'pdf_text' as const;
  readonly requirement: AdapterRequirement = {
    requiredPackages: ['pdfjs-dist'],
    processesLocally: true,
    note: 'Local PDF text-layer extraction — highest accuracy, no OCR, no network, no canvas.',
  };

  constructor(private readonly load: PdfjsLoader = loadPdfjs) {}

  async extract(content: AdapterContent): Promise<AdapterExtraction> {
    if (content.sourceType !== 'pdf') {
      return {
        status: 'invalid_input',
        warnings: ['pdf_text adapter requires a PDF.'],
        unresolvedFields: [],
      };
    }

    let doc;
    try {
      const pdfjs = await this.load();
      doc = await pdfjs.getDocument({
        data: content.bytes,
        isEvalSupported: false,
        useSystemFonts: false,
      }).promise;
    } catch {
      return {
        status: 'document_corrupt',
        warnings: ['PDF could not be parsed.'],
        unresolvedFields: ['header', 'lineItems'],
      };
    }

    const parsedPages: ParsedReceipt[] = [];
    let anyText = false;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      // pdfjs returns text as runs; join with newlines so the line-based parser can
      // segment fields (our generated fixtures emit one run per line).
      const text = (await page.getTextContent()).items
        .map((i) => i.str)
        .join('\n');
      if (text.trim().length > 0) anyText = true;
      parsedPages.push(
        parseReceiptText(text, { adapter: 'pdf_text', page: p }),
      );
    }

    if (!anyText) {
      return {
        status: 'no_text_detected',
        warnings: [
          'No text layer detected — likely a scanned PDF; route to the OCR path.',
        ],
        unresolvedFields: ['header', 'lineItems'],
      };
    }

    const header = mergeHeaders(parsedPages.map((p) => p.header));
    const lineItems = parsedPages.flatMap((p) => p.lineItems ?? []);
    const hasHeader = Object.keys(header).length > 0;
    const unresolvedFields = Array.from(
      new Set(parsedPages.flatMap((p) => p.unresolvedFields)),
    );
    const complete = header.total !== undefined && lineItems.length > 0;

    return {
      status: complete ? 'ok' : 'partial_extraction',
      ...(hasHeader ? { header } : {}),
      ...(lineItems.length ? { lineItems } : {}),
      warnings: [],
      unresolvedFields,
    };
  }
}
