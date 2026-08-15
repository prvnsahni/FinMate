/**
 * DOC-2 internal adapter boundary (spike).
 *
 * Adapters are an IMPLEMENTATION DETAIL behind the DOC-0 `DocumentExtractionEngine`
 * contract — a consumer never sees them. The engine detects the source and delegates
 * to the matching adapter; every adapter returns the same normalized shape so the
 * caller only ever sees a `DocumentExtractionResult`, never a `TesseractResult` /
 * `PdfParserResult` / cloud-vendor result.
 *
 *   document → source detection → adapter (image | pdf_text | pdf_scanned) → normalized
 *
 * DOC-2 ships adapter STUBS only: no OCR/PDF package is installed, so each adapter
 * returns an explicit `provider_unavailable` and never fabricates values. Each stub
 * declares the package(s) a real implementation would need (see the spike doc).
 */

import {
  ExtractedDocumentHeader,
  ExtractedLineItem,
  ExtractionStatus,
  DocumentExtractionInput,
} from '../document-extraction-engine.types';

/** Which internal adapter handles a document. */
export type AdapterKind = 'image' | 'pdf_text' | 'pdf_scanned';

/** What a real adapter would require — surfaced for the package-decision report. */
export interface AdapterRequirement {
  /** npm package(s) a real implementation would need. Empty until one is approved. */
  requiredPackages: string[];
  /** True if the real adapter would process bytes on-device/in-process (no external call). */
  processesLocally: boolean;
  note: string;
}

/**
 * Adapter-level output. The engine maps this onto the DOC-0 result and (when a total
 * and items are present) runs `computeReconciliation`. Adapters carry no
 * reconciliation logic and never mutate finance data.
 */
export interface AdapterExtraction {
  status: ExtractionStatus;
  header?: ExtractedDocumentHeader;
  lineItems?: ExtractedLineItem[];
  warnings: string[];
  unresolvedFields: string[];
}

/** Internal extraction adapter. Replaceable per source without touching the engine. */
export interface ExtractionAdapter {
  readonly kind: AdapterKind;
  readonly requirement: AdapterRequirement;
  /**
   * Produce candidate fields for a document. Absent a provider/package it MUST return
   * `provider_unavailable` with empty payloads — never fabricated values.
   */
  extract(input: DocumentExtractionInput): Promise<AdapterExtraction>;
}
