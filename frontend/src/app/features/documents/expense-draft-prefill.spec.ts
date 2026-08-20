import { mapDraftToExpensePrefill } from './expense-draft-prefill';
import { ConfirmedDocumentDraft } from './document-review.model';

const draft = (over: Partial<ConfirmedDocumentDraft> = {}): ConfirmedDocumentDraft => ({
  title: 'Corner Grocery',
  amount: 42.5,
  currency: 'INR',
  date: '2026-08-01',
  itemCount: 2,
  items: [
    {
      description: 'Milk',
      quantity: 1,
      unitPrice: 20,
      lineTotal: 20,
      tags: [{ tagId: 'milk', canonicalName: 'Milk', authority: 'USER_CONFIRMED', source: 'rule_based' }],
    },
  ],
  reconciliation: {
    documentTotal: 42.5,
    allocatedTotal: 42.5,
    unallocatedDifference: 0,
    reconciliationStatus: 'BALANCED',
  },
  ...over,
});

describe('mapDraftToExpensePrefill (DOC-3E draft → expense seam)', () => {
  it('maps ONLY the non-finance header fields (title/amount/currency/date)', () => {
    const p = mapDraftToExpensePrefill(draft());
    expect(p).toEqual({
      title: 'Corner Grocery',
      amountTotal: 42.5,
      currency: 'INR',
      expenseDate: '2026-08-01',
    });
  });

  it('carries NO payer/split/refund/settlement/category or per-item tag data into finance', () => {
    const p = mapDraftToExpensePrefill(draft()) as Record<string, unknown>;
    for (const forbidden of ['paidByUserId', 'splits', 'transactionType', 'category', 'items', 'tags', 'reconciliation']) {
      expect(p[forbidden]).toBeUndefined();
    }
  });

  it('passes nulls through untouched (modal ignores unset fields)', () => {
    const p = mapDraftToExpensePrefill(draft({ title: null, amount: null, currency: null, date: null }));
    expect(p).toEqual({ title: null, amountTotal: null, currency: null, expenseDate: null });
  });
});
