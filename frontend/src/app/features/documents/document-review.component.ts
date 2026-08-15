import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DocumentReviewService } from './services/document-review.service';
import {
  ConfirmedDocumentDraft,
  DocumentExtractionResult,
  ReviewHeaderField,
  ReviewLineItem,
  ReviewModel,
} from './document-review.model';

/**
 * DOC-4 review/confirmation screen. Consumes a DocumentExtractionResult and lets the
 * user edit/add/delete candidates, see live reconciliation, and EXPLICITLY confirm.
 * It never mutates finance data — on confirm it emits a draft for the existing
 * expense-creation flow. Honestly surfaces failure / unavailable / empty states
 * (no pretend OCR).
 */
@Component({
  selector: 'app-document-review',
  templateUrl: './document-review.component.html',
})
export class DocumentReviewComponent {
  private readonly review = inject(DocumentReviewService);

  readonly extractionResult = input<DocumentExtractionResult | null>(null);
  readonly confirmed = output<ConfirmedDocumentDraft>();
  readonly cancelled = output<void>();

  readonly model = signal<ReviewModel | null>(null);
  readonly reconciliation = computed(() => {
    const m = this.model();
    return m ? this.review.reconcile(m) : null;
  });

  /** True when there are candidates worth reviewing (ok / partial extraction). */
  readonly hasCandidates = computed(() => {
    const s = this.model()?.status;
    return s === 'ok' || s === 'partial_extraction';
  });

  constructor() {
    effect(() => {
      const r = this.extractionResult();
      this.model.set(r ? this.review.fromExtractionResult(r) : null);
    });
  }

  editHeader(field: ReviewHeaderField, event: Event): void {
    const m = this.model();
    if (m) this.model.set(this.review.editHeaderField(m, field, (event.target as HTMLInputElement).value));
  }

  editItem(itemId: string, field: keyof Omit<ReviewLineItem, 'id'>, event: Event): void {
    const m = this.model();
    if (m) this.model.set(this.review.editItemField(m, itemId, field, (event.target as HTMLInputElement).value));
  }

  addItem(): void {
    const m = this.model();
    if (m) this.model.set(this.review.addItem(m));
  }

  deleteItem(itemId: string): void {
    const m = this.model();
    if (m) this.model.set(this.review.deleteItem(m, itemId));
  }

  confirm(): void {
    const m = this.model();
    if (!m) return;
    const { model, draft } = this.review.confirm(m);
    this.model.set(model);
    this.confirmed.emit(draft);
  }

  cancel(): void {
    this.cancelled.emit();
  }
}
