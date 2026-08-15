import { LocalDocumentExtractionEngine } from './local-document-extraction-engine';
import { StubDocumentExtractionEngine } from './stub-document-extraction-engine';
import {
  DocumentExtractionEngine,
  DocumentExtractionInput,
} from './document-extraction-engine.types';
import {
  AdapterContent,
  AdapterExtraction,
  AdapterKind,
  ExtractionAdapter,
} from './adapters/extraction-adapter.types';

const content = (over: Partial<AdapterContent> = {}): AdapterContent => ({
  bytes: Uint8Array.from([37, 80, 68, 70]), // "%PDF"
  sourceType: 'pdf',
  mimeType: 'application/pdf',
  ...over,
});

/** Adapter set whose (all) adapters return the given canned extraction. */
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

const items = (...totals: number[]) =>
  totals.map((v) => ({ authority: 'EXTRACTED' as const, lineTotal: { value: v, authority: 'EXTRACTED' as const } }));

describe('LocalDocumentExtractionEngine (DOC-3)', () => {
  it('DOC-0 extract(ref) supplies no bytes → explicit invalid_input, never decrypts (E2EE boundary)', async () => {
    const engine = new LocalDocumentExtractionEngine();
    const input: DocumentExtractionInput = { documentRef: 'att-1', sourceType: 'pdf', mimeType: 'application/pdf' };
    const r = await engine.extract(input);
    expect(r.status).toBe('invalid_input');
    expect(r.warnings.join(' ')).toMatch(/no document content|E2EE/i);
  });

  it('extractFromContent routes PDF-with-text-layer to pdf_text and returns a normalized result', async () => {
    const engine = new LocalDocumentExtractionEngine(
      fakeAdapterSet({
        status: 'ok',
        header: { total: { value: 685, authority: 'EXTRACTED' } },
        lineItems: items(120, 45, 520),
      }),
    );
    const r = await engine.extractFromContent(content(), { pdfHasTextLayer: true });
    expect(r.sourceType).toBe('pdf');
    expect(r.reconciliation?.reconciliationStatus).toBe('BALANCED');
    expect(r.candidatesOnly).toBe(true);
    // Caller sees a DocumentExtractionResult — no adapter/pdfjs types leak.
    expect(r.engine.contractVersion).toBe(engine.contractVersion);
  });

  it('surfaces UNDER / OVER / UNRECONCILED without altering values', async () => {
    const under = await new LocalDocumentExtractionEngine(
      fakeAdapterSet({ status: 'partial_extraction', header: { total: { value: 685, authority: 'EXTRACTED' } }, lineItems: items(120, 520) }),
    ).extractFromContent(content());
    expect(under.reconciliation?.reconciliationStatus).toBe('UNDER_ALLOCATED');
    expect(under.reconciliation?.unallocatedDifference).toBe(45);

    const over = await new LocalDocumentExtractionEngine(
      fakeAdapterSet({ status: 'ok', header: { total: { value: 685, authority: 'EXTRACTED' } }, lineItems: items(120, 520, 60) }),
    ).extractFromContent(content());
    expect(over.reconciliation?.reconciliationStatus).toBe('OVER_ALLOCATED');
    expect(over.reconciliation?.unallocatedDifference).toBe(-15);

    // Missing total → no reconciliation attached (nothing invented).
    const noTotal = await new LocalDocumentExtractionEngine(
      fakeAdapterSet({ status: 'partial_extraction', lineItems: items(120) }),
    ).extractFromContent(content());
    expect(noTotal.reconciliation).toBeUndefined();
  });

  it('rejects empty/unsupported content with invalid_input', async () => {
    const engine = new LocalDocumentExtractionEngine();
    expect((await engine.extractFromContent(content({ bytes: new Uint8Array(0) }))).status).toBe('invalid_input');
    expect((await engine.extractFromContent(content({ sourceType: 'unknown', mimeType: 'text/plain' }))).status).toBe(
      'invalid_input',
    );
  });

  it('is a drop-in replacement for the stub and uses no external provider', () => {
    const stub: DocumentExtractionEngine = new StubDocumentExtractionEngine();
    const local: DocumentExtractionEngine = new LocalDocumentExtractionEngine();
    expect(typeof stub.extract).toBe('function');
    expect(typeof local.extract).toBe('function');
    expect(local.capabilities().usesExternalProvider).toBe(false);
  });

  it('has NO finance-write / decrypt / external-call surface', () => {
    const surface = new LocalDocumentExtractionEngine() as unknown as Record<string, unknown>;
    for (const forbidden of ['save', 'createExpense', 'mutate', 'decrypt', 'fetch']) {
      expect(typeof surface[forbidden]).toBe('undefined');
    }
  });
});
