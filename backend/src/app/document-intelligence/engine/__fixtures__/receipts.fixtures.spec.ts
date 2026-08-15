import { computeReconciliation } from '../reconciliation';
import {
  RECEIPT_FIXTURES,
  ReceiptFixture,
  fixtureItemSum,
} from './receipts.fixtures';

const byId = (id: string): ReceiptFixture => {
  const f = RECEIPT_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`fixture ${id} missing`);
  return f;
};

describe('DOC-2 receipt fixtures — reconciliation via computeReconciliation', () => {
  it('grocery-balanced: items sum to the printed total → BALANCED (685 = 685)', () => {
    const f = byId('grocery-balanced');
    expect(fixtureItemSum(f)).toBe(685);
    const r = computeReconciliation(f.printedTotal, f.expected.lineItems.map((li) => li.lineTotal));
    expect(r.reconciliationStatus).toBe('BALANCED');
  });

  it('ambiguous-characters: items under the printed total → UNDER_ALLOCATED (640 vs 685, Δ 45)', () => {
    const f = byId('ambiguous-characters');
    expect(fixtureItemSum(f)).toBe(640);
    const r = computeReconciliation(f.printedTotal, f.expected.lineItems.map((li) => li.lineTotal));
    expect(r.reconciliationStatus).toBe('UNDER_ALLOCATED');
    expect(r.unallocatedDifference).toBe(45);
  });

  it('sum-exceeds-total: items over the printed total → OVER_ALLOCATED (700 vs 685, Δ -15)', () => {
    const f = byId('sum-exceeds-total');
    expect(fixtureItemSum(f)).toBe(700);
    const r = computeReconciliation(f.printedTotal, f.expected.lineItems.map((li) => li.lineTotal));
    expect(r.reconciliationStatus).toBe('OVER_ALLOCATED');
    expect(r.unallocatedDifference).toBe(-15);
  });
});

describe('DOC-2 fixtures — hygiene & coverage', () => {
  it('cover image, text-PDF and scanned-PDF source types', () => {
    const images = RECEIPT_FIXTURES.filter((f) => f.sourceType === 'image');
    const textPdf = RECEIPT_FIXTURES.filter((f) => f.sourceType === 'pdf' && f.pdfHasTextLayer === true);
    const scannedPdf = RECEIPT_FIXTURES.filter((f) => f.sourceType === 'pdf' && f.pdfHasTextLayer === false);
    expect(images.length).toBeGreaterThan(0);
    expect(textPdf.length).toBeGreaterThan(0);
    expect(scannedPdf.length).toBeGreaterThan(0);
  });

  it('contain no secrets/PII patterns (synthetic only)', () => {
    const blob = JSON.stringify(RECEIPT_FIXTURES);
    expect(blob).not.toMatch(/password|token|secret|api[_-]?key|@[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it('every fixture has a numeric printedTotal', () => {
    for (const f of RECEIPT_FIXTURES) {
      expect(typeof f.printedTotal).toBe('number');
    }
  });
});
