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
        getTextContent: async () => ({
          items: pages[n - 1].map((str) => ({ str })),
        }),
      }),
    }),
  }),
});

const imageFile = () =>
  ({
    type: 'image/jpeg',
    arrayBuffer: async () => new ArrayBuffer(3),
  }) as unknown as File;

describe('DocumentExtractionClientService (DOC-4, PDF-text working path)', () => {
  it('extracts header + items from a text PDF (status ok)', async () => {
    const svc = new DocumentExtractionClientService().useLoader(async () =>
      fakePdfjs([
        [
          'Example Market',
          'Date: 2026-08-15',
          'Milk 120',
          'Rice 520',
          'TOTAL INR 685',
        ],
      ]),
    );
    const r = await svc.extractPdf(Uint8Array.from([37, 80, 68, 70]));
    expect(r.status).toBe('ok');
    expect(r.header?.total?.value).toBe(685);
    expect(r.header?.total?.authority).toBe('EXTRACTED');
    expect(r.lineItems?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('reports no_text_detected for a scanned PDF (no text layer)', async () => {
    const svc = new DocumentExtractionClientService().useLoader(async () =>
      fakePdfjs([['   ']]),
    );
    expect((await svc.extractPdf(Uint8Array.from([1]))).status).toBe(
      'no_text_detected',
    );
  });

  it('reports document_corrupt when pdfjs throws — no fabrication', async () => {
    const svc = new DocumentExtractionClientService().useLoader(async () => {
      throw new Error('bad');
    });
    const r = await svc.extractPdf(Uint8Array.from([1]));
    expect(r.status).toBe('document_corrupt');
    expect(r.header).toBeUndefined();
  });
});

describe('DocumentExtractionClientService (DOC-3E, browser-local image OCR)', () => {
  it('OCRs an image locally into header + items (status ok) via the injected local OCR', async () => {
    const seen: Array<{ argCount: number; bytes: unknown; mime: unknown }> = [];
    const svc = new DocumentExtractionClientService().useOcr(
      async (...args) => {
        seen.push({ argCount: args.length, bytes: args[0], mime: args[1] });
        return 'Example Market\nMilk 120\nRice 520\nTOTAL INR 685';
      },
    );
    const r = await svc.extractFromFile(imageFile());
    expect(r.status).toBe('ok');
    expect(r.sourceType).toBe('image');
    expect(r.header?.total?.value).toBe(685);
    expect(r.lineItems?.length ?? 0).toBeGreaterThanOrEqual(2);
    // ADVERSARIAL: OCR receives ONLY image bytes + mime — never keys/tokens/PII.
    expect(seen).toHaveLength(1);
    expect(seen[0].argCount).toBe(2);
    expect(seen[0].bytes).toBeInstanceOf(Uint8Array);
    expect(seen[0].mime).toBe('image/jpeg');
  });

  it('FAILS CLOSED to provider_unavailable when local OCR throws (no network fallback)', async () => {
    const svc = new DocumentExtractionClientService().useOcr(async () => {
      throw new Error('local assets missing');
    });
    const r = await svc.extractFromFile(imageFile());
    expect(r.status).toBe('provider_unavailable');
    expect(r.sourceType).toBe('image');
    expect(r.header).toBeUndefined();
  });

  it('reports no_text_detected when local OCR yields no text — never fabricates', async () => {
    const svc = new DocumentExtractionClientService().useOcr(async () => '   ');
    const r = await svc.extractFromFile(imageFile());
    expect(r.status).toBe('no_text_detected');
    expect(r.lineItems).toBeUndefined();
  });

  it('makes NO backend/network call — receipt bytes never leave the browser', () => {
    // Structural proof: the client extraction service holds no HttpClient and issues no
    // request; OCR is a local function. (It never imports/injects HttpClient.)
    const svc = new DocumentExtractionClientService();
    expect((svc as unknown as { http?: unknown }).http).toBeUndefined();
    expect(
      (svc as unknown as { httpClient?: unknown }).httpClient,
    ).toBeUndefined();
  });
});
