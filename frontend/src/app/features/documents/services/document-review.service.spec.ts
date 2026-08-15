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
    expect(blob).not.toMatch(/key|encrypt|token|bytes|password|encryptedOriginalName|encryptedFileKey|storageKey/i);
  });

  // --- DOC-5 classification / tags ---
  it('suggests engine tags (INFERRED, rule_based) for known items via the shared taxonomy', () => {
    const m = svc.fromExtractionResult(
      result({ lineItems: [{ authority: 'EXTRACTED', description: ef('Milk'), lineTotal: ef(120) }] }),
    );
    const tags = m.items[0].tags;
    expect(tags.some((t) => t.tagId === 'milk')).toBe(true);
    expect(tags.some((t) => t.tagId === 'grocery')).toBe(true); // ancestor
    for (const t of tags) {
      expect(t.authority).toBe('INFERRED');
      expect(t.source).toBe('rule_based');
    }
  });

  it('a user correction adds a per-user tag (USER_CORRECTED, source user) — not global', () => {
    let m = svc.fromExtractionResult(
      result({ lineItems: [{ authority: 'EXTRACTED', description: ef('Milk'), lineTotal: ef(120) }] }),
    );
    m = svc.addTag(m, m.items[0].id, 'household');
    const added = m.items[0].tags.find((t) => t.tagId === 'household');
    expect(added?.authority).toBe('USER_CORRECTED');
    expect(added?.source).toBe('user');
  });

  it('dedupes tags and supports removal', () => {
    let m = svc.fromExtractionResult(
      result({ lineItems: [{ authority: 'EXTRACTED', description: ef('Milk'), lineTotal: ef(120) }] }),
    );
    const before = m.items[0].tags.length;
    m = svc.addTag(m, m.items[0].id, 'grocery'); // already inferred → deduped
    expect(m.items[0].tags.length).toBe(before);
    m = svc.removeTag(m, m.items[0].id, 'milk');
    expect(m.items[0].tags.some((t) => t.tagId === 'milk')).toBe(false);
  });

  it('does not suggest sensitive medical/pharmacy tags', () => {
    const m = svc.fromExtractionResult(
      result({ lineItems: [{ authority: 'EXTRACTED', description: ef('pharmacy medicine'), lineTotal: ef(50) }] }),
    );
    expect(m.items[0].tags.map((t) => t.canonicalName).join(' ')).not.toMatch(/medic|pharmac|health/i);
  });

  it('on confirm, kept engine tags become USER_CONFIRMED; user tags stay USER_CORRECTED', () => {
    let m = svc.fromExtractionResult(
      result({ lineItems: [{ authority: 'EXTRACTED', description: ef('Milk'), lineTotal: ef(120) }] }),
    );
    m = svc.addTag(m, m.items[0].id, 'household');
    const { model } = svc.confirm(m);
    const tags = model.items[0].tags;
    expect(tags.find((t) => t.tagId === 'milk')?.authority).toBe('USER_CONFIRMED');
    expect(tags.find((t) => t.tagId === 'household')?.authority).toBe('USER_CORRECTED');
  });

  it('carries confirmed tags into the draft without changing finance values', () => {
    let m = svc.fromExtractionResult(
      result({ lineItems: [{ authority: 'EXTRACTED', description: ef('Milk'), lineTotal: ef(120) }] }),
    );
    m = svc.addTag(m, m.items[0].id, 'household');
    const { draft } = svc.confirm(m);

    expect(draft.amount).toBe(685);
    expect(draft.currency).toBe('INR');
    expect(draft.itemCount).toBe(1);
    expect(draft.items[0].lineTotal).toBe(120);
    expect(draft.items[0].tags.find((t) => t.tagId === 'milk')?.authority).toBe('USER_CONFIRMED');
    expect(draft.items[0].tags.find((t) => t.tagId === 'household')?.authority).toBe('USER_CORRECTED');
    expect(draft.items[0].tags.find((t) => t.tagId === 'household')?.source).toBe('user');
  });
});
