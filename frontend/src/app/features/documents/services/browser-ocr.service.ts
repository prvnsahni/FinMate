import { Injectable } from '@angular/core';

/**
 * DOC-3E browser-local image OCR — E2EE-preserving.
 *
 * Runs Tesseract WASM **entirely in the browser**: receipt bytes never leave the device,
 * so this path needs no backend, no server-side decryption, and no AI-Firewall gate. All
 * assets are served **same-origin** from the app's own `/assets` (copied at build time):
 *   - worker  → `assets/tesseract/worker.min.js`
 *   - core    → `assets/tesseract/…` (tesseract.js-core WASM + loaders)
 *   - model   → `assets/tessdata/eng.traineddata` (the committed DOC-6 asset)
 *
 * NETWORK / CDN: `workerPath`/`corePath`/`langPath` are all local URLs, so tesseract.js
 * never reaches its jsdelivr CDN (that fallback only triggers when a path is unset). If a
 * local asset is missing the worker rejects and the caller maps it to `provider_unavailable`
 * — it never silently degrades to a network fetch (fail-closed).
 *
 * PRIVACY: tesseract.js is imported lazily (code-split — never in the initial bundle); no
 * `logger` is attached, so no receipt text/progress is logged; the recognizer receives only
 * image bytes + mime type — never keys, tokens, or E2EE plaintext. It returns text only.
 */

/** Minimal tesseract surface the OCR uses (keeps the loader pluggable for tests). */
export interface TesseractWorkerLike {
  recognize(image: Blob): Promise<{ data: { text?: string } }>;
  terminate(): Promise<unknown>;
}
export interface TesseractLike {
  createWorker(
    lang: string,
    oem: number,
    options: Record<string, unknown>,
  ): Promise<TesseractWorkerLike>;
  OEM: { LSTM_ONLY: number };
}
export type TesseractLoader = () => Promise<TesseractLike>;

@Injectable({ providedIn: 'root' })
export class BrowserOcrService {
  /** Local, same-origin asset locations — NEVER a CDN/external URL. */
  private readonly workerPath = 'assets/tesseract/worker.min.js';
  private readonly corePath = 'assets/tesseract';
  private readonly langPath = 'assets/tessdata';

  /** Pluggable tesseract loader (real code-split browser import by default). */
  private loadTesseract: TesseractLoader = defaultTesseractLoader;

  /** Override the tesseract loader (tests inject a fake; real WASM can't run in Jest). */
  useTesseractLoader(loader: TesseractLoader): this {
    this.loadTesseract = loader;
    return this;
  }

  /**
   * Recognize text from image bytes using the local, in-browser model. Never performs an
   * external/CDN request and never logs document content.
   * @param bytes Raw image bytes from a user-picked File (stay in the browser).
   * @param mimeType The image mime type.
   * @returns Recognized text, trimmed ('' when nothing is detected).
   */
  async recognize(bytes: Uint8Array, mimeType: string): Promise<string> {
    const tesseract = await this.loadTesseract();
    const worker = await tesseract.createWorker(
      'eng',
      tesseract.OEM.LSTM_ONLY,
      {
        workerPath: this.workerPath, // local → same-origin, never the CDN
        corePath: this.corePath, // local WASM core + loaders
        langPath: this.langPath, // local eng.traineddata dir
        gzip: false, // committed asset is uncompressed .traineddata
        cacheMethod: 'none', // never read/write a cache copy
        // No `logger`: receipt text / progress must never be logged.
      },
    );
    try {
      // Copy into a fresh ArrayBuffer-backed view so the Blob type is unambiguous
      // (a plain Uint8Array may be typed as ArrayBufferLike / SharedArrayBuffer).
      const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
      const { data } = await worker.recognize(blob);
      return (data?.text ?? '').trim();
    } finally {
      await worker.terminate();
    }
  }
}

/** Default browser tesseract loader — dynamically imported (code-split) only when OCR runs. */
async function defaultTesseractLoader(): Promise<TesseractLike> {
  return (await import('tesseract.js')) as unknown as TesseractLike;
}
