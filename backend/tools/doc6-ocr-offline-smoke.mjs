/**
 * DOC-6 — OFFLINE image-OCR smoke harness (not a Jest test; run manually).
 *
 * Proves the tesseract.js image path is genuinely LOCAL/OFFLINE:
 *   1. Hard-blocks the network (patches http/https request + global fetch to throw).
 *   2. Generates a synthetic receipt image in pure Node (no rasterizer package).
 *   3. Runs a tesseract worker configured EXACTLY as LocalTesseractRecognizer does
 *      (local core via node require, `langPath` → the committed eng.traineddata, no CDN).
 *   4. Reports the recognized text.
 *
 * If OCR completes with the network blocked, nothing was fetched — the pipeline is offline.
 *
 * Run:  node backend/tools/doc6-ocr-offline-smoke.mjs
 */
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- 1. HARD NETWORK KILL-SWITCH -------------------------------------------------
// Any outbound HTTP(S) — including node-fetch, which tesseract.js uses in Node — must
// throw. If OCR still succeeds, it proves no network was contacted.
let networkAttempts = 0;
const boom =
  (what) =>
  (...args) => {
    networkAttempts += 1;
    const url =
      typeof args[0] === 'string'
        ? args[0]
        : (args[0]?.href ?? args[0]?.hostname ?? '?');
    throw new Error(`NETWORK BLOCKED (${what}) → ${url}`);
  };
http.request = boom('http.request');
http.get = boom('http.get');
https.request = boom('https.request');
https.get = boom('https.get');
globalThis.fetch = boom('fetch');

// ---- 2. SYNTHETIC RECEIPT IMAGE (pure Node, uncompressed 24-bit BMP) --------------
// A compact 5x7 bitmap font for exactly the glyphs we render, scaled up into big clean
// blocks that Tesseract can read without anti-aliasing.
const FONT = {
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
const TEXT = 'TOTAL 120';
const SCALE = 14; // each font pixel → 14×14 block
const MARGIN = 40; // white quiet zone
const GLYPH_W = 5;
const GLYPH_H = 7;
const GAP = 1; // 1 font-pixel gap between glyphs

const cols = TEXT.length * (GLYPH_W + GAP) - GAP;
const width = MARGIN * 2 + cols * SCALE;
const height = MARGIN * 2 + GLYPH_H * SCALE;

// White canvas (RGB per pixel).
const pixel = (r, g, b) => [b, g, r]; // BMP stores BGR
const white = pixel(255, 255, 255);
const black = pixel(0, 0, 0);
const rows = Array.from({ length: height }, () =>
  Array.from({ length: width }, () => white),
);

let penX = MARGIN;
for (const ch of TEXT) {
  const glyph = FONT[ch] ?? FONT[' '];
  for (let gy = 0; gy < GLYPH_H; gy++) {
    for (let gx = 0; gx < GLYPH_W; gx++) {
      if (glyph[gy][gx] === '1') {
        for (let sy = 0; sy < SCALE; sy++) {
          for (let sx = 0; sx < SCALE; sx++) {
            const px = penX + gx * SCALE + sx;
            const py = MARGIN + gy * SCALE + sy;
            rows[py][px] = black;
          }
        }
      }
    }
  }
  penX += (GLYPH_W + GAP) * SCALE;
}

// Encode BMP (bottom-up, rows padded to 4 bytes).
const rowStride = Math.ceil((width * 3) / 4) * 4;
const pixelDataSize = rowStride * height;
const fileSize = 54 + pixelDataSize;
const buf = Buffer.alloc(fileSize);
buf.write('BM', 0);
buf.writeUInt32LE(fileSize, 2);
buf.writeUInt32LE(54, 10); // pixel data offset
buf.writeUInt32LE(40, 14); // DIB header size
buf.writeInt32LE(width, 18);
buf.writeInt32LE(height, 22);
buf.writeUInt16LE(1, 26); // planes
buf.writeUInt16LE(24, 28); // bpp
buf.writeUInt32LE(pixelDataSize, 34);
let off = 54;
for (let y = height - 1; y >= 0; y--) {
  for (let x = 0; x < width; x++) {
    const [b, g, r] = rows[y][x];
    buf[off++] = b;
    buf[off++] = g;
    buf[off++] = r;
  }
  off = 54 + (height - y) * rowStride; // account for padding
}

// ---- 3. OCR with the SAME local-only config as LocalTesseractRecognizer -----------
const tessdataDir = resolve(__dirname, '..', 'src', 'assets', 'tessdata');
if (!existsSync(resolve(tessdataDir, 'eng.traineddata'))) {
  console.error('FAIL: committed eng.traineddata not found at', tessdataDir);
  process.exit(2);
}

const { createWorker, OEM } = await import('tesseract.js');
console.log(
  `[smoke] image ${width}×${height} BMP; langPath=${tessdataDir}; network=BLOCKED`,
);
const t0 = Date.now();
const worker = await createWorker('eng', OEM.LSTM_ONLY, {
  langPath: tessdataDir,
  gzip: false,
  cacheMethod: 'none',
});
try {
  const { data } = await worker.recognize(buf);
  const text = (data?.text ?? '').trim();
  console.log(
    `[smoke] OCR completed in ${Date.now() - t0} ms with ${networkAttempts} network attempts (must be 0).`,
  );
  console.log('[smoke] recognized text:', JSON.stringify(text));
  const digitsOk = text.replace(/\s+/g, '').includes('120');
  console.log(`[smoke] contains "120": ${digitsOk}`);
  console.log(
    `[smoke] RESULT: offline pipeline ${networkAttempts === 0 ? 'PROVEN (no network)' : 'FAILED (network used)'}`,
  );
} finally {
  await worker.terminate();
}
