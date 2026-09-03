import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DocumentReviewService } from './services/document-review.service';
import { CustomTagSuggestionService } from './services/custom-tag-suggestion.service';
import { AuthorizedCustomTag } from './services/custom-tag-suggestion';
import { SuggestionScope } from '../../core/services/custom-tag-correction-memory.service';
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
  private readonly suggestions = inject(CustomTagSuggestionService);

  readonly extractionResult = input<DocumentExtractionResult | null>(null);
  readonly confirmed = output<ConfirmedDocumentDraft>();
  readonly cancelled = output<void>();

  readonly model = signal<ReviewModel | null>(null);

  // TAG-BATCH-C4 — authorized+decrypted custom tags for the current (personal)
  // scope, loaded once per extraction. Held so confirm() can record the user's
  // label→custom-tag corrections into device-local memory.
  private authorizedCustomTags: AuthorizedCustomTag[] = [];
  private suggestionScope: SuggestionScope | null = null;
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
      const base = r ? this.review.fromExtractionResult(r) : null;
      this.authorizedCustomTags = [];
      this.suggestionScope = null;
      this.model.set(base);
      if (base) void this.loadCustomSuggestions(base);
    });
  }

  /**
   * TAG-BATCH-C4 — best-effort, CLIENT-SIDE custom-tag suggestions for the DOC-4
   * (personal) review. Loads the user's authorized custom tags (decrypted via the
   * C3 crypto path, cached), then merges deterministic INFERRED suggestions onto
   * the items. Purely additive and non-blocking: any failure, no scope, or no
   * custom tags simply leaves the canonical-only review intact, and it never
   * clobbers edits the user has already made (only merges when the model is still
   * the freshly-built one).
   */
  private async loadCustomSuggestions(base: ReviewModel): Promise<void> {
    const scope = this.suggestions.currentScope();
    if (!scope) return;
    let authorized: AuthorizedCustomTag[];
    try {
      authorized = await this.suggestions.loadAuthorizedTags(scope);
    } catch {
      return;
    }
    if (authorized.length === 0) return;
    this.authorizedCustomTags = authorized;
    this.suggestionScope = scope;
    if (this.model() !== base) return; // user already edited — don't clobber
    const merged = this.review.mergeCustomSuggestions(base, (label) =>
      this.suggestions.suggest(label, authorized, scope),
    );
    if (this.model() === base) this.model.set(merged);
  }

  editHeader(field: ReviewHeaderField, event: Event): void {
    const m = this.model();
    if (m)
      this.model.set(
        this.review.editHeaderField(
          m,
          field,
          (event.target as HTMLInputElement).value,
        ),
      );
  }

  editItem(
    itemId: string,
    field: keyof Omit<ReviewLineItem, 'id'>,
    event: Event,
  ): void {
    const m = this.model();
    if (m)
      this.model.set(
        this.review.editItemField(
          m,
          itemId,
          field,
          (event.target as HTMLInputElement).value,
        ),
      );
  }

  addItem(): void {
    const m = this.model();
    if (m) this.model.set(this.review.addItem(m));
  }

  deleteItem(itemId: string): void {
    const m = this.model();
    if (m) this.model.set(this.review.deleteItem(m, itemId));
  }

  /** Add a user tag (per-user correction, USER_CORRECTED) from a text input. */
  addTag(itemId: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const m = this.model();
    if (m && input.value.trim()) {
      this.model.set(this.review.addTag(m, itemId, input.value));
      input.value = '';
    }
  }

  removeTag(itemId: string, tagId: string): void {
    const m = this.model();
    if (m) this.model.set(this.review.removeTag(m, itemId, tagId));
  }

  confirm(): void {
    const m = this.model();
    if (!m) return;
    const { model, draft } = this.review.confirm(m);
    this.recordCustomCorrections(model);
    this.model.set(model);
    this.confirmed.emit(draft);
  }

  /**
   * TAG-BATCH-C4 — after an explicit confirm, remember each kept/added CUSTOM tag
   * against its item label in DEVICE-LOCAL correction memory, so this client can
   * suggest it next time. Only opaque tag ids + normalized labels are stored; no
   * decrypted name is persisted, sent, or logged, and only tags the user still
   * authorized (loaded this session) are recorded.
   */
  private recordCustomCorrections(model: ReviewModel): void {
    const scope = this.suggestionScope;
    if (!scope || this.authorizedCustomTags.length === 0) return;
    const authorizedIds = new Set(this.authorizedCustomTags.map((t) => t.id));
    for (const it of model.items) {
      for (const t of it.tags) {
        if (t.custom && authorizedIds.has(t.tagId)) {
          this.suggestions.recordCorrection(
            scope,
            it.description.value,
            t.tagId,
          );
        }
      }
    }
  }

  cancel(): void {
    this.cancelled.emit();
  }
}
