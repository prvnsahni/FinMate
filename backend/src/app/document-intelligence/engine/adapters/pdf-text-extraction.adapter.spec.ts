import { PdfTextExtractionAdapter } from './pdf-text-extraction.adapter';
import { PdfjsModule } from './pdfjs-loader';
import { AdapterContent } from './extraction-adapter.types';

/**
 * Unit-tests the adapter logic with a FAKE pdfjs loader. (The real ESM pdfjs runs in
 * plain Node — see the standalone spike harness — but not in Jest's VM, so we inject a
 * fake here to test the text-join, page provenance, parse, and status mapping.)
 */
/** Each page is an array of line strings → one pdfjs text-run item per line. */
const fakePdfjs = (pages: string[][]): PdfjsModule => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: async (n: number) => ({
        getTextContent: async () => ({ items: pages[n - 1].map((str) => ({ str })) }),
      }),
    }),
  }),
});

const pdfContent: AdapterContent = {
  bytes: Uint8Array.from([37, 80, 68, 70]),
  sourceType: 'pdf',
  mimeType: 'application/pdf',
};

describe('PdfTextExtractionAdapter (pdfjs text layer)', () => {
  it('extracts header + line items from the text layer (status ok)', async () => {
    const adapter = new PdfTextExtractionAdapter(async () =>
      fakePdfjs([['Example Market', 'Date: 2026-08-15', 'Milk 2 x 60 120', 'Rice 1 x 520 520', 'TOTAL INR 685']]),
    );
    const out = await adapter.extract(pdfContent);
    expect(out.status).toBe('ok');
    expect(out.header?.total?.value).toBe(685);
    expect(out.header?.total?.authority).toBe('EXTRACTED');
    expect((out.lineItems?.length ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it('returns no_text_detected for a PDF with no text layer (route to OCR)', async () => {
    const adapter = new PdfTextExtractionAdapter(async () => fakePdfjs([['   ']]));
    const out = await adapter.extract(pdfContent);
    expect(out.status).toBe('no_text_detected');
    expect(out.lineItems).toBeUndefined();
  });

  it('preserves page provenance across multiple pages', async () => {
    const adapter = new PdfTextExtractionAdapter(async () =>
      fakePdfjs([['Example Market', 'Milk 120'], ['Rice 520', 'TOTAL 640']]),
    );
    const out = await adapter.extract(pdfContent);
    const pages = (out.lineItems ?? []).map((li) => li.lineTotal?.provenance?.page);
    expect(pages).toEqual(expect.arrayContaining([1, 2]));
  });

  it('returns document_corrupt when pdfjs throws — no fabrication', async () => {
    const adapter = new PdfTextExtractionAdapter(async () => {
      throw new Error('bad pdf');
    });
    const out = await adapter.extract(pdfContent);
    expect(out.status).toBe('document_corrupt');
    expect(out.header).toBeUndefined();
  });
});
