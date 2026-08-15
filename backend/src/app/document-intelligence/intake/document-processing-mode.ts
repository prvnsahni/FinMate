/**
 * DOC-1 document intake mode. The user chooses, per document, how it is handled:
 *
 *  - TOTAL_ONLY: the document is evidence/context only. No extraction is attempted;
 *    the user records/confirms the total through the EXISTING expense flow. This is
 *    a first-class workflow and does not depend on OCR.
 *  - ITEMIZED: the user asks FinMate to identify individual items for review. This
 *    invokes the DOC-0 `DocumentExtractionEngine` boundary. Until a real engine is
 *    wired (DOC-2/DOC-3), the stub returns an explicit unavailable result — the
 *    workflow never fabricates items.
 *
 * The mode is a request-level choice in DOC-1 (no persistence, no migration): it
 * selects the code path, not a stored attribute.
 */
export enum DocumentProcessingMode {
  TOTAL_ONLY = 'TOTAL_ONLY',
  ITEMIZED = 'ITEMIZED',
}
