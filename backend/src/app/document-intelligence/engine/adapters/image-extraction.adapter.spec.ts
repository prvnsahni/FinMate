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

  it('ADVERSARIAL: passes ONLY image bytes + mime type to the recognizer — never keys/tokens/PII', async () => {
    const seen: Array<{ argCount: number; bytes: unknown; mime: unknown }> = [];
    const recognizer: OcrRecognizer = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognize: async (...args: any[]) => {
        seen.push({ argCount: args.length, bytes: args[0], mime: args[1] });
        return 'Milk 120\nTOTAL 120';
      },
    };
    const adapter = new ImageExtractionAdapter(recognizer);
    // Even if an attacker smuggles extra fields onto the content, they must not reach OCR.
    await adapter.extract({
      ...imageContent,
      // @ts-expect-error — these fields are not part of AdapterContent and must be ignored.
      encryptedFileKey: 'wrapped-secret',
      authToken: 'bearer-secret',
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].argCount).toBe(2); // bytes + mime only
    expect(seen[0].bytes).toBe(imageContent.bytes);
    expect(seen[0].mime).toBe(imageContent.mimeType);
    expect(JSON.stringify(seen[0])).not.toMatch(/wrapped-secret|bearer-secret/);
  });

  it('by DEFAULT gates OCR on a real local filesystem check (no network) — asset present ⇒ not provider_unavailable', async () => {
    // Default constructor uses engLangDataAvailable (a pure fs check). With the committed
    // asset present it does NOT short-circuit to provider_unavailable; we inject a fake
    // recognizer so no real worker runs, proving the gate is the filesystem, never a fetch.
    const adapter = new ImageExtractionAdapter({ recognize: async () => 'Milk 120\nTOTAL 120' });
    const out = await adapter.extract(imageContent);
    expect(out.status).not.toBe('provider_unavailable');
    expect(out.header?.total?.value).toBe(120);
  });
});
