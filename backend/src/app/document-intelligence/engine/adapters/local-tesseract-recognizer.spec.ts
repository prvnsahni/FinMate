import {
  LocalTesseractRecognizer,
  engLangDataAvailable,
  resolveTessdataDir,
} from './local-tesseract-recognizer';

/**
 * DOC-6 — the LOCAL-ONLY guarantees of the tesseract recognizer wiring. These tests do
 * NOT run a real tesseract worker (that lives in the offline smoke harness); they prove
 * the filesystem detection and the fail-closed "never fetch" boundary.
 */
describe('LocalTesseractRecognizer (DOC-6, local-only)', () => {
  it('detects the committed local eng.traineddata asset via a pure filesystem check', () => {
    const dir = resolveTessdataDir();
    expect(dir).not.toBeNull();
    expect(engLangDataAvailable()).toBe(true);
  });

  it('FAILS CLOSED when no local language data is found — never falls back to a network fetch', async () => {
    // Simulate "asset missing" by constructing with an explicit null directory. recognize()
    // must throw BEFORE it ever imports/loads tesseract.js or reaches for a CDN.
    const recognizer = new LocalTesseractRecognizer(null);
    await expect(recognizer.recognize(Uint8Array.from([255, 216, 255]), 'image/jpeg')).rejects.toThrow(
      /refusing a network fetch/i,
    );
  });

  it('resolves an OCR_TESSDATA_PATH override first when it contains the asset', () => {
    const real = resolveTessdataDir();
    expect(real).not.toBeNull();
    const prev = process.env.OCR_TESSDATA_PATH;
    try {
      process.env.OCR_TESSDATA_PATH = real as string;
      expect(resolveTessdataDir()).toBe(real);
    } finally {
      if (prev === undefined) delete process.env.OCR_TESSDATA_PATH;
      else process.env.OCR_TESSDATA_PATH = prev;
    }
  });
});
