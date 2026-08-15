# FinMate — Document Extraction Technology Spike (DOC-2)

**Type:** engineering spike / evaluation. **Authorises no provider, no package, no production rollout.** DOC-2 implements the internal **adapter architecture** behind the unchanged DOC-0 `DocumentExtractionEngine` contract, synthetic fixtures, and tests — **no OCR/PDF library is installed and none is selected**. Real extraction is blocked on an explicit package-installation decision (§16, §18).

**Date:** 2026-08-14 · **Branch:** `feature/documentation` · **Builds on:** DOC-0 `8b75e51`, DOC-1 `8a9b9c2`.

**Boundaries preserved (unchanged):** FIN-002 (extraction is candidates-only; golden gate green), E2EE (no server-side decryption; minimized input), AI Firewall (no external/OCR/AI call), DOC-0 contract (not modified), Goal Engine contract, SEC-KI1. Frozen SRS/Ledger/ADR/Matrix untouched.

**Labels:** `CURRENT` = in repo today · `CANDIDATE — NOT SELECTED` = evaluated, not adopted · `[ENGINEERING PARAMETER]` · `[PRODUCT DECISION REQUIRED]` · `[COUNSEL]` · `[PACKAGE DECISION]`.

---

## 1. Current repository capabilities `CURRENT`

| Capability | State | Evidence |
|---|---|---|
| Spreadsheet parse | `xlsx` (SheetJS) present — used by tabular import. | root `package.json` (`"xlsx": "^0.18.5"`) |
| PDF text/table extraction | **None.** No `pdfjs-dist`/`pdf-parse`/`mupdf`. | dependency grep — none |
| OCR | **None.** No `tesseract`/`tesseract.js`/cloud OCR SDK. | dependency grep — none |
| Image rasterization | **None.** No `canvas`/`@napi-rs/canvas`/`sharp`/`jimp`. | dependency grep — none |
| Extraction contract | DOC-0 `DocumentExtractionEngine` + result envelope + `computeReconciliation` + stub. | `document-intelligence/engine/*` |
| Intake boundary | DOC-1 TOTAL_ONLY / ITEMIZED, owner-scoped, flag-gated, minimized input. | `document-intelligence/intake/*` |

**Conclusion:** FinMate can, today, parse spreadsheets — but has **zero** image/PDF extraction capability. Any real receipt/PDF extraction requires at least one new package. **DOC-2 therefore builds the architecture and defers the package/provider choice.**

## 2. Image extraction options

Receipts are overwhelmingly photos → the image path is the highest-value, lowest-structure target.

| Option | Class | Privacy | Accuracy (receipts) | Notes |
|---|---|---|---|---|
| **Tesseract.js (WASM)** `CANDIDATE — NOT SELECTED` | on-device OCR | **Best** — in-process, no external call | Moderate; needs preprocessing (deskew/threshold) for photos | Apache-2.0; ~a few MB WASM + language data; runs in Node and browser |
| Native Tesseract binding | server OCR | server sees bytes | Moderate–good | Native build/deploy complexity |
| Managed OCR / Document-AI | cloud | bytes leave device → **AI Firewall + OQ-03 + ZDR** | High | `CANDIDATE — NOT SELECTED`; blocked (§10) |
| VLM (vision LLM) | cloud AI | bytes+prompt leave → firewall + injection risk | High, structure-aware | `CANDIDATE — NOT SELECTED`; blocked (§10) |

## 3. Text-PDF options

Online/general invoices are frequently **text-layer PDFs** — extractable **without OCR** at high fidelity.

| Option | Class | Privacy | Notes |
|---|---|---|---|
| **pdfjs-dist** `CANDIDATE — NOT SELECTED` | local text + layout | in-process | Mozilla, Apache-2.0; text with positions (provenance); runs in Node/browser |
| **pdf-parse** `CANDIDATE — NOT SELECTED` | local text | in-process | MIT; simpler text-only (weaker table/position data) |
| Table extraction (heuristics on positioned text) | local | in-process | Built on pdfjs positions; `[ENGINEERING PARAMETER]` column detection |

## 4. Scanned-PDF options

Image-only PDFs → **render pages, then OCR** (compose §3 render + §2 OCR).

| Option | Class | Privacy | Notes |
|---|---|---|---|
| pdfjs render → raster → Tesseract.js `CANDIDATE — NOT SELECTED` | on-device | in-process | Needs a rasterizer (`canvas`/`@napi-rs/canvas`) — heaviest path |
| Managed Document-AI | cloud | leaves device | blocked (§10) |

## 5. Candidate technologies (summary — none selected)

