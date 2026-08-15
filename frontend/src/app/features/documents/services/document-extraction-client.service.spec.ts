import {
  ClientPdfjs,
  DocumentExtractionClientService,
} from './document-extraction-client.service';

/** Fake pdfjs: each page is an array of line strings → one text item per line. */
const fakePdfjs = (pages: string[][]): ClientPdfjs => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: async (n: number) => ({
        getTextContent: async () => ({ items: pages[n - 1].map((str) => ({ str })) }),
      }),
    }),
  }),
});

const imageFile = () =>
  ({ type: 'image/jpeg', arrayBuffer: async () => new ArrayBuffer(3) }) as unknown as File;

describe('DocumentExtractionClientService (DOC-4, PDF-text working path)', () => {
  it('extracts header + items from a text PDF (status ok)', async () => {
    const svc = new DocumentExtractionClientService().useLoader(async () =>
      fakePdfjs([['Example Market', 'Date: 2026-08-15', 'Milk 120', 'Rice 520', 'TOTAL INR 685']]),
    );
    const r = await svc.extractPdf(Uint8Array.from([37, 80, 68, 70]));
    expect(r.status).toBe('ok');
    expect(r.header?.total?.value).toBe(685);
    expect(r.header?.total?.authority).toBe('EXTRACTED');
    expect((r.lineItems?.length ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it('reports no_text_detected for a scanned PDF (no text layer)', async () => {
    const svc = new DocumentExtractionClientService().useLoader(async () => fakePdfjs([['   ']]));
    expect((await svc.extractPdf(Uint8Array.from([1]))).status).toBe('no_text_detected');
  });

  it('reports document_corrupt when pdfjs throws — no fabrication', async () => {
    const svc = new DocumentExtractionClientService().useLoader(async () => {
      throw new Error('bad');
    });
    const r = await svc.extractPdf(Uint8Array.from([1]));
    expect(r.status).toBe('document_corrupt');
    expect(r.header).toBeUndefined();
  });

  it('images honestly report provider_unavailable (no OCR pretending)', async () => {
    const svc = new DocumentExtractionClientService().useLoader(async () => fakePdfjs([[]]));
    const r = await svc.extractFromFile(imageFile());
    expect(r.status).toBe('provider_unavailable');
    expect(r.sourceType).toBe('image');
  });
});
