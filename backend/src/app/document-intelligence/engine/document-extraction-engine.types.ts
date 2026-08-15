/**
 * Document Extraction contract (DOC-0).
 *
 * Implements the stable, replaceable boundary described in
 * docs/architecture/FINMATE_DOCUMENT_INTELLIGENCE_READINESS.md (§9, §A1, §A5) and
 * mirrors the Goal Engine pattern (docs/architecture/FINMATE_GOAL_ENGINE_ARCHITECTURE.md):
 *
 *   FinMate module → stable `DocumentExtractionEngine` interface → replaceable impl.
 *
 * A consumer depends ONLY on this interface (via the `DOCUMENT_EXTRACTION_ENGINE`
 * token) — never on a concrete OCR/PDF/vision library. DOC-0 ships a safe stub;
 * future on-device OCR / text-PDF / scanned-PDF / vision engines satisfy the same
 * contract without changing any consumer.
 *
 * HARD BOUNDARIES (see readiness §A6/§18–§19, FIN-002, E2EE):
 *  - Extraction produces CANDIDATES only. It never creates or mutates a financial
 *    record (payer/amount/split/refund/settlement/currency/balances). The
 *    user-review → confirmation step (a future DOC batch) owns any finance write.
 *  - `confidence` is EXTRACTION CERTAINTY only. It is NOT financial correctness.
 *    An engine reporting confidence 0.99 does NOT authorize any expense mutation.
 *  - The engine receives only the minimum routing metadata — never encryption keys,
 *    auth tokens, passwords, contacts, or unrelated user/financial data — and calls
 *    no external provider (any future external provider must go through the AI Firewall).
 *
 * This contract defines shape only; DOC-0 implements no extraction logic.
 */

/** Bump on a breaking change to this contract. */
export const DOCUMENT_EXTRACTION_CONTRACT_VERSION = '1.0.0';

/** Normalized input source. One pipeline; adapters differ by source (readiness §A1). */
export type DocumentSourceType = 'image' | 'pdf' | 'unknown';

/**
 * Document families the contract is EXTENSIBLE to. Listing a family here does NOT
 * mean it is supported — a concrete engine advertises actually-supported families
 * via `capabilities().supportedFamilies`. DOC-0 supports none.
 */
export type DocumentFamily =
  | 'grocery_receipt'
  | 'retail_receipt'
  | 'restaurant_receipt'
  | 'fuel_receipt'
  | 'pharmacy_receipt'
  | 'invoice'
  | 'credit_card_statement'
  | 'bank_statement'
  | 'utility_document'
  | 'subscription_document'
  | 'rent_document'
  | 'loan_emi_document'
  | 'travel_document'
  | 'tax_document'
  | 'unknown';

/**
 * Authority / source of a value. Extraction/classification produce EXTRACTED or
 * INFERRED values; the user's review can raise a value to USER_CORRECTED /
 * USER_CONFIRMED. A later low-confidence INFERRED value must never overwrite a
 * USER_CONFIRMED one (readiness §A5).
 */
export type ExtractionAuthority =
  | 'EXTRACTED' // machine read it off the document
  | 'INFERRED' // machine classified/derived it
  | 'USER_CORRECTED' // user edited a machine value
  | 'USER_CONFIRMED'; // user accepted it as final

/** Technical / partial outcomes. Partial results are preserved, not discarded. */
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

/** Total-vs-items reconciliation state (readiness §A6). Never auto-corrected. */
export type ReconciliationStatus =
  | 'BALANCED'
  | 'UNDER_ALLOCATED'
  | 'OVER_ALLOCATED'
  | 'UNRECONCILED';

export type ExtractionEngineKind =
  | 'stub'
  | 'local_ocr'
  | 'pdf_text'
  | 'vision'
  | 'managed_ocr';

/**
 * Extraction certainty for a value. NOT financial correctness — see the file header.
 */
export interface FieldConfidence {
  /** 0..1 extraction certainty. */
  score: number;
  band: 'low' | 'medium' | 'high';
}

/** Where a value came from within the document (for later review UX / audit). */
export interface FieldProvenance {
  page?: number;
  region?: { x: number; y: number; width: number; height: number };
  /** Which adapter produced the value (e.g. 'image', 'pdf_text', 'pdf_scanned'). */
  adapter?: string;
  engineVersion?: string;
}

/**
 * A single extracted value plus its metadata. Generic so numeric, string and date
 * values all carry the same confidence/provenance/authority discipline.
 */
export interface ExtractedField<T> {
  value: T;
  authority: ExtractionAuthority;
  confidence?: FieldConfidence;
  provenance?: FieldProvenance;
}

/**
 * Minimized engine input. Carries only what routing/extraction needs — an OPAQUE
 * reference to the already-stored document plus coarse metadata. Never keys, tokens,
 * PII, contacts, or unrelated financial data (readiness §18, DOC-0 spec §13).
 */
