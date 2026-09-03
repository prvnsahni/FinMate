import { StubDocumentExtractionEngine } from './stub-document-extraction-engine';
import { computeReconciliation } from './reconciliation';
import {
  DOCUMENT_EXTRACTION_CONTRACT_VERSION,
  DocumentExtractionInput,
  ExtractedField,
  ExtractionAuthority,
} from './document-extraction-engine.types';

const engine = new StubDocumentExtractionEngine();

const input = (
  over: Partial<DocumentExtractionInput> = {},
): DocumentExtractionInput => ({
  documentRef: 'attachment:abc123',
  sourceType: 'image',
  mimeType: 'image/jpeg',
  ...over,
});

describe('StubDocumentExtractionEngine (DOC-0 contract)', () => {
  it('accepts a valid IMAGE input and returns an explicit unsupported result (no fabrication)', async () => {
    const r = await engine.extract(
      input({ sourceType: 'image', mimeType: 'image/png' }),
    );
    expect(r.status).toBe('unsupported_document');
    expect(r.sourceType).toBe('image');
    // Nothing is fabricated.
    expect(r.header).toBeUndefined();
    expect(r.lineItems).toBeUndefined();
    expect(r.reconciliation).toBeUndefined();
    expect(r.statementTransactions).toBeUndefined();
    expect(r.candidatesOnly).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('accepts a valid PDF input and returns an explicit unsupported result', async () => {
    const r = await engine.extract(
      input({ sourceType: 'pdf', mimeType: 'application/pdf' }),
    );
    expect(r.status).toBe('unsupported_document');
    expect(r.sourceType).toBe('pdf');
    expect(r.lineItems).toBeUndefined();
  });

  it('rejects unsupported/malformed input with invalid_input', async () => {
    const bad = await engine.extract(input({ sourceType: 'unknown' }));
    expect(bad.status).toBe('invalid_input');

    const noRef = await engine.extract(input({ documentRef: '' }));
    expect(noRef.status).toBe('invalid_input');

    const noMime = await engine.extract(input({ mimeType: '' }));
    expect(noMime.status).toBe('invalid_input');
  });

  it('never fabricates extracted values regardless of input', async () => {
    const r = await engine.extract(
      input({ hints: { mode: 'itemized', expectedFamily: 'grocery_receipt' } }),
    );
    // Asking for itemized extraction does NOT invent items.
    expect(r.lineItems).toBeUndefined();
    expect(r.documentFamily).toBe('unknown');
    expect(r.unresolvedFields).toEqual(
      expect.arrayContaining([
        'header',
        'lineItems',
        'reconciliation',
        'statementTransactions',
      ]),
    );
  });

  it('advertises stub capabilities: no families supported, no external provider', () => {
    const c = engine.capabilities();
    expect(c.kind).toBe('stub');
    expect(c.contractVersion).toBe(DOCUMENT_EXTRACTION_CONTRACT_VERSION);
    expect(c.supportedFamilies).toEqual([]);
    expect(c.supportsLineItems).toBe(false);
    expect(c.supportsReconciliation).toBe(false);
    expect(c.supportsStatementTransactions).toBe(false);
    // DOC-0 must never call an external provider (test §18).
    expect(c.usesExternalProvider).toBe(false);
    // The contract accepts image/pdf for routing.
    expect(c.supportedInputTypes).toEqual(
      expect.arrayContaining(['image', 'pdf']),
    );
  });

  it('has NO finance-write, decrypt, or external-call surface (FIN-002 / E2EE boundary, test §17/§19)', () => {
    // Structurally: the engine exposes only extract() + capabilities().
    const surface = engine as unknown as Record<string, unknown>;
    for (const forbidden of [
      'save',
      'commit',
      'persist',
      'mutate',
      'createExpense',
      'decrypt',
      'fetch',
    ]) {
      expect(typeof surface[forbidden]).toBe('undefined');
    }
  });
});

describe('computeReconciliation (DOC-0 §A6 — surfaces, never corrects)', () => {
  it('BALANCED when items equal the document total', () => {
    const r = computeReconciliation(2450, [2000, 450]);
    expect(r.reconciliationStatus).toBe('BALANCED');
    expect(r.allocatedTotal).toBe(2450);
    expect(r.unallocatedDifference).toBe(0);
  });

  it('UNDER_ALLOCATED and surfaces the gap (2450 total, 2390 items → +60)', () => {
    const r = computeReconciliation(2450, [1940, 450]);
    expect(r.allocatedTotal).toBe(2390);
    expect(r.unallocatedDifference).toBe(60);
    expect(r.reconciliationStatus).toBe('UNDER_ALLOCATED');
    // No phantom item was invented to close the gap.
    expect(r.documentTotal).toBe(2450);
  });

  it('OVER_ALLOCATED when items exceed the total (2450 total, 2510 items → -60)', () => {
    const r = computeReconciliation(2450, [2060, 450]);
    expect(r.allocatedTotal).toBe(2510);
    expect(r.unallocatedDifference).toBe(-60);
    expect(r.reconciliationStatus).toBe('OVER_ALLOCATED');
    // No item price was silently reduced.
  });

  it('UNRECONCILED when no document total is available', () => {
    const r = computeReconciliation(undefined, [100, 200]);
    expect(r.reconciliationStatus).toBe('UNRECONCILED');
    expect(r.allocatedTotal).toBe(300);
    expect(r.unallocatedDifference).toBe(0);
    expect(r.documentTotal).toBeUndefined();
  });

  it('ignores undefined/NaN line totals and rounds to 2dp', () => {
    const r = computeReconciliation(100.1, [
      50.05,
      undefined,
      Number.NaN,
      50.05,
    ]);
    expect(r.allocatedTotal).toBe(100.1);
    expect(r.reconciliationStatus).toBe('BALANCED');
  });

  it('honors an explicit tolerance (rounding/tax slack) for BALANCED', () => {
    const r = computeReconciliation(100, [99.5], { toleranceMinor: 0.5 });
    expect(r.unallocatedDifference).toBe(0.5);
    expect(r.reconciliationStatus).toBe('BALANCED');
  });
});

describe('confidence / provenance / authority discipline (test §12/§13)', () => {
  const authorities: ExtractionAuthority[] = [
    'EXTRACTED',
    'INFERRED',
    'USER_CORRECTED',
    'USER_CONFIRMED',
  ];

  it('supports all four authority states on a typed field', () => {
    for (const authority of authorities) {
      const field: ExtractedField<number> = {
        value: 60,
        authority,
        confidence: { score: 0.99, band: 'high' },
        provenance: { page: 1, adapter: 'image' },
      };
      expect(field.authority).toBe(authority);
    }
  });

  it('confidence is certainty metadata only — it carries no financial-write authority', () => {
    // A field can be 0.99 confident yet remain machine-EXTRACTED (not user-confirmed).
    const field: ExtractedField<number> = {
      value: 2450,
      authority: 'EXTRACTED',
      confidence: { score: 0.99, band: 'high' },
    };
    expect(field.confidence?.score).toBe(0.99);
    expect(field.authority).toBe('EXTRACTED');
    // High confidence must NOT be conflated with USER_CONFIRMED authority.
    expect(field.authority).not.toBe('USER_CONFIRMED');
  });
});
