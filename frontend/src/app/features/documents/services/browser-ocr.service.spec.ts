import { TestBed } from '@angular/core/testing';
import {
  BrowserOcrService,
  TesseractLike,
  TesseractWorkerLike,
} from './browser-ocr.service';

/**
 * DOC-3E — browser-local OCR guarantees. These tests inject a FAKE tesseract loader (real
 * WASM cannot run in the Jest VM) to prove the local-only configuration, fail-closed
 * behaviour, and that no receipt content/keys are logged. A real end-to-end WASM OCR run
 * requires a browser and is exercised manually / in e2e — not fabricated here.
 */
describe('BrowserOcrService (DOC-3E, browser-local)', () => {
  let service: BrowserOcrService;

  beforeEach(() => {
    service = TestBed.inject(BrowserOcrService);
  });

  /** A fake worker that records the options it was created with. */
  function fakeTesseract(
    text: string,
    opts: { records: Record<string, unknown>[] },
  ): TesseractLike {
    return {
      OEM: { LSTM_ONLY: 1 },
      createWorker: async (
        _lang: string,
        _oem: number,
        options: Record<string, unknown>,
      ) => {
        opts.records.push(options);
        const worker: TesseractWorkerLike = {
          recognize: async () => ({ data: { text } }),
          terminate: async () => undefined,
        };
        return worker;
      },
    };
  }

  it('configures LOCAL worker/core/lang paths — never a CDN/http URL — and returns trimmed text', async () => {
    const records: Record<string, unknown>[] = [];
    service.useTesseractLoader(async () =>
      fakeTesseract('  Milk 120\nTOTAL 120  ', { records }),
    );

    const text = await service.recognize(
      Uint8Array.from([255, 216, 255]),
      'image/jpeg',
    );

    expect(text).toBe('Milk 120\nTOTAL 120');
    expect(records).toHaveLength(1);
    const opts = records[0];
    for (const key of ['workerPath', 'corePath', 'langPath']) {
      const val = String(opts[key]);
      expect(val.startsWith('assets/')).toBe(true); // same-origin, local
      expect(val).not.toMatch(/^https?:|jsdelivr|unpkg|cdn|\/\//i); // never external/CDN
    }
    expect(opts['gzip']).toBe(false);
    expect(opts['cacheMethod']).toBe('none');
    expect('logger' in opts).toBe(false); // no logging of receipt text/progress
  });

  it('FAILS CLOSED when tesseract/assets are unavailable — rejects, never a network fallback', async () => {
    service.useTesseractLoader(async () => {
      throw new Error('assets missing');
    });
    await expect(
      service.recognize(Uint8Array.from([1, 2, 3]), 'image/png'),
    ).rejects.toThrow();
  });

  it('does not log document content, bytes, or keys', async () => {
    const spies = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'info').mockImplementation(() => undefined),
      jest.spyOn(console, 'debug').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    service.useTesseractLoader(async () =>
      fakeTesseract('secret receipt text', { records: [] }),
    );
    await service.recognize(Uint8Array.from([9, 9, 9]), 'image/jpeg');
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