| Tech | Handles | On-device | License | Approx. weight | Verdict |
|---|---|---|---|---|---|
| Tesseract.js | image, scanned-PDF (with raster) | ✅ | Apache-2.0 | WASM + lang data (MB) | `CANDIDATE — NOT SELECTED` |
| pdfjs-dist | text-PDF, PDF render | ✅ | Apache-2.0 | moderate | `CANDIDATE — NOT SELECTED` |
| pdf-parse | text-PDF (text only) | ✅ | MIT | small | `CANDIDATE — NOT SELECTED` |
| canvas / @napi-rs/canvas | rasterize PDF pages | ✅ | MIT-ish | native build | `CANDIDATE — NOT SELECTED` |
| Managed OCR / Document-AI | all | ❌ | commercial | n/a | `CANDIDATE — NOT SELECTED` (firewall/OQ-03) |
| VLM extraction | all | ❌ | commercial | n/a | `CANDIDATE — NOT SELECTED` (firewall/injection) |

## 6. Fixture results

Synthetic, data-only fixtures (no images/binaries/PII) in `engine/__fixtures__/receipts.fixtures.ts` — A grocery (balanced), B retail, C restaurant (tax+tip), D fuel, E multi-page **text-PDF**, F **scanned-PDF**, G poor-quality/rotated, H ambiguous chars (items under total), I sum-exceeds-total. These are the **extraction target** (ground truth), not extraction output — **no OCR ran** (no package). They drive the reconciliation and routing tests.

**What executed today (architecture, not OCR):** source detection routes image→image, text-PDF→pdf_text, scanned-PDF→pdf_scanned, unsupported→none; the `LocalDocumentExtractionEngine` delegates to the matching adapter and returns an explicit `provider_unavailable` (no fabricated values); when a fake adapter supplies a total+items, the engine runs `computeReconciliation` and surfaces BALANCED/UNDER/OVER.

## 7. Accuracy observations

**Not measurable in DOC-2** — no extractor ran. The fixtures define a scoring rubric for the DOC-3 spike (once a package is approved): per fixture record text-detection, merchant/date/total/currency accuracy, line-item/qty/unit-price/line-total detection, and reconciliation result. **Expected** (industry-typical, unverified): text-PDF ≫ clean receipt image ≫ rotated/low-quality image; Indian GST/multi-currency and handwriting remain weak spots. Any unreadable field must be returned **missing/uncertain — never fabricated**.

## 8. Reconciliation observations `CURRENT`

`computeReconciliation` (DOC-0) is provider-independent and already correct: 685=685 → BALANCED; 640 vs 685 → UNDER_ALLOCATED (Δ 45); 700 vs 685 → OVER_ALLOCATED (Δ −15). Verified against fixtures **and** end-to-end through the engine mapping. It **surfaces** the difference and never alters a value — the FIN-002 guarantee holds regardless of which extractor is later chosen.

## 9. Performance observations

Not measurable (no extractor). Expected order: text-PDF (ms, no OCR) < image OCR (Tesseract.js: ~hundreds ms–seconds/page, device-bound) < scanned-PDF (render + OCR, compounded). `[ENGINEERING PARAMETER]` per-document timeout, page cap, and whether OCR runs on-device (client) or in a worker.

## 10. Privacy / security implications

- **On-device-first is the privacy-preserving default:** Tesseract.js / pdfjs run in-process → bytes never leave the device, so they need **no AI Firewall change and do not touch OQ-03**. This is the recommended class.
- **Any managed/cloud OCR or VLM** sends document bytes/text off-device → requires the **AI Firewall TARGET controls** (fail-closed, projections-not-raw, consent, ZDR) and clears **OQ-03** (counsel, cross-border transfer). **Blocked in DOC-2; none used.**
- **E2EE:** DOC-2 never decrypts stored attachments and never receives keys. The engine input is the DOC-1 minimized descriptor (opaque ref + coarse metadata). Verified: no key/token/PII reaches the engine or adapters; no document content logged.
- **FIN-002:** extraction is candidates-only; no finance-write/decrypt/external surface on the engine (asserted by tests).

## 11. Licensing considerations

Tesseract.js (Apache-2.0), pdfjs-dist (Apache-2.0), pdf-parse (MIT), canvas (MIT) — all permissive and compatible. Managed/cloud services carry commercial terms + data-processing agreements `[COUNSEL]`. **No license obligation is incurred until a package is actually added (approval-gated).**

## 12. Cost considerations