export interface DocumentExtractionInput {
  /**
   * Opaque handle to the already-stored document bytes (e.g. an attachment
   * storageKey). The engine does not resolve identity/ownership from this — the
   * caller has already authorized access.
   */
  documentRef: string;
  sourceType: DocumentSourceType;
  mimeType: string;
  /** Optional; may be omitted for privacy. */
  fileName?: string;
  sizeBytes?: number;
  pageCount?: number;
  /** Coarse, non-sensitive routing hints only. */
  hints?: {
    expectedFamily?: DocumentFamily;
    mode?: 'total_only' | 'itemized';
    languageHint?: string;
  };
}

/** A. Line item candidate (receipts/invoices). All fields optional + metadata-tagged. */
export interface ExtractedLineItem {
  reference?: ExtractedField<string>;
  description?: ExtractedField<string>;
  quantity?: ExtractedField<number>;
  unitPrice?: ExtractedField<number>;
  lineTotal?: ExtractedField<number>;
  currency?: ExtractedField<string>;
  authority: ExtractionAuthority;
  confidence?: FieldConfidence;
  provenance?: FieldProvenance;
}

/**
 * B. Reconciliation summary (readiness §A6). `documentTotal` is authoritative; line
 * items are subordinate detail. The difference is SURFACED, never silently resolved.
 *   unallocatedDifference = documentTotal - allocatedTotal   (signed)
 */
export interface ReconciliationSummary {
  documentTotal?: number;
  extractedSubtotal?: number;
  extractedTax?: number;
  extractedDiscount?: number;
  /** sum of the line-item totals actually allocated. */
  allocatedTotal: number;
  /** documentTotal - allocatedTotal (positive = under-allocated). */
  unallocatedDifference: number;
  reconciliationStatus: ReconciliationStatus;
}

export type TransactionDirection = 'debit' | 'credit' | 'unknown';

/** C. Statement transaction candidate (future CC/bank — no import implemented in DOC-0). */
export interface ExtractedStatementTransaction {
  transactionDate?: ExtractedField<string>; // YYYY-MM-DD
  amount?: ExtractedField<number>;
  currency?: ExtractedField<string>;
  merchant?: ExtractedField<string>;
  reference?: ExtractedField<string>;
  direction?: ExtractedField<TransactionDirection>;
  transactionType?: ExtractedField<string>;
  authority: ExtractionAuthority;
  confidence?: FieldConfidence;
  provenance?: FieldProvenance;
}

/** Optional document-header fields common to receipts/invoices. */
export interface ExtractedDocumentHeader {
  merchant?: ExtractedField<string>;
  documentDate?: ExtractedField<string>;
  currency?: ExtractedField<string>;
  subtotal?: ExtractedField<number>;
  tax?: ExtractedField<number>;
  discount?: ExtractedField<number>;
  total?: ExtractedField<number>;
  pageCount?: number;
}

/**
 * Normalized result envelope. Payload sections are present ONLY when the engine
 * actually produced them — the stub fabricates nothing.
 */
export interface DocumentExtractionResult {
  engine: {
    name: string;
    version: string;
    contractVersion: string;
    kind: ExtractionEngineKind;
  };
  status: ExtractionStatus;
  documentFamily: DocumentFamily;
  sourceType: DocumentSourceType;

  header?: ExtractedDocumentHeader;
  lineItems?: ExtractedLineItem[];
  reconciliation?: ReconciliationSummary;
  statementTransactions?: ExtractedStatementTransaction[];

  /** Overall extraction confidence (certainty, not correctness). */
  confidence?: FieldConfidence;
  warnings: string[];
  unresolvedFields: string[];
  /**
   * Structural marker: extraction output is ALWAYS candidates. There is no field or
   * method on this contract that writes financial data — a downstream user
   * confirmation step owns any mutation (FIN-002 boundary).
   */
  readonly candidatesOnly: true;
  generatedAt: string;
}

/** Self-description of a concrete engine. */
export interface DocumentExtractionCapabilities {
  name: string;
  version: string;
  contractVersion: string;
  kind: ExtractionEngineKind;
  supportedInputTypes: DocumentSourceType[];
  supportedFamilies: DocumentFamily[];
  supportsLineItems: boolean;
  supportsReconciliation: boolean;
  supportsStatementTransactions: boolean;
  /**
   * External network/provider involvement. MUST be false unless the engine is routed
   * through the AI Firewall with its future controls. DOC-0 stub: false.
   */
  usesExternalProvider: boolean;
}

/**
 * Stable engine interface. The ONLY surface a consumer may depend on. Note there is
 * no finance-write, no decrypt, and no external-call method here — the contract is
 * read-in (a document reference) / candidates-out by construction.
 */
export interface DocumentExtractionEngine {
  readonly name: string;
  readonly version: string;
  readonly contractVersion: string;
  extract(input: DocumentExtractionInput): Promise<DocumentExtractionResult>;
  capabilities(): DocumentExtractionCapabilities;
}

/** DI token so the concrete engine can be swapped without touching any consumer. */
export const DOCUMENT_EXTRACTION_ENGINE = Symbol('DOCUMENT_EXTRACTION_ENGINE');
