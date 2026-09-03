import { Component, computed, output, signal } from '@angular/core';
import { DocumentProcessingMode } from './document-processing.model';

/**
 * DOC-1 document intake mode chooser (presentational).
 *
 * Lets the user pick how a document is handled — TOTAL_ONLY (evidence only; use the
 * normal expense flow) or ITEMIZED (try to identify items). Because OCR/extraction
 * is NOT implemented yet, choosing ITEMIZED surfaces an explicit "not available yet"
 * notice rather than pretending success. It emits the chosen mode; it does not touch
 * finance, does no HTTP, and fabricates nothing.
 *
 * Self-contained for DOC-1 — not yet wired into the expense-creation flow; DOC-2 will
 * integrate it once a real extraction engine exists.
 */
@Component({
  selector: 'app-document-mode-selector',
  templateUrl: './document-mode-selector.component.html',
})
export class DocumentModeSelectorComponent {
  /** Emits when the user picks a mode. */
  readonly modeSelected = output<DocumentProcessingMode>();

  /** The currently chosen mode (null until the user picks). */
  readonly selected = signal<DocumentProcessingMode | null>(null);

  /** True once ITEMIZED is chosen — drives the "not available yet" notice. */
  readonly itemizedChosen = computed(() => this.selected() === 'ITEMIZED');

  select(mode: DocumentProcessingMode): void {
    this.selected.set(mode);
    this.modeSelected.emit(mode);
  }
}
