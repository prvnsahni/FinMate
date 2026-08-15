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

export interface ReviewLineItem {
  id: string;
  description: ReviewField<string>;
  quantity: ReviewField<number>;
  unitPrice: ReviewField<number>;
  lineTotal: ReviewField<number>;
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
  reconciliation: ReviewReconciliation;
}
