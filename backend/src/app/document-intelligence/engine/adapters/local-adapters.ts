import { AdapterKind, ExtractionAdapter } from './extraction-adapter.types';
import { ImageExtractionAdapter } from './image-extraction.adapter';
import { PdfTextExtractionAdapter } from './pdf-text-extraction.adapter';
import { PdfScanExtractionAdapter } from './pdf-scan-extraction.adapter';

/**
 * The DOC-3 real local adapter set (on-device, no external provider):
 *   - image       → ImageExtractionAdapter   (tesseract.js, safe-no-network by default)
 *   - pdf_text    → PdfTextExtractionAdapter  (pdfjs-dist text layer)
 *   - pdf_scanned → PdfScanExtractionAdapter  (render→OCR — rasterizer boundary reported)
 */
export function defaultLocalAdapters(): Record<AdapterKind, ExtractionAdapter> {
  return {
    image: new ImageExtractionAdapter(),
    pdf_text: new PdfTextExtractionAdapter(),
    pdf_scanned: new PdfScanExtractionAdapter(),
  };
}