On-device libraries: **$0 marginal** per document (compute is the user's device or existing server). Managed OCR / VLM: **per-page / per-token** cost + egress — `CANDIDATE — NOT SELECTED`. On-device-first keeps document intelligence at zero incremental unit cost.

## 13. Deployment complexity

- pdf-parse / Tesseract.js (WASM): simplest — pure JS/WASM, no native build. Bundle/asset weight is the main cost (lazy-load language data). `[ENGINEERING PARAMETER]`.
- `canvas`/native bindings: native compilation in CI/containers → higher complexity; needed only for scanned-PDF rendering.
- Managed OCR: SDK + credentials + network + firewall wiring → highest.

## 14. Offline / on-device possibility

**Yes.** The image and text-PDF paths (and, with a rasterizer, scanned-PDF) can run entirely on-device via WASM/JS. This aligns with the readiness §8/§A10 recommendation to **test on-device OCR first** and preserves E2EE with no firewall dependency. This is the decisive advantage of the on-device class.

## 15. Recommended architecture `CURRENT` (implemented in DOC-2)

```
DocumentExtractionEngine (DOC-0 contract — unchanged)
        │
        ▼
 source detection (detectSourceType + selectAdapterKind)   ← pure, no package
        │
        ├── image        → ImageExtractionAdapter      (candidate: Tesseract.js WASM)
        ├── pdf_text      → PdfTextExtractionAdapter    (candidate: pdfjs-dist / pdf-parse)
        └── pdf_scanned   → PdfScanExtractionAdapter    (candidate: pdfjs render → Tesseract.js)
        │
        ▼
 normalized AdapterExtraction → (total + items) → computeReconciliation → DocumentExtractionResult
```

Adapters are an **internal detail**: the caller only ever sees a `DocumentExtractionResult` — never a `TesseractResult`/`PdfParserResult`/vendor result. Engines compose as `Stub → Local → Better` with **zero consumer change**. DOC-2 ships this with **stub adapters** (`provider_unavailable`) so the wiring/detection/reconciliation are verified while the package/provider stays undecided.

## 16. Recommended next step

**On-device-first, text-PDF-first.** For DOC-3, request approval to add — in priority order — **(1) pdfjs-dist** (unlocks text-PDF at high fidelity, no OCR, lightest privacy/complexity), then **(2) Tesseract.js** (image + scanned-PDF-with-render). Then run the DOC-3 measured spike against the §6 fixtures using the §7 rubric. **No managed/cloud OCR or VLM** until (a) on-device accuracy is proven insufficient and (b) the AI Firewall controls + OQ-03 counsel are cleared. **DOC-2 stops here — installing these packages is the first DOC-3 action and requires explicit approval (§18).**

## 17. Explicitly unselected providers

`CANDIDATE — NOT SELECTED`: Tesseract.js · pdfjs-dist · pdf-parse · node-canvas/@napi-rs/canvas · any managed OCR / Document-AI (Google/AWS/Azure) · any VLM (OpenAI/Gemini/Claude vision). **None installed, none integrated, none called.** The repo/frozen docs mandate none.

## 18. Open engineering / product / counsel decisions

- `[PACKAGE DECISION]` install pdfjs-dist and/or Tesseract.js for DOC-3 (on-device, permissive-licensed). **Awaiting explicit approval** — see the DOC-2 report.
- `[ENGINEERING PARAMETER]` text-layer probe heuristic (chars/page) for pdf_text vs pdf_scanned; per-document timeout / page cap / image size cap; where OCR runs (client vs server worker); confidence scale + thresholds; table-column detection.
- `[PRODUCT DECISION REQUIRED]` whether extracted line items become an entity or attachment-scoped metadata (readiness §23); review-UX shape (DOC-4).
- `[COUNSEL]` any future managed/cloud OCR (cross-border transfer, OQ-03, ZDR); classification of any newly stored derived field.

---

## Reconciliation (this batch)

- ✅ Adapter architecture + source detector + `LocalDocumentExtractionEngine` implemented behind the **unchanged** DOC-0 contract; stub remains the bound engine (no behaviour change).
- ✅ Synthetic fixtures (no images/binaries/PII) + tests: routing, reconciliation (BALANCED/UNDER/OVER), no-fabrication, replaceability, no finance-write/decrypt/external surface.
- ✅ **No package installed, no provider selected, no external service called, no migration, no finance change, no E2EE decryption, no DOC-0 contract change, no AI-Firewall change.**
- ⛔ Real OCR/PDF extraction is **blocked on a package decision** (§16/§18) — reported, not resolved.

**One-line status:** *Extraction architecture is ready and contract-verified; the technology choice narrows to an on-device-first, text-PDF-first path (pdfjs-dist then Tesseract.js), pending an explicit package-install approval for DOC-3. No provider selected.*

*End of spike. Authorises no package, provider, external call, migration, or production change.*
