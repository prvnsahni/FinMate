# OCR language data — provenance & license

This directory holds the **local, offline** Tesseract OCR language data used by the
Document Intelligence image adapter. It is committed so OCR never contacts a CDN at
runtime (see `image-extraction.adapter.ts` / `local-tesseract-recognizer.ts`).

## eng.traineddata

| Field | Value |
| ----- | ----- |
| File | `eng.traineddata` |
| Purpose | English OCR model (LSTM, "fast" integer weights) for `tesseract.js` |
| Source repo | https://github.com/tesseract-ocr/tessdata_fast |
| Pinned ref | tag `4.1.0` |
| Download URL | https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/eng.traineddata |
| Size | 4,113,088 bytes (~3.9 MB) |
| SHA-256 | `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` |
| Verified | Byte-identical across two independent mirrors (GitHub raw + jsdelivr gh mirror) |
| License | Apache License 2.0 (per the `tessdata_fast` repository) |

The `tessdata_fast` models are published by the Tesseract OCR project under the
**Apache-2.0** license, which is compatible with this repository's use. This file is an
unmodified copy of the upstream artifact at the pinned tag.

## Why "fast"

`tessdata_fast` gives the smallest footprint (~3.9 MB vs ~15 MB for the standard set) at
a small accuracy cost — appropriate for a bounded, on-device receipt OCR foundation.
Swapping to `tessdata` / `tessdata_best` is a future accuracy/size decision.

## Integrity re-check

```
sha256sum backend/src/assets/tessdata/eng.traineddata
# -> 7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2
```
