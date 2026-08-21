import { DocumentSourceType } from './document-processing.model';

/**
 * DOC-4 review/confirmation types (frontend). The review layer CONSUMES a
 * DocumentExtractionResult (mirror of the DOC-0 backend contract) and produces a
 * user-editable candidate model. Nothing here mutates finance data — confirmation
 * hands a draft to the existing expense-creation flow.
 */

export type ExtractionAuthority = 'EXTRACTED' | 'INFERRED' | 'USER_CORRECTED' | 'USER_CONFIRMED';

export type ExtractionStatus =
  | 'ok'
  | 'partial_extraction'
  | 'unsupported_document'
  | 'invalid_input'
  | 'extraction_failed'
  | 'no_text_detected'
  | 'provider_unavailable'
  | 'document_too_large'
  | 'document_corrupt';

export interface ExtractedField<T> {
  value: T;
  authority: ExtractionAuthority;
  confidence?: { score: number; band: 'low' | 'medium' | 'high' };
  provenance?: { page?: number; adapter?: string };
}

export interface ExtractedLineItem {
  authority: ExtractionAuthority;
  description?: ExtractedField<string>;
  quantity?: ExtractedField<number>;
  unitPrice?: ExtractedField<number>;
  lineTotal?: ExtractedField<number>;
}

export interface ExtractedHeader {
  merchant?: ExtractedField<string>;
  documentDate?: ExtractedField<string>;
  currency?: ExtractedField<string>;
  total?: ExtractedField<number>;
}

/** Frontend mirror of the DOC-0 DocumentExtractionResult (only the fields the UI uses). */
export interface DocumentExtractionResult {
  status: ExtractionStatus;
  sourceType: DocumentSourceType;
  header?: ExtractedHeader;
  lineItems?: ExtractedLineItem[];
  warnings: string[];
  candidatesOnly: true;
}

// --- Editable review model ---------------------------------------------------

export interface ReviewField<T> {
  value: T | null;
  authority: ExtractionAuthority;
  confidence?: number;
}

/**
 * A tag on a review item. `INFERRED` = engine suggestion (from the shared taxonomy);
 * `USER_CORRECTED` = the user's own addition (per-user, NOT global truth);
 * `USER_CONFIRMED` = kept on confirm. DOC-5 does not persist these — they are advisory
 * metadata; persistence + global promotion are a future migration-gated batch.
 */
export interface ReviewTag {
  /** Stable taxonomy id when it maps to the shared seed, else a normalized user key. */
  tagId: string;
  canonicalName: string;
  authority: ExtractionAuthority;
  /** 'rule_based' (engine) or 'user' (a manual correction). */
  source: 'rule_based' | 'user';
  /**
   * TAG-BATCH-C4 — true for a user's own custom tag (a `custom_tags.id`), whose
   * `canonicalName` is a CLIENT-DECRYPTED name. Distinguishes a custom suggestion
   * from a canonical one in the UI and gates correction-memory recording. Absent
   * / false for canonical taxonomy tags.
   */
  custom?: boolean;
  /** TAG-BATCH-C4 — explainable reason for a custom suggestion (e.g. "Matched tag name"). */
  reason?: string;
}

export interface ReviewLineItem {
  id: string;
  description: ReviewField<string>;
  quantity: ReviewField<number>;
  unitPrice: ReviewField<number>;
  lineTotal: ReviewField<number>;
  /** Advisory classification tags (engine-suggested + user corrections). */
  tags: ReviewTag[];
}

export interface ConfirmedDocumentDraftItem {
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  /** Advisory tags only. These do not mutate finance values or category. */
  tags: ReviewTag[];
}

export type ReviewHeaderField = 'merchant' | 'date' | 'currency' | 'documentTotal';

export interface ReviewModel {
  status: ExtractionStatus;
  sourceType: DocumentSourceType;
  merchant: ReviewField<string>;
  date: ReviewField<string>;
  currency: ReviewField<string>;
  /** The authoritative document total. Only the user can change it (never silently). */
  documentTotal: ReviewField<number>;
  items: ReviewLineItem[];
  /** True once the user has explicitly confirmed. */
  confirmed: boolean;
}

export type ReconciliationStatus =
  | 'BALANCED'
  | 'UNDER_ALLOCATED'
  | 'OVER_ALLOCATED'
  | 'UNRECONCILED';

export interface ReviewReconciliation {
  documentTotal: number | null;
  allocatedTotal: number;
  unallocatedDifference: number;
  reconciliationStatus: ReconciliationStatus;
}

/**
 * Result of an explicit user confirmation — a candidate draft handed to the existing
 * expense-creation flow. It is NOT an expense and mutates no finance data itself.
 */
export interface ConfirmedDocumentDraft {
  title: string | null;
  amount: number | null;
  currency: string | null;
  date: string | null;
  itemCount: number;
  /** Candidate line-item metadata carried forward for future safe persistence. */
  items: ConfirmedDocumentDraftItem[];
  reconciliation: ReviewReconciliation;
}
