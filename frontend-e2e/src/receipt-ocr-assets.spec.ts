import { test, expect } from '@playwright/test';

/**
 * DOC-3F — browser-level guardrails for the local receipt OCR path.
 *
 * These two checks need only the served frontend (no auth, no feature flag): they prove the
 * privacy-critical invariants of DOC-3E/3F in a real browser —
 *   (1) the Tesseract worker/core/model are served SAME-ORIGIN from `/assets`, and
 *   (2) loading the app triggers NO request to any external OCR/CDN host.
 *
 * The remaining end-to-end steps (synthetic receipt image → local OCR → DOC-4 review →
 * confirm → expense-modal prefill → explicit submit) require the build to have
 * `documentIntelligence` ON plus an authenticated session, and are validated manually /
 * in a flag-enabled e2e run — they are intentionally NOT asserted here so this file stays
 * runnable without enabling the feature in production config.
 *
 * NOTE: not executed in the current dev environment (no served stack/browsers here); it
 * runs under the standard `frontend-e2e` Playwright harness (BASE_URL served app).
 */

const OCR_CDN_HOSTS =
  /jsdelivr\.net|unpkg\.com|cdn\.|tessdata|githubusercontent\.com/i;

test.describe('DOC-3F local OCR asset guardrails', () => {
  test('Tesseract worker, core WASM, and eng.traineddata are served same-origin', async ({
    request,
    baseURL,
  }) => {
    for (const path of [
      '/assets/tesseract/worker.min.js',
      '/assets/tesseract/tesseract-core-lstm.wasm',
      '/assets/tessdata/eng.traineddata',
    ]) {
      const res = await request.get(`${baseURL}${path}`);
      expect(res.ok(), `${path} should be served locally (200)`).toBeTruthy();
    }
  });

  test('loading the app makes NO request to an external OCR/CDN host', async ({
    page,
  }) => {
    const external: string[] = [];
    page.on('request', (req) => {
      if (OCR_CDN_HOSTS.test(req.url())) external.push(req.url());
    });
    await page.goto('/');
    // tesseract.js is code-split and only imported during an actual OCR run — a plain app
    // load must pull NOTHING from an external OCR/CDN host.
    expect(
      external,
      `no OCR/CDN requests expected, saw: ${external.join(', ')}`,
    ).toEqual([]);
  });
});
