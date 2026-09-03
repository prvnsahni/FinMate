import { Component, inject, signal } from '@angular/core';
import { DocumentModeSelectorComponent } from './document-mode-selector.component';
import { DocumentReviewComponent } from './document-review.component';
import { DocumentExtractionClientService } from './services/document-extraction-client.service';
import { DocumentProcessingMode } from './document-processing.model';
import {
  ConfirmedDocumentDraft,
  DocumentExtractionResult,
} from './document-review.model';

/**
 * DOC-4 document intake page (standalone — NOT wired into the finance-critical expense
 * modal). Orchestrates: choose mode → TOTAL_ONLY bypasses extraction (use the normal
 * expense flow) / ITEMIZED extracts (client-side PDF text; images honestly unavailable)
 * → review/confirm. On confirm it holds the draft for handoff to expense creation; it
 * creates no expense and mutates no finance data here.
 */
@Component({
  selector: 'app-document-intake-page',
  templateUrl: './document-intake-page.component.html',
  imports: [DocumentModeSelectorComponent, DocumentReviewComponent],
})
export class DocumentIntakePageComponent {
  private readonly extractor = inject(DocumentExtractionClientService);

  readonly mode = signal<DocumentProcessingMode | null>(null);
  readonly loading = signal(false);
  readonly result = signal<DocumentExtractionResult | null>(null);
  readonly confirmedDraft = signal<ConfirmedDocumentDraft | null>(null);
  readonly error = signal<string | null>(null);

  onMode(mode: DocumentProcessingMode): void {
    this.mode.set(mode);
    this.result.set(null);
    this.confirmedDraft.set(null);
    this.error.set(null);
  }

  async onFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.loading.set(true);
    this.error.set(null);
    this.result.set(null);
    try {
      this.result.set(await this.extractor.extractFromFile(file));
    } catch {
      this.error.set('Could not process the document.');
    } finally {
      this.loading.set(false);
    }
  }

  onConfirmed(draft: ConfirmedDocumentDraft): void {
    this.confirmedDraft.set(draft);
  }

  onCancelled(): void {
    this.result.set(null);
  }
}
