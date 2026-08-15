/**
 * DOC-1 document intake types (frontend). Mirrors the backend contract at
 * POST /document-intelligence/attachments/{attachmentId}/process.
 */

/** How the user wants a document handled. */
export type DocumentProcessingMode = 'TOTAL_ONLY' | 'ITEMIZED';

export type DocumentSourceType = 'image' | 'pdf' | 'unknown';

/** Response of the intake endpoint (already unwrapped by the response interceptor). */
export interface DocumentIntakeResult {
  mode: DocumentProcessingMode;
  attachmentId: string;
  sourceType: DocumentSourceType;
  extractionAttempted: boolean;
  /** Present only for ITEMIZED. Candidates-only; currently `unsupported_document`. */
  extraction?: {
    status: string;
    warnings?: string[];
  };
  message: string;
}
