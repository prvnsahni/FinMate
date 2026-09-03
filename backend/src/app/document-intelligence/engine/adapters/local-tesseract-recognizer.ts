import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { OcrRecognizer } from './image-extraction.adapter';

/**
 * DOC-6 local-only tesseract.js recognizer.
 *
 * Runs English OCR **entirely on-device**. It loads the WASM core + worker from the
 * installed `tesseract.js` / `tesseract.js-core` packages (a local `require` in Node —
 * never a network call) and the `eng.traineddata` model from the committed local asset
 * under `backend/src/assets/tessdata/`.
 *
 * NETWORK IS NEVER CONTACTED:
 *  - `langPath` is set to a LOCAL directory, so tesseract.js reads the model from the
 *    filesystem; its jsdelivr CDN fallback only triggers when `langPath` is UNSET.
 *  - a pre-flight guard refuses to run (throws) when the local asset is absent, instead
 *    of letting anything fall through to a fetch.
 *  - `cacheMethod: 'none'` — no cache copy is read or written.
 *
 * PRIVACY: `tesseract.js` is imported lazily so it is never pulled into the module graph
 * unless OCR actually runs; no logger is attached, so no document text/progress is ever
 * logged; the recognizer receives only image bytes + mime type — never keys, tokens, or
 * E2EE plaintext. It returns recognized text only and mutates no state.
 */

const ENG_FILE = 'eng.traineddata';

/** Candidate locations for the committed local tessdata directory (dev / test / build). */
function candidateTessdataDirs(): string[] {
  const fromEnv = process.env.OCR_TESSDATA_PATH;
  return [
    ...(fromEnv ? [fromEnv] : []),
    // Bundled/deployed layout: the webpack build copies `src/assets` next to the bundle
    // (NxAppWebpackPlugin `assets`), so from `dist/backend/main.js` the model lives at
    // `dist/backend/assets/tessdata`.
    resolve(__dirname, 'assets', 'tessdata'),
    // Dev/test (ts source): engine/adapters -> ../../../../assets/tessdata (backend/src/assets/tessdata).
    resolve(__dirname, '..', '..', '..', '..', 'assets', 'tessdata'),
    // From the process CWD (repo root or the backend project/deploy root).
    resolve(process.cwd(), 'backend', 'src', 'assets', 'tessdata'),
    resolve(process.cwd(), 'src', 'assets', 'tessdata'),
    resolve(process.cwd(), 'assets', 'tessdata'),
  ];
}

/** The local tessdata directory that actually contains `eng.traineddata`, or null. */
export function resolveTessdataDir(): string | null {
  for (const dir of candidateTessdataDirs()) {
    if (existsSync(join(dir, ENG_FILE))) return dir;
  }
  return null;
}

/**
 * True iff the local English OCR asset is present. This is a pure filesystem check — it
 * never attempts a network request. When false, the image adapter returns
 * `provider_unavailable` rather than reaching for a CDN.
 */
export function engLangDataAvailable(): boolean {
  return resolveTessdataDir() !== null;
}

/** Local-only tesseract.js OCR recognizer. */
export class LocalTesseractRecognizer implements OcrRecognizer {
  constructor(
    private readonly tessdataDir: string | null = resolveTessdataDir(),
  ) {}

  /**
   * Recognize text from image bytes using the local model. Never performs a network
   * call and never logs document content.
   * @param bytes Raw image bytes (jpeg/png/webp/bmp) supplied at the processing boundary.
   * @param _mimeType The image mime type (unused by tesseract; kept for the seam contract).
   * @returns The recognized text, trimmed ('' when nothing is detected).
   */
  async recognize(bytes: Uint8Array, _mimeType: string): Promise<string> {
    const dir = this.tessdataDir;
    if (!dir) {
      // Defense-in-depth: never fall through to a network fetch.
      throw new Error(
        'Local OCR language data (eng.traineddata) not found; refusing a network fetch.',
      );
    }

    // Lazy import: tesseract.js stays out of the module graph unless OCR actually runs.
    const { createWorker, OEM } = await import('tesseract.js');
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
      langPath: dir, // LOCAL directory → filesystem read, never the CDN.
      gzip: false, // The committed asset is an uncompressed .traineddata.
      cacheMethod: 'none', // Never read or write a cache copy.
      // No `logger`: document text / progress must never be logged.
    });
    try {
      const { data } = await worker.recognize(Buffer.from(bytes));
      return (data?.text ?? '').trim();
    } finally {
      await worker.terminate();
    }
  }
}
