import { PdfScanExtractionAdapter } from './pdf-scan-extraction.adapter';
import { AdapterContent } from './extraction-adapter.types';

const scannedPdf: AdapterContent = {
  bytes: Uint8Array.from([37, 80, 68, 70]),
  sourceType: 'pdf',
  mimeType: 'application/pdf',
};

describe('PdfScanExtractionAdapter (rasterizer boundary)', () => {
  it('reports provider_unavailable — scanned-PDF OCR needs a rasterizer outside the approved set', async () => {
    const out = await new PdfScanExtractionAdapter().extract(scannedPdf);
    expect(out.status).toBe('provider_unavailable');
    expect(out.warnings.join(' ')).toMatch(/rasteriz|canvas/i);
    expect(out.header).toBeUndefined();
    expect(out.lineItems).toBeUndefined();
  });

  it('declares its required packages (incl. the unapproved rasterizer)', () => {
    const req = new PdfScanExtractionAdapter().requirement;
    expect(req.requiredPackages.join(' ')).toMatch(/canvas/i);
    expect(req.processesLocally).toBe(true);
  });
});
