import { DocumentReviewService } from './document-review.service';
import { DocumentExtractionResult } from '../document-review.model';

const ef = <T>(value: T, authority: 'EXTRACTED' | 'USER_CORRECTED' = 'EXTRACTED') => ({ value, authority });

const result = (over: Partial<DocumentExtractionResult> = {}): DocumentExtractionResult => ({
  status: 'ok',
  sourceType: 'pdf',
  candidatesOnly: true,
  warnings: [],
  header: {
    merchant: ef('Example Market'),
    documentDate: ef('2026-08-15'),
    currency: ef('INR'),
    total: ef(685),
  },
  lineItems: [
    { authority: 'EXTRACTED', description: ef('Milk'), lineTotal: ef(120) },
    { authority: 'EXTRACTED', description: ef('Rice'), lineTotal: ef(520) },
  ],
  ...over,
});

describe('DocumentReviewService (DOC-4 review/confirmation)', () => {
  let svc: DocumentReviewService;
  beforeEach(() => (svc = new DocumentReviewService()));

  it('builds an editable model from extraction candidates (all EXTRACTED)', () => {
    const m = svc.fromExtractionResult(result());
    expect(m.documentTotal.value).toBe(685);
    expect(m.documentTotal.authority).toBe('EXTRACTED');
    expect(m.items.length).toBe(2);
    expect(m.confirmed).toBe(false);
  });

  it('editing an item never silently changes the document total', () => {
    let m = svc.fromExtractionResult(result());
    m = svc.editItemField(m, m.items[0].id, 'lineTotal', '999');
    expect(m.documentTotal.value).toBe(685); // unchanged
    expect(m.documentTotal.authority).toBe('EXTRACTED');
  });

  it('user can edit the extracted amount → authority USER_CORRECTED', () => {
    let m = svc.fromExtractionResult(result());
    m = svc.editHeaderField(m, 'documentTotal', '700');
    expect(m.documentTotal.value).toBe(700);
    expect(m.documentTotal.authority).toBe('USER_CORRECTED');
  });

  it('user can add and delete items (added items are USER_CORRECTED)', () => {
    let m = svc.fromExtractionResult(result());
    m = svc.addItem(m);
    expect(m.items.length).toBe(3);
    expect(m.items[2].description.authority).toBe('USER_CORRECTED');
    const removeId = m.items[0].id;
    m = svc.deleteItem(m, removeId);
    expect(m.items.find((i) => i.id === removeId)).toBeUndefined();
    expect(m.items.length).toBe(2);
  });

  it('editing a line item field sets that field authority to USER_CORRECTED', () => {
    let m = svc.fromExtractionResult(result());
    m = svc.editItemField(m, m.items[0].id, 'description', 'Whole Milk');
    expect(m.items[0].description.value).toBe('Whole Milk');
    expect(m.items[0].description.authority).toBe('USER_CORRECTED');
  });

  it('reconciliation: BALANCED / UNDER (+45) / OVER (-15) / UNRECONCILED', () => {
    // BALANCED: 120+45+520 = 685
    const balanced = svc.fromExtractionResult(
      result({
        lineItems: [
          { authority: 'EXTRACTED', lineTotal: ef(120) },
          { authority: 'EXTRACTED', lineTotal: ef(45) },
          { authority: 'EXTRACTED', lineTotal: ef(520) },
        ],
      }),
    );
    expect(svc.reconcile(balanced).reconciliationStatus).toBe('BALANCED');

    // UNDER: 640 vs 685 → +45
    const under = svc.fromExtractionResult(result()); // 120+520 = 640
    const uc = svc.reconcile(under);
    expect(uc.reconciliationStatus).toBe('UNDER_ALLOCATED');
    expect(uc.unallocatedDifference).toBe(45);

    // OVER: add a 60 item → 700 vs 685 → -15
    let over = svc.fromExtractionResult(result());
    over = svc.editItemField(svc.addItem(over), over.items[over.items.length - 1].id, 'lineTotal', '60');
    // re-add: simpler explicit
    const over2 = svc.fromExtractionResult(
      result({ lineItems: [{ authority: 'EXTRACTED', lineTotal: ef(120) }, { authority: 'EXTRACTED', lineTotal: ef(520) }, { authority: 'EXTRACTED', lineTotal: ef(60) }] }),
    );
    const oc = svc.reconcile(over2);
    expect(oc.reconciliationStatus).toBe('OVER_ALLOCATED');
    expect(oc.unallocatedDifference).toBe(-15);

    // UNRECONCILED: no document total
    const noTotal = svc.fromExtractionResult(result({ header: { merchant: ef('X') } }));
    expect(svc.reconcile(noTotal).reconciliationStatus).toBe('UNRECONCILED');
  });

  it('never manufactures an item to close the difference', () => {
    const m = svc.fromExtractionResult(result()); // under-allocated
    expect(m.items.length).toBe(2);
    expect(svc.reconcile(m).unallocatedDifference).toBe(45);
    // reconcile does not add an item
    expect(m.items.length).toBe(2);
  });

  it('confirm() is explicit: untouched fields become USER_CONFIRMED, edited stay USER_CORRECTED', () => {
    let m = svc.fromExtractionResult(result());
    m = svc.editHeaderField(m, 'documentTotal', '700');
    const { model, draft } = svc.confirm(m);
    expect(model.confirmed).toBe(true);
    expect(model.merchant.authority).toBe('USER_CONFIRMED'); // untouched → confirmed
    expect(model.documentTotal.authority).toBe('USER_CORRECTED'); // edited → stays corrected
    expect(draft.amount).toBe(700);
    expect(draft.currency).toBe('INR');
    expect(draft.title).toBe('Example Market');
  });

  it('produces a draft that carries NO document bytes/keys/OCR text (candidates only)', () => {
    const m = svc.fromExtractionResult(result());
    const { draft } = svc.confirm(m);
    const blob = JSON.stringify(draft);
    expect(blob).not.toMatch(/key|encrypt|token|bytes|password/i);
  });
});
