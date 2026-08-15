import { LocalDocumentExtractionEngine } from './local-document-extraction-engine';
import { StubDocumentExtractionEngine } from './stub-document-extraction-engine';
import {
  DocumentExtractionEngine,
  DocumentExtractionInput,
} from './document-extraction-engine.types';
import {
  AdapterExtraction,
  AdapterKind,
  ExtractionAdapter,
} from './adapters/extraction-adapter.types';

const input = (over: Partial<DocumentExtractionInput> = {}): DocumentExtractionInput => ({
  documentRef: 'att-1',
  sourceType: 'image',
  mimeType: 'image/jpeg',
  ...over,
});

/** A fake adapter returning fixture-like candidates (to exercise the reconciliation mapping). */
const fakeAdapterSet = (
  out: Omit<AdapterExtraction, 'warnings' | 'unresolvedFields'> &
    Partial<Pick<AdapterExtraction, 'warnings' | 'unresolvedFields'>>,
): Record<AdapterKind, ExtractionAdapter> => {
  const full: AdapterExtraction = { warnings: [], unresolvedFields: [], ...out };
  const make = (kind: AdapterKind): ExtractionAdapter => ({
    kind,
    requirement: { requiredPackages: ['fake'], processesLocally: true, note: 'test' },
    extract: async () => full,
  });
  return { image: make('image'), pdf_text: make('pdf_text'), pdf_scanned: make('pdf_scanned') };
};

describe('LocalDocumentExtractionEngine (DOC-2 spike architecture)', () => {
  const engine = new LocalDocumentExtractionEngine();

  it('accepts image input and routes to an adapter → explicit provider_unavailable (no fabrication)', async () => {
    const r = await engine.extract(input({ sourceType: 'image', mimeType: 'image/png' }));
    expect(r.status).toBe('provider_unavailable');
    expect(r.sourceType).toBe('image');
    expect(r.lineItems).toBeUndefined();
    expect(r.reconciliation).toBeUndefined();
    expect(r.candidatesOnly).toBe(true);
  });

  it('accepts text-PDF input (pdfHasTextLayer) and scanned-PDF input, same result shape', async () => {
    const textPdf = await engine.extract(
      input({ sourceType: 'pdf', mimeType: 'application/pdf' }),
      { pdfHasTextLayer: true },
    );
    const scannedPdf = await engine.extract(
      input({ sourceType: 'pdf', mimeType: 'application/pdf' }),
      { pdfHasTextLayer: false },
    );
    for (const r of [textPdf, scannedPdf]) {
      expect(r.status).toBe('provider_unavailable'); // no OCR/PDF package installed
      expect(r.sourceType).toBe('pdf');
      expect(r.candidatesOnly).toBe(true);
      // Caller sees a DocumentExtractionResult regardless of the internal adapter.
      expect(r.engine.contractVersion).toBe(engine.contractVersion);
    }
  });

  it('rejects unsupported input with invalid_input', async () => {
    expect((await engine.extract(input({ sourceType: 'unknown', mimeType: 'text/plain' }))).status).toBe(
      'invalid_input',
    );
    expect((await engine.extract(input({ documentRef: '' }))).status).toBe('invalid_input');
  });

  it('runs computeReconciliation when an adapter returns a total + items — BALANCED', async () => {
    const eng = new LocalDocumentExtractionEngine(
      fakeAdapterSet({
        status: 'ok',
        header: { total: { value: 685, authority: 'EXTRACTED' } },
        lineItems: [
          { authority: 'EXTRACTED', lineTotal: { value: 120, authority: 'EXTRACTED' } },
          { authority: 'EXTRACTED', lineTotal: { value: 45, authority: 'EXTRACTED' } },
          { authority: 'EXTRACTED', lineTotal: { value: 520, authority: 'EXTRACTED' } },
        ],
      }),
    );
    const r = await eng.extract(input());
    expect(r.reconciliation?.reconciliationStatus).toBe('BALANCED');
    expect(r.reconciliation?.allocatedTotal).toBe(685);
  });

  it('surfaces UNDER_ALLOCATED and OVER_ALLOCATED without altering values', async () => {
    const under = await new LocalDocumentExtractionEngine(
      fakeAdapterSet({
        status: 'partial_extraction',
        header: { total: { value: 685, authority: 'EXTRACTED' } },
        lineItems: [
          { authority: 'EXTRACTED', lineTotal: { value: 120, authority: 'EXTRACTED' } },
          { authority: 'EXTRACTED', lineTotal: { value: 520, authority: 'EXTRACTED' } },
        ],
      }),
    ).extract(input());
    expect(under.reconciliation?.reconciliationStatus).toBe('UNDER_ALLOCATED');
    expect(under.reconciliation?.unallocatedDifference).toBe(45);

    const over = await new LocalDocumentExtractionEngine(
      fakeAdapterSet({
        status: 'ok',
        header: { total: { value: 685, authority: 'EXTRACTED' } },
        lineItems: [
          { authority: 'EXTRACTED', lineTotal: { value: 120, authority: 'EXTRACTED' } },
          { authority: 'EXTRACTED', lineTotal: { value: 520, authority: 'EXTRACTED' } },
          { authority: 'EXTRACTED', lineTotal: { value: 60, authority: 'EXTRACTED' } },
        ],
      }),
    ).extract(input());
    expect(over.reconciliation?.reconciliationStatus).toBe('OVER_ALLOCATED');
    expect(over.reconciliation?.unallocatedDifference).toBe(-15);
  });

  it('is a drop-in replacement: satisfies the same contract as the stub', () => {
    const stub: DocumentExtractionEngine = new StubDocumentExtractionEngine();
    const local: DocumentExtractionEngine = new LocalDocumentExtractionEngine();
    // Both expose the identical surface; a consumer swaps one for the other.
    expect(typeof stub.extract).toBe('function');
    expect(typeof local.extract).toBe('function');
    expect(local.capabilities().usesExternalProvider).toBe(false); // no external service
    expect(local.capabilities().kind).toBe('local_ocr');
  });

  it('has NO finance-write / decrypt / external-call surface', () => {
    const surface = engine as unknown as Record<string, unknown>;
    for (const forbidden of ['save', 'createExpense', 'mutate', 'decrypt', 'fetch']) {
      expect(typeof surface[forbidden]).toBe('undefined');
    }
  });
});
