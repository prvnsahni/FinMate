import { mapDraftToExpensePrefill } from './expense-draft-prefill';
import { ConfirmedDocumentDraft, ReviewTag } from './document-review.model';

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
  it('maps the non-finance header fields and carries the confirmed DOC-5 tags (TAG-BATCH-A)', () => {
    const p = mapDraftToExpensePrefill(draft());
    expect(p).toEqual({
      title: 'Corner Grocery',
      amountTotal: 42.5,
      currency: 'INR',
      expenseDate: '2026-08-01',
      tags: [{ tagId: 'milk', authority: 'USER_CONFIRMED', source: 'rule_based' }],
    });
  });

  it('carries NO payer/split/refund/settlement/category or raw item data into finance', () => {
    const p = mapDraftToExpensePrefill(draft()) as Record<string, unknown>;
    // Tags are now intentionally carried (advisory Zone-2 metadata); the finance
    // fields still must never cross this seam.
    for (const forbidden of ['paidByUserId', 'splits', 'transactionType', 'category', 'items', 'reconciliation']) {
      expect(p[forbidden]).toBeUndefined();
    }
  });

  it('passes header nulls through untouched and omits tags when there are none', () => {
    const p = mapDraftToExpensePrefill(draft({ title: null, amount: null, currency: null, date: null, items: [] }));
    expect(p).toEqual({ title: null, amountTotal: null, currency: null, expenseDate: null });
    expect(p).not.toHaveProperty('tags');
  });

  it('total-only receipt (no item tags) carries no tags', () => {
    const p = mapDraftToExpensePrefill(draft({ items: [{ description: 'x', quantity: 1, unitPrice: 5, lineTotal: 5, tags: [] }] }));
    expect(p).not.toHaveProperty('tags');
  });

  it('de-duplicates a tag across items, keeping the highest authority', () => {
    const p = mapDraftToExpensePrefill(
      draft({
        items: [
          { description: 'Milk', quantity: 1, unitPrice: 20, lineTotal: 20, tags: [tag('milk', 'INFERRED')] },
          { description: 'More milk', quantity: 1, unitPrice: 20, lineTotal: 20, tags: [tag('milk', 'USER_CONFIRMED')] },
        ],
      }),
    );
    expect(p.tags).toEqual([{ tagId: 'milk', authority: 'USER_CONFIRMED', source: 'rule_based' }]);
  });

  it('excludes non-tag authorities such as EXTRACTED', () => {
    const p = mapDraftToExpensePrefill(
      draft({ items: [{ description: 'Milk', quantity: 1, unitPrice: 20, lineTotal: 20, tags: [tag('milk', 'EXTRACTED')] }] }),
    );
    expect(p).not.toHaveProperty('tags');
  });
});

function tag(tagId: string, authority: ReviewTag['authority']): ReviewTag {
  return { tagId, canonicalName: tagId, authority, source: 'rule_based' };
}
