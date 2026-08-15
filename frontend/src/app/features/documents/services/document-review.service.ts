import { Injectable } from '@angular/core';
import {
  ConfirmedDocumentDraft,
  DocumentExtractionResult,
  ExtractedField,
  ReconciliationStatus,
  ReviewField,
  ReviewHeaderField,
  ReviewLineItem,
  ReviewModel,
  ReviewReconciliation,
} from '../document-review.model';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

let itemSeq = 0;
const nextId = (): string => `item-${++itemSeq}`;

/**
 * DOC-4 review service (pure, immutable). Turns extraction candidates into a
 * user-editable model, tracks field authority, computes reconciliation, and — only on
 * an explicit `confirm()` — produces a draft for the existing expense flow.
 *
 * Guarantees: the document total is NEVER changed except by an explicit user edit;
 * editing a field raises its authority to USER_CORRECTED; extraction confidence is
 * never treated as financial correctness; no method mutates any finance record.
 */
@Injectable({ providedIn: 'root' })
export class DocumentReviewService {
  /** Build an editable model from an extraction result (all candidates EXTRACTED). */
  fromExtractionResult(result: DocumentExtractionResult): ReviewModel {
    const f = <T>(field?: ExtractedField<T>): ReviewField<T> => ({
      value: field ? field.value : null,
      authority: field ? field.authority : 'EXTRACTED',
      ...(field?.confidence ? { confidence: field.confidence.score } : {}),
    });

    return {
      status: result.status,
      sourceType: result.sourceType,
      merchant: f(result.header?.merchant),
      date: f(result.header?.documentDate),
      currency: f(result.header?.currency),
      documentTotal: f(result.header?.total),
      items: (result.lineItems ?? []).map((li) => ({
        id: nextId(),
        description: f(li.description),
        quantity: f(li.quantity),
        unitPrice: f(li.unitPrice),
        lineTotal: f(li.lineTotal),
      })),
      confirmed: false,
    };
  }

  /** Edit a header field → authority USER_CORRECTED. Returns a new model. */
  editHeaderField(model: ReviewModel, field: ReviewHeaderField, value: string): ReviewModel {
    if (field === 'documentTotal') {
      return { ...model, documentTotal: this.corrected(this.toNumber(value)) };
    }
    const key = field === 'date' ? 'date' : field;
    return { ...model, [key]: this.corrected<string>(value === '' ? null : value) } as ReviewModel;
  }

  /** Edit a line-item field → authority USER_CORRECTED. Returns a new model. */
  editItemField(
    model: ReviewModel,
    itemId: string,
    field: keyof Omit<ReviewLineItem, 'id'>,
    value: string,
  ): ReviewModel {
    const items = model.items.map((it) => {
      if (it.id !== itemId) return it;
      const isNumeric = field !== 'description';
      const next = isNumeric ? this.corrected(this.toNumber(value)) : this.corrected(value === '' ? null : value);
      return { ...it, [field]: next };
    });
    return { ...model, items };
  }

  /** Add a new, user-authored line item (authority USER_CORRECTED). */
  addItem(model: ReviewModel): ReviewModel {
    const blank: ReviewLineItem = {
      id: nextId(),
      description: this.corrected<string>(null),
      quantity: this.corrected<number>(null),
      unitPrice: this.corrected<number>(null),
      lineTotal: this.corrected<number>(null),
    };
    return { ...model, items: [...model.items, blank] };
  }

  /** Delete a line item. Never touches the document total. */
  deleteItem(model: ReviewModel, itemId: string): ReviewModel {
    return { ...model, items: model.items.filter((it) => it.id !== itemId) };
  }

  /**
   * Reconcile the (authoritative) document total against the sum of line-item totals.
   * Surfaces the difference; never invents an item or alters a value.
   */
  reconcile(model: ReviewModel): ReviewReconciliation {
    const allocatedTotal = round2(
      model.items.reduce((s, it) => (typeof it.lineTotal.value === 'number' ? s + it.lineTotal.value : s), 0),
    );
    const documentTotal = model.documentTotal.value;
    if (documentTotal === null || !Number.isFinite(documentTotal)) {
      return { documentTotal, allocatedTotal, unallocatedDifference: 0, reconciliationStatus: 'UNRECONCILED' };
    }
    const unallocatedDifference = round2(documentTotal - allocatedTotal);
    let reconciliationStatus: ReconciliationStatus;
    if (unallocatedDifference === 0) reconciliationStatus = 'BALANCED';
    else if (unallocatedDifference > 0) reconciliationStatus = 'UNDER_ALLOCATED';
    else reconciliationStatus = 'OVER_ALLOCATED';
    return { documentTotal, allocatedTotal, unallocatedDifference, reconciliationStatus };
  }

  /**
   * Explicit user confirmation. Any still-EXTRACTED (untouched) fields become
   * USER_CONFIRMED; user-edited fields keep USER_CORRECTED. Produces a draft for the
   * existing expense flow — it does NOT create an expense or mutate finance data.
   */
  confirm(model: ReviewModel): { model: ReviewModel; draft: ConfirmedDocumentDraft } {
    const confirmField = <T>(field: ReviewField<T>): ReviewField<T> =>
      field.authority === 'EXTRACTED' || field.authority === 'INFERRED'
        ? { ...field, authority: 'USER_CONFIRMED' }
        : field;

    const confirmedModel: ReviewModel = {
      ...model,
      merchant: confirmField(model.merchant),
      date: confirmField(model.date),
      currency: confirmField(model.currency),
      documentTotal: confirmField(model.documentTotal),
      items: model.items.map((it) => ({
        ...it,
        description: confirmField(it.description),
        quantity: confirmField(it.quantity),
        unitPrice: confirmField(it.unitPrice),
        lineTotal: confirmField(it.lineTotal),
      })),
      confirmed: true,
    };

    const draft: ConfirmedDocumentDraft = {
      title: confirmedModel.merchant.value,
      amount: confirmedModel.documentTotal.value,
      currency: confirmedModel.currency.value,
      date: confirmedModel.date.value,
      itemCount: confirmedModel.items.length,
      reconciliation: this.reconcile(confirmedModel),
    };
    return { model: confirmedModel, draft };
  }

  private corrected<T>(value: T | null): ReviewField<T> {
    return { value, authority: 'USER_CORRECTED' };
  }

  private toNumber(value: string): number | null {
    if (value.trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
}
