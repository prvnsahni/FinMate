import { ImageExtractionAdapter, OcrRecognizer } from './image-extraction.adapter';
import { AdapterContent } from './extraction-adapter.types';

const imageContent: AdapterContent = {
  bytes: Uint8Array.from([255, 216, 255]), // JPEG magic
  sourceType: 'image',
  mimeType: 'image/jpeg',
};

describe('ImageExtractionAdapter (tesseract.js, safe-by-default)', () => {
  it('returns provider_unavailable WITHOUT invoking any recognizer when local language data is absent', async () => {
    const recognize = jest.fn();
    // No recognizer injected + langDataAvailable() false → must NOT run OCR / network.
    const adapter = new ImageExtractionAdapter(undefined, () => false);
    const out = await adapter.extract(imageContent);
    expect(out.status).toBe('provider_unavailable');
    expect(out.warnings.join(' ')).toMatch(/language data|network/i);
    expect(recognize).not.toHaveBeenCalled();
  });

  it('parses OCR text into candidates when a local recognizer IS provided (no fabrication)', async () => {
    const recognizer: OcrRecognizer = {
      recognize: async () => 'Example Market\nMilk 120\nRice 520\nTOTAL INR 685',
    };
    const adapter = new ImageExtractionAdapter(recognizer);
    const out = await adapter.extract(imageContent);
    expect(out.header?.total?.value).toBe(685);
    expect(out.header?.total?.authority).toBe('EXTRACTED');
    expect((out.lineItems?.length ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it('returns no_text_detected when OCR yields nothing', async () => {
    const adapter = new ImageExtractionAdapter({ recognize: async () => '' });
    expect((await adapter.extract(imageContent)).status).toBe('no_text_detected');
  });

  it('rejects non-image content', async () => {
    const adapter = new ImageExtractionAdapter({ recognize: async () => 'x' });
    const out = await adapter.extract({ ...imageContent, sourceType: 'pdf', mimeType: 'application/pdf' });
    expect(out.status).toBe('invalid_input');
  });
});
