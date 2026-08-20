import { Component, inject, output, signal } from '@angular/core';
import { DocumentModeSelectorComponent } from './document-mode-selector.component';
import { DocumentReviewComponent } from './document-review.component';
import { DocumentExtractionClientService } from './services/document-extraction-client.service';
import { DocumentProcessingMode } from './document-processing.model';
import { ConfirmedDocumentDraft, DocumentExtractionResult } from './document-review.model';

/**
 * DOC-3F receipt-capture orchestrator (embeddable). Connects the already-built Document
 * Intelligence pieces into one flow that a host (the expense modal) can drop in:
 *
 *   mode select → (TOTAL_ONLY: emit `totalOnly`, no extraction)
 *               → (ITEMIZED: pick file → local extraction → DOC-4 review → explicit confirm
 *                  → emit `confirmed(ConfirmedDocumentDraft)`)
 *
 * It REUSES the existing services/components (mode selector, `DocumentExtractionClientService`
 * — browser-local OCR for images, pdfjs for text PDFs, `provider_unavailable` for scanned —
 * and `DocumentReviewComponent`). It performs NO finance mutation and NO upload: extraction
 * runs on the user-picked file's bytes IN THE BROWSER (no server-side decryption, no keys, no
 * plaintext to the backend); on confirm it emits a candidates-only draft for the host to map.
 * The host remains the sole authority for creating the expense.
 */
@Component({
  selector: 'app-receipt-capture',
  templateUrl: './receipt-capture.component.html',
  imports: [DocumentModeSelectorComponent, DocumentReviewComponent],
})
export class ReceiptCaptureComponent {
  private readonly extractor = inject(DocumentExtractionClientService);

  /** User explicitly confirmed a reviewed draft — candidates only, no expense created. */
  readonly confirmed = output<ConfirmedDocumentDraft>();
  /** User chose Total-only — the host keeps the normal expense flow (attachment as-is). */
  readonly totalOnly = output<void>();
  /** User dismissed receipt capture. */
  readonly cancelled = output<void>();

  readonly mode = signal<DocumentProcessingMode | null>(null);
  readonly loading = signal(false);
  readonly result = signal<DocumentExtractionResult | null>(null);
  readonly error = signal<string | null>(null);

  onMode(mode: DocumentProcessingMode): void {
    this.mode.set(mode);
    this.result.set(null);
    this.error.set(null);
    if (mode === 'TOTAL_ONLY') {
      // Never invoke OCR/extraction for Total-only — hand back to the normal flow.
      this.totalOnly.emit();
    }
  }

  async onFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || this.mode() !== 'ITEMIZED') return; // defensive: never extract outside ITEMIZED
    this.loading.set(true);
    this.error.set(null);
    this.result.set(null);
    try {
      this.result.set(await this.extractor.extractFromFile(file));
    } catch {
      // Fail safe — never fabricate candidates, never mutate finance.
      this.error.set('Could not read this document. You can switch to Total-only and enter the amount.');
    } finally {
      this.loading.set(false);
    }
  }

  onConfirmed(draft: ConfirmedDocumentDraft): void {
    this.confirmed.emit(draft);
  }

  onReviewCancelled(): void {
    this.result.set(null);
  }

  cancel(): void {
    this.cancelled.emit();
  }
}
