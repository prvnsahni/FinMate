import {
  DocumentExtractionInput,
  DocumentSourceType,
} from '../document-extraction-engine.types';
import { AdapterKind } from './extraction-adapter.types';

/** Resolved adapter selection; `none` means no adapter can handle the input. */
export type ResolvedAdapterKind = AdapterKind | 'none';

/**
 * Optional signals a future engine would compute by probing the document (each needs
 * a PDF/OCR package — none installed in DOC-2, so they are passed in for routing).
 */
export interface SourceSignals {
  /** Whether a PDF has a usable text layer (text-PDF) vs image-only (scanned). */
  pdfHasTextLayer?: boolean;
}

/**
 * Map a MIME type to the normalized DOC-0 source type. Mirrors the DOC-1 intake
 * mapping (kept local so the engine layer has no dependency on the intake layer).
 */
export function detectSourceType(
  mimeType: string | undefined,
): DocumentSourceType {
  if (typeof mimeType !== 'string') return 'unknown';
  const m = mimeType.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  return 'unknown';
}

/**
 * Select the internal adapter for a document. Images → image OCR. PDFs → text-layer
 * extraction when a text layer is present, otherwise render→OCR (scanned). Without a
 * probe signal a PDF defaults to `pdf_text` (the preferred, cheaper, more accurate
 * path); a real engine falls back to `pdf_scanned` when the probe reports no text.
 * Unknown/unsupported input → `none`.
 */
export function selectAdapterKind(
  input: Pick<DocumentExtractionInput, 'mimeType' | 'sourceType'>,
  signals: SourceSignals = {},
): ResolvedAdapterKind {
  const source = input.sourceType ?? detectSourceType(input.mimeType);
  if (source === 'image') return 'image';
  if (source === 'pdf') {
    return signals.pdfHasTextLayer === false ? 'pdf_scanned' : 'pdf_text';
  }
  return 'none';
}
