import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  DocumentIntakeResult,
  DocumentProcessingMode,
} from '../document-processing.model';

/**
 * DOC-1 document-intelligence API client. Sends only the chosen processing mode for
 * an already-owned attachment — never document bytes, keys, or PII. The endpoint is
 * gated behind the `document.intelligence` flag (404 when OFF) and itemized
 * extraction is not implemented yet (returns an explicit unavailable result).
 */
@Injectable({ providedIn: 'root' })
export class DocumentIntelligenceApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/document-intelligence`;

  /** Ask the backend to process an owned attachment in TOTAL_ONLY or ITEMIZED mode. */
  process(
    attachmentId: string,
    mode: DocumentProcessingMode,
  ): Observable<DocumentIntakeResult> {
    return this.http.post<DocumentIntakeResult>(
      `${this.base}/attachments/${attachmentId}/process`,
      { mode },
    );
  }
}
