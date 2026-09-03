import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveTessdataDir } from './local-tesseract-recognizer';

/**
 * DOC-3 OCR hardening — reproducibility gate for the committed offline OCR model.
 *
 * The whole offline-OCR guarantee rests on shipping the EXACT `eng.traineddata` recorded
 * in `PROVENANCE.md`. This test pins its presence, size, and SHA-256 so a missing,
 * corrupted, truncated, or swapped asset fails loudly in CI — never silently degrading to
 * `provider_unavailable` in production or (worse) a wrong model. Values must match
 * `backend/src/assets/tessdata/PROVENANCE.md` (tessdata_fast @ 4.1.0, Apache-2.0).
 */
const EXPECTED_SHA256 =
  '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2';
const EXPECTED_BYTES = 4113088;

// Canonical committed location (source of truth), independent of the runtime resolver.
const CANONICAL_ASSET = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'assets',
  'tessdata',
  'eng.traineddata',
);

describe('offline OCR asset integrity (eng.traineddata)', () => {
  it('is present at the committed source location with the exact pinned size', () => {
    const size = statSync(CANONICAL_ASSET).size;
    expect(size).toBe(EXPECTED_BYTES);
  });

  it('matches the SHA-256 recorded in PROVENANCE.md (exact model, not corrupted/swapped)', () => {
    const hash = createHash('sha256')
      .update(readFileSync(CANONICAL_ASSET))
      .digest('hex');
    expect(hash).toBe(EXPECTED_SHA256);
  });

  it('is discoverable by the runtime resolver and byte-identical to the canonical asset', () => {
    const dir = resolveTessdataDir();
    expect(dir).not.toBeNull();
    const resolved = createHash('sha256')
      .update(readFileSync(resolve(dir as string, 'eng.traineddata')))
      .digest('hex');
    expect(resolved).toBe(EXPECTED_SHA256);
  });
});
