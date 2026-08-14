# FinMate — Document Intelligence + Dynamic Taxonomy: Readiness / Architecture Assessment

**Type:** READ-ONLY readiness assessment. **Authorises nothing.** No code, schema, migration, entity, DTO, API/OpenAPI contract, package, OCR/ML provider, training pipeline, production, or user-data-collection change is made or implied by this document.

**Date:** 2026-08-14 · **Branch:** `feature/documentation` · **Baseline HEAD at assessment:** `abec60d` (Goals-v2 backend `c9c290d` + frontend `abec60d`, QA-verified).

**Companion (parking) doc — not modified by this file:** [`FINMATE_DOCUMENT_INTELLIGENCE_AND_DYNAMIC_TAXONOMY_FUTURE.md`](./FINMATE_DOCUMENT_INTELLIGENCE_AND_DYNAMIC_TAXONOMY_FUTURE.md). That document *parks the direction*; this document is a *repository-grounded readiness assessment* that inventories what exists today, tests feasibility against the frozen boundaries, and lists the decisions/gates that must precede any implementation. Neither authorises code.

**Frozen boundaries preserved and NOT altered here:** SRS v1.0 (FROZEN 2026-08-12) · Decision Ledger · Data Classification & Encryption Matrix (#2) · Security & Privacy Architecture (#3) · Key Management (#4) · AI Data-Access & Privacy Firewall (#5) · IP/AI Confidentiality (#6) · Threat Model (#7) · Ownership Map (#15) · API & Data Contracts (#16) · Backward-Compat & Migration Plan (#17) · Roadmap · Execution Plan · Goal Engine Architecture & Contract · ADRs. **FIN-002 finance parity, E2EE, AI Firewall, REC-1, Goal Engine contract, and SEC-KI1 remain untouched.**

## Classification legend

`CURRENT` = exists in the repo today (evidence cited) · `VERIFIED` = existence/behaviour confirmed by inspection this pass · `TARGET` = intended future capability behind a stable contract · `FUTURE` = parked, not scheduled · `[PRODUCT DECISION REQUIRED]` · `[ENGINEERING PARAMETER]` · `[COUNSEL]` · `[PRODUCTION VERIFICATION]` · `[OPEN QUESTION]`. **A TARGET/FUTURE idea is never described as CURRENT reality.**

---

## 1. Executive conclusion

`VERIFIED` FinMate today has a **usable substrate** for document intelligence but **zero** of the intelligence itself. Specifically, it already has: file **attachment + receipt-versioning** storage with per-file key wrapping (`attachments`, `receipt_versions`), a **tabular import** path (`POST /import/expenses`, CSV/XLSX via SheetJS), **server-readable structured metadata reporting** (`analytics/categories` grouped on the plaintext `category` field), an **E2EE-safe soft-duplicate** check (`findPotentialDuplicates` — matches amount+date+currency+scope, deliberately **excludes** the E2EE title), a **replaceable-engine** precedent (`GoalEngine`), and a **FIN-002 parity harness**. What does **not** exist: any OCR/extraction, any line-item model, any tag/taxonomy entity, any classification engine, any statement parser, any population learning.

`TARGET` The right shape is exactly the parking doc's one rule: **freeze two interfaces — `DocumentExtractionEngine` and `ClassificationEngine` — mirroring `GoalEngine`, and keep extraction/classification a descriptive metadata layer that produces *candidates*, never a mutation path into the financial record.** The single largest risk is not OCR accuracy; it is **scope-and-privacy creep** — an extraction/tagging feature becoming a backdoor to (a) server-readable free-text, (b) silent financial mutation, or (c) silent training on private data. Each is independently prohibited by the frozen stack and must stay prohibited.

**Recommendation:** do **not** start implementation. The near-term, low-risk, high-value slice is **Total-only + attachment (already 90% present)** and **contract design** (the two engine interfaces + the extraction result model as *documentation*), gated behind the decisions in §28–§30. OCR, tagging, taxonomy, CC-statement extraction, and any learning remain **NOT-NOW** (§35).

---

## 2. Current repository reality (evidence-backed baseline)

| Concern | CURRENT state | Evidence |
|---|---|---|
| Expense text | `title`, `description` = `text`, **E2EE client-side** (Zone-1a). | `shared/data-models/src/lib/expense.entity.ts:37-41`; `FINMATE_DATA_CLASSIFICATION_ENCRYPTION_MATRIX.md:103-104` |
| Expense financials | `amount_total` decimal(12,2), `currency` char(3), `category` varchar(64) — **plaintext, server-readable (Zone-2)**. `transactionType` expense/refund; `encryptionScope` personal/group/direct_shared; `@VersionColumn`; soft-delete. | `expense.entity.ts:43-121`; Matrix `:105-107` |
| Line items | **Do not exist.** Expense holds a single total; no per-item rows. | `expense.entity.ts` (no item relation) |
| Category | **Single flat** `varchar(64)`, indexed `['group','category']`. No hierarchy, no per-item categories. | `expense.entity.ts:53-54,28` |
| Tags / taxonomy | **Do not exist.** No tag entity, no taxonomy table, no aliases/lifecycle. | repository — no such entity |
| Attachments | `attachments`: `storageKey`, `originalName`, `mimeType`, `sizeBytes`, `checksumSha256`, **`encryptedFileKey`** (per-file key wrapped under the scope key), **`encryptedOriginalName`** (E2EE). Attach target is expense/note/goal/group (CHECK-constrained). | `attachment.entity.ts:16-74` |
| Receipt versioning | `receipt_versions`: `action` created/replaced/deleted, `snapshot jsonb`, `actorUser`, indexed by `(expense, createdAt)`. | `receipt-version.entity.ts` |
| OCR / doc extraction | **Does not exist.** No OCR/textract/vision/parse-to-items anywhere. | repository grep |
| Tabular import | `POST /import/expenses` — Multer `FileInterceptor`, **CSV + XLSX** parsed via SheetJS into `ParsedRow{row,title?,category?,…}`. | `backend/src/app/import/import.controller.ts:30-40`, `import.service.ts:17,105-137` |
| Export | `GET /expenses/export` + `import/export.controller.ts` + `xlsx-workbook.builder.ts`. | `expenses.controller.ts:174` |
| Analytics | `analytics/monthly|yearly|categories|all-monthly` — categories grouped on the **plaintext** `category` field. | `expenses.controller.ts:193-298`, `services/expenses-analytics.service.ts:56` |
| Duplicate check | `GET /expenses/duplicates` → `findPotentialDuplicates` matches **amount + date + currency + scope**; **title deliberately excluded** (E2EE-safe). | `expenses.controller.ts:294-319`, `expenses.service.ts:1315-1360` |
| AI | Single opt-in `POST /ai/proxy` forwarding a prompt with **UUID redaction only**; projection firewall is TARGET/not-built. | `ai.service.ts:22-52`; AI Firewall doc |
| Goal Engine | `DeterministicGoalEngine` behind frozen `GoalEngine` interface; **numeric/enum input only**; flag-gated. | `backend/src/app/goals/engine/*` |
| FIN-002 | Golden-fixture parity harness (BATCH-05) — "same inputs → same balances". | finance golden gate (backend suite) |

> Do **not** cite this document as evidence that OCR, taxonomy, line items, classification, or population learning exists. They do **not**.

---

## 3. Existing attachment / receipt infrastructure `VERIFIED`

- **Storage substrate is present and E2EE-aware.** `attachments.encryptedFileKey` holds the per-file symmetric key **wrapped under the scope key** (personal master / groupDataKey / expense contentKey — same key model as expenses), and `encryptedOriginalName` keeps the filename client-encrypted. Server holds only opaque `storageKey`, `mimeType`, `sizeBytes`, `checksumSha256`. `attachment.entity.ts:42-71`.
- **Receipt lifecycle is audited.** `receipt_versions` records created/replaced/deleted with a `jsonb` snapshot + actor, indexed for retrieval. `receipt-version.entity.ts`.
- **Consequence for this feature:** *uploading and attaching a receipt to a Total-only expense is essentially already supported.* Document intelligence adds an **extraction/candidate layer over the existing attachment**, not a new storage stack. `[ENGINEERING PARAMETER]` where OCR runs (client vs server) directly determines whether the server ever sees decrypted document bytes — this is the pivotal privacy decision (§8, §18).

---

## 4. Existing expense creation / import flows `VERIFIED`

- **Create/update** go through `expenses.controller` (`POST /`, `PATCH /:id`) with client-side E2EE title/description, `@VersionColumn` optimistic locking, version snapshots (`/:id/versions`, `/:id/restore`), and soft duplicate warning.
- **Import already exists** as tabular: `POST /import/expenses` accepts CSV/XLSX, parses rows to `{title?, category?, …}`. This is the natural **host** for a future "review candidate transactions" step — a statement importer would produce the *same* review list, just from a different upstream extractor.
- **Reconciliation precedent:** the existing importer already validates/normalizes rows before persisting; it does not blindly write. Document extraction should feed the **same human-review-then-commit** discipline.

---

## 5. Current E2EE boundaries `VERIFIED` (per frozen Matrix #2)

- **Class-A / Zone-1a (E2EE, opaque to server):** `expense.title`, `expense.description`, `attachment.encryptedOriginalName`, per-file/content keys; `goal.title` (born-E2EE, BATCH-11). Server never key-holds recoverable plaintext outside the frozen RSA-root recovery model.
- **Zone-2 (plaintext, server-readable for computation):** `amountTotal`, `currency`, `category`, dates, `status`, `transactionType`. These power analytics/dedup **without decryption**.
- **Hard rule for this feature (restates Matrix §12):** structured taxonomy metadata is a **parallel, classified** layer. It must **not** create pressure to make E2EE free-text server-readable, and it must **not** be used as a decryption backdoor. Any field's classification stays governed by the frozen Matrix; changing a field's class is a frozen-doc change, not something this feature may assume. `[COUNSEL]` any *new* derived field (merchant, item label) needs an explicit Matrix classification before it can be stored server-readable (§18).

---

## 6. Current AI Firewall boundaries `VERIFIED`

- **CURRENT:** one opt-in `POST /ai/proxy`; the only outbound protection is **UUID redaction** (`redactUuids`). There is **no** projection firewall, no fail-closed mediation layer, no ZDR enforcement in code — those are **TARGET** in the AI Firewall doc.
- **Consequence:** any extraction/classification that would send document bytes or free-text to an **external** model is **out of scope until the firewall's TARGET controls exist** (fail-closed, projections-not-raw, per-signal consent, ZDR posture). A **local/on-device or self-hosted** extractor avoids crossing the AI boundary and is the only class that does not depend on firewall completion. `[PRODUCT DECISION REQUIRED]` / `[COUNSEL]`.

---

## 7. Current search / filter / report architecture `VERIFIED`

- Reporting is built on **server-readable Zone-2 structured fields** — `analytics/categories` groups by the plaintext `category`; monthly/yearly aggregate `amountTotal`. Free-text title/description are **never** searched server-side.
- **This is the load-bearing precedent for the whole taxonomy idea:** "show grocery spending", "compare grocery vs household" are answerable because `category` is structured + server-readable. A **tag/taxonomy layer is a generalization of that exact pattern** — structured, classified, queryable metadata that coexists with E2EE free-text. `TARGET` extends the precedent; it does not invent a new privacy posture. Item-level queries ("show milk purchases") require a **line-item + tag** structure that does not exist today.

---

## 8. OCR / document-engine feasibility `TARGET`

Feasible **only** behind a replaceable contract, with the provider **undecided**. Classes and trade-offs (no selection made):

| Class | Privacy | Accuracy (receipts/tables) | Latency | Cost | Lock-in | Notes |
|---|---|---|---|---|---|---|
| **On-device / client OCR** (e.g. WASM engines) | **Best** — bytes never leave client; compatible with E2EE with no firewall dependency | Moderate; weak on dense tables/handwriting | Device-bound | ~0 marginal | None | Preferred for privacy; heavier client bundle `[ENGINEERING PARAMETER]` |
| **Self-hosted OCR** (server-side engine) | Server sees decrypted bytes → **breaks E2EE-at-rest unless ephemeral + consented** | Better on tables/PDFs | Server cost | Infra | Low | Needs explicit `[COUNSEL]` + Matrix decision |
| **Managed OCR / Document-AI** | Bytes leave to a third party → **AI-firewall + ZDR + consent required** | High on receipts/statements | Network | Per-page | High | Blocked until firewall TARGET exists (§6) |
| **LLM/VLM extraction** | As above + prompt-injection surface | High + structure-aware | High | Highest | High | Adversarial risk (§32) |
| **Hybrid OCR→structured** | Depends on OCR tier | Highest | Compound | Compound | Medium | Most complex |

Cross-cutting `[ENGINEERING PARAMETER]` / `[OPEN QUESTION]`: Indian formats/currency/GST-tax fields, multilingual receipts, handwriting limits, PDF vs image, page/region provenance, **confidence scoring** (must be first-class), fallback when confidence is low (§26 UX: *ask, don't pretend certainty*), reproducibility (same doc → same extraction for audit). **No provider is selected; the repo/frozen docs mandate none.**

---

## 9. Proposed stable `DocumentExtractionEngine` contract `TARGET` (design sketch — NOT an API)

Mirror `GoalEngine`: stable interface + DI token + replaceable impl + `capabilities()`/version/provenance. Conceptually:

```
DocumentExtractionEngine        (bound via a DI token, like GOAL_ENGINE)
  extract(input) -> ExtractionResult      // pure w.r.t. the domain: bytes/opaque handle in, normalized candidates out
  capabilities()                          // formats, langs, statement-support, confidence model
  name / version / contractVersion
```

Rules carried from Goal Engine discipline: **no Nest/TypeORM/finance coupling in the engine**; deterministic/rule-based and model-based impls satisfy the **same** interface; the Expense module depends on the **contract, not a vendor**. Exact signature is **not** designed here.

---

## 10. Extraction result model `TARGET` (design sketch — NOT a schema)

Must keep three concepts **distinct and non-merged**: **extracted fact** vs **inferred/classified value** vs **user-confirmed value**.

```
ExtractionResult
  documentType        (receipt | invoice | statement | unknown)   [inferred]
  merchant?           value + fieldConfidence + provenance         [extracted|inferred]
  documentDate?       normalized + confidence + provenance         [extracted]
  currency? subtotal? tax? discount? total?                        [extracted]
  lineItems[]: { label, qty?, unitPrice?, lineTotal?, confidence, provenance } [extracted]
  candidateTags[] (per item)                                       [inferred — NOT stored as fact]
  rawConfidence, warnings[], unresolvedFields[]
  provenance: { page, region, engineVersion }
```

Every field carries **confidence + provenance + source-authority** (`EXTRACTED` / `INFERRED` / `USER_CONFIRMED`). A later low-confidence inference **must never** overwrite a `USER_CONFIRMED` value (mirrors §8 of the parking doc and Goal-Engine provenance). `[ENGINEERING PARAMETER]` confidence scale + thresholds; `[PRODUCT DECISION REQUIRED]` whether line items become an **entity** or **attachment-scoped metadata** (§23).

---

## 11. Human-in-the-loop review model `TARGET`

Extraction produces **candidates only**; a **user confirmation** produces the financial/metadata mutation. Non-negotiable: the review UI shows extracted vs inferred vs confirmed distinctly; low confidence → **prompt, don't auto-apply**; the user can edit/delete/add/correct/ignore before commit. No auto-commit path exists.

---

## 12. Total-only vs itemized mode `TARGET` (+ near-CURRENT)

- **Total-only** is **first-class and ~already supported** — a normal expense (category + total) with a receipt **attached** via existing `attachments`. Adding "attach receipt to a Total-only expense" is the smallest, lowest-risk increment (no OCR). `TARGET`(thin).
- **Itemized** is an **explicit per-document opt-in** that runs the extraction engine → review → optional persist. Uploading a document must **never** silently trigger itemization. `[PRODUCT DECISION REQUIRED]` confirm Total-only is always default.
- **Reconciliation invariant (preserves FIN-002):** `sum(items) ≤ authoritative_total`; `unallocated = total − sum(items)` is **surfaced, never hidden**; `sum(items) > total` **must not** auto-alter the expense. The **authoritative total stays the user's/transaction's amount**; items are subordinate detail.

---

## 13. Credit-card statement architecture `TARGET` / partly `FUTURE`

- The **same** extract→normalize→review→confirm pipeline (§9–§11) applies; a statement extractor emits **candidate transactions** into the **existing import-review** surface (§4).
- Statement-specific `[ENGINEERING PARAMETER]`/`[OPEN QUESTION]`: per-issuer layouts, statement vs transaction-level extraction, **date normalization**, **merchant normalization** (raw→canonical), **amount/sign** (debit/credit/refund/fee/installment), multi-currency, page/table boundaries, **statement-total reconciliation**.
- **Duplicate detection is already solved E2EE-safely** and is directly reusable: `findPotentialDuplicates` keys on amount+date+currency+scope and excludes the E2EE title (§2). Statement import should reuse it rather than invent title-based matching.
- **Scope note:** SRS v1.0 already scopes statement import as **V1 OPTIONAL "if dependencies safe"**; this assessment does **not** promote it. Treat as `FUTURE` until §28–§30 clear.

---

## 14. Dynamic taxonomy architecture `TARGET`

- Recommend **hybrid**: a **canonical concept graph** (parent/child + cross-cutting tags) rather than either a rigid tree or fully independent flat tags. `milk → dairy → food → grocery` as **linked canonical concepts** is more useful for filtering/reporting/rollup and more explainable than four unrelated flat strings; but flexible cross-cutting tags (`essential`, `recurring`, `household`) need graph-like edges, not a single tree. `[PRODUCT DECISION REQUIRED]` final shape.
- **Lifecycle guardrail** (from parking doc): `OBSERVED → CANDIDATE → CONFIRMED → ACTIVE → (MERGED | DEPRECATED)`. Only **ACTIVE** is first-class shared taxonomy; a single uncertain extraction must **not** pollute the global set. Thresholds are **undecided** `[ENGINEERING PARAMETER]`; governance/merge/deprecate semantics are **undecided** `[PRODUCT DECISION REQUIRED]`.
- Keep **category** (coarse, user-supplied, exists today) vs **taxonomy classification** (structured, shared) vs **tags** (flexible) conceptually distinct.

---

## 15. Shared / global taxonomy strategy `TARGET`

- **One shared canonical taxonomy** with **stable IDs**; users **reference** the same IDs (no per-user duplication of "Milk"). Governance decides who promotes ACTIVE concepts and how they are audited `[PRODUCT DECISION REQUIRED]`.
- **Personal layer is separate** (§16): user overrides/preferences/relevance sit beside — not inside — the canonical set. A personal correction must **not** auto-mutate global taxonomy.
- **Privacy caveat:** the canonical taxonomy itself (concept labels/relationships) is population-level and non-personal, but **the link `expense-item → tag_id` for a user is personal usage metadata** and must carry a Matrix classification before storage `[COUNSEL]`.

---

## 16. User corrections and learning signals `TARGET`

- A user correction is authoritative **for that user's record** (`USER_CONFIRMED`, highest authority). Whether a correction may become an **aggregate signal** for global improvement is a **separate, consented** decision — **not** automatic. `[PRODUCT DECISION REQUIRED]` / `[COUNSEL]`.
- Corrections are the highest-quality learning signal *if* consent + anonymization + governance permit; absent those, they stay **personal only**.

---

## 17. Population-learning boundary `TARGET` / `FUTURE`

Separate **four** concepts and never collapse them: **runtime inference** (allowed within firewall/consent) · **evaluation** (offline, governed) · **aggregate learning** (consented, anonymized, minimized) · **training** (explicit legal basis). **Raw receipts, OCR text, encrypted descriptions, and private documents do NOT automatically become training data.** All population learning is gated on: legal basis + consent (per-signal), anonymization/aggregation, retention limits, differential-privacy/federated applicability, dataset governance, model versioning/rollback, poisoning/abuse defenses, and audited feedback loops. Every item here is `[COUNSEL]` / `[PRODUCT DECISION REQUIRED]` / `[ENGINEERING PARAMETER]` and **unresolved**.

---

## 18. Privacy / security implications `TARGET` (must be preserved)

E2EE free-text stays E2EE; **no server-side decryption backdoor**; AI firewall (mediated, projections-not-raw, fail-closed, ZDR) governs any external processing; data minimization + consent + retention; no automatic training on private data; user controls extraction and confirms before finalize; **owner/participant IDOR scoping** for documents, items, and classifications exactly like their parent entities. **Every newly derived, potentially-sensitive field (merchant, item label, inferred tag) requires an explicit Data-Classification-Matrix entry before it can be stored server-readable** — do not assume derived metadata is harmless.

---

## 19. FIN-002 protection `VERIFIED` boundary, `TARGET` feature

Extraction/classification produce **candidates**; only **user confirmation** mutates finance. Never silently touch payer, amount, split, refund, settlement, currency, balances. The **finance golden-fixture/parity harness remains the guard** — any batch that touches expense/settlement code must keep it green. Itemization writes to a **subordinate metadata layer**, never into `amountTotal`/split math.

---

## 20. Goal Engine integration `TARGET`

Taxonomy feeds Goal Engine **only** as minimized numeric/enum **projections** (`monthly_grocery`, `monthly_dairy`, category trend, volatility, recurring signal). The engine **must not** receive receipt images, OCR text, private descriptions, merchant dumps, or PII. This **preserves the existing `GoalEngine` numeric/enum-only contract and replaceable-engine architecture** — no contract change required; taxonomy is just another projection source.

---

## 21. Duplicate / reconciliation strategy `TARGET` (reuses CURRENT)

- **Intra-document:** `sum(items) ≤ total`, surface `unallocated`, never auto-alter (§12).
- **Cross-record (statement import):** reuse `findPotentialDuplicates` (amount+date+currency+scope, title excluded) — already E2EE-safe and production-proven. `[ENGINEERING PARAMETER]` tolerance windows for date/amount fuzz on statements.

---

## 22. Provider comparison categories `[ENGINEERING PARAMETER]` / `[OPEN QUESTION]`

Evaluate any candidate against: accuracy (receipts/tables/line-items/PDF/statements/handwriting/multilingual/Indian-formats+GST), latency, cost, **privacy posture (bytes-leave-device?)**, availability/SLA, **fallback behaviour**, provider lock-in, reproducibility, confidence scoring, ZDR/no-train guarantees. **No provider is selected in this document and none is mandated by the repo/frozen docs.**

---

## 23. Migration / schema implications `TARGET` (none created)

Likely *future* additions **when/if approved** — none created here: line-item table **or** attachment-scoped item metadata `[PRODUCT DECISION REQUIRED]`; canonical taxonomy + alias/edge tables; per-item classification link (with provenance/confidence/source-authority); extraction-job/result records; consent + learning-signal records. Each needs a Matrix classification, a migration, and (for E2EE fields) `text` ciphertext columns + `@VersionColumn` where mutable. **No schema, no migration, no entity created or altered in this assessment.**

---

## 24. API / module boundaries `TARGET`

New modules (future): `DocumentIntelligenceModule` (extraction engine + review), `TaxonomyModule` (canonical taxonomy + classification engine). Boundaries: extraction/classification depend on **contracts**, not vendors; all routes `@UseGuards(JwtAuthGuard)` + feature-flag-gated + owner-scoped; REC-1 applies to any new **Class-A** material; error envelope + optimistic-lock conventions reused. Expense module stays decoupled from OCR/ML.

---

## 25. Frontend boundaries `TARGET`

New feature area `features/documents/` (upload → detect → mode-choose → review → reconcile → confirm), reusing existing crypto services for any born-E2EE fields (as Goals did), NGXS/signals per the state strategy, and dedicated data-access services (no raw HTTP in components). Extraction runs client-side **if** an on-device engine is chosen (§8). No component ever holds server-decrypted E2EE free-text from the server.

---

## 26. Proposed implementation batches `TARGET` (sequenced; none authorised)

1. **DOC-0 (docs-only):** freeze the two engine **contracts** + extraction result model as design docs/ADRs. No code.
2. **DOC-1:** Total-only "attach receipt to expense" polish (near-CURRENT; no OCR). Flag-gated.
3. **DOC-2:** `DocumentExtractionEngine` interface + **deterministic/no-op stub** impl + review UI scaffold behind flag (no real OCR).
4. **DOC-3:** on-device OCR spike behind flag (privacy-preserving class only), confidence + reconciliation, **write-nothing** until confirm.
5. **DOC-4:** taxonomy **read model** + `category`-parity reporting (no global learning).
6. **DOC-5+ (FUTURE):** CC-statement extraction; shared-taxonomy governance; aggregate learning — each gated on §28–§30.

Flow (UX, §31): Upload → detect type → **Total-only / Extract** → extract → review → classify-suggest → correct → reconcile → confirm → create/import. Low confidence ⇒ ask.

---

## 27. Dependencies and gates `TARGET`

- **AI Firewall TARGET controls must exist** before any *external* extraction/classification (fail-closed, projections, consent, ZDR). On-device class avoids this gate.
- **Data-Classification-Matrix entries** for every new derived field before server-readable storage.
- **FIN-002 harness green** on every touching batch.
- **REC-1** for any new Class-A material.
- **SRS revision (R2+)** via §20-parking formal impact review before any capability leaves "parked".
- **Consent/legal framework** before any learning signal.

---

## 28. PRODUCT decisions `[PRODUCT DECISION REQUIRED]`

Total-only always default; line-items = entity vs attachment-metadata; taxonomy shape (tree/graph/hybrid); taxonomy governance (who promotes ACTIVE, audit); tag editability + visibility; merge/deprecate semantics; whether corrections feed aggregate learning; per-user tag relevance vs canonical set; statement-import inclusion timing.

## 29. ENGINEERING parameters `[ENGINEERING PARAMETER]`

OCR provider **class** + hosting; confidence scale + surfacing thresholds; reconciliation tolerances (rounding/tax/discount); dedup fuzz windows; taxonomy promotion counts; image/PDF size/page/format limits; extraction quotas/throttling; classifier/taxonomy versioning + drift detection; reproducibility guarantees.

## 30. COUNSEL / legal decisions `[COUNSEL]`

Population-learning legal basis; training/learning consent model; retention of documents + OCR text + classification signals; differential-privacy/federated applicability; cross-border processing if managed OCR is ever used; classification of every new derived field (merchant/item/tag) in the Matrix; whether derived tags are ever "aggregate/anonymized" enough to leave the personal boundary.

## 31. Production verification requirements `[PRODUCTION VERIFICATION]`

Before any DOC batch ships: FIN-002 harness green; no E2EE field reclassified; on-device path proven to keep bytes on-device (or firewall+ZDR proven for external); migrations run UP/DOWN/re-apply on disposable Postgres; IDOR scoping tested for documents/items/classifications; feature flags default **OFF**; confidence/low-confidence UX proven to *ask* not *assume*.

## 32. Threat / adversarial analysis `TARGET`

Prompt-injection via malicious receipt/PDF (esp. LLM/VLM class) → mitigate: extraction outputs are **candidates**, never auto-commit, never auto-execute instructions; **taxonomy poisoning** (crafted inputs promoting junk canonical tags) → OBSERVED/CANDIDATE quarantine + multi-user/multi-observation promotion + governance; **PII exfiltration** via extracted merchant/text crossing AI boundary → firewall projections + minimization; **IDOR** on documents/items → owner/participant scoping; **model/dataset abuse** in learning → consent + poisoning defenses + rollback; **financial tamper** via extraction → FIN-002 candidate-only boundary.

## 33. Risks `TARGET`

Scope/privacy creep (top risk); OCR accuracy on Indian receipts/handwriting; client bundle weight for on-device OCR; taxonomy governance overhead; reconciliation UX complexity; provider lock-in; learning/consent legal exposure; drift/versioning debt.

## 34. Recommended implementation order

`DOC-0 (contracts, docs-only)` → `DOC-1 (Total-only attach)` → `DOC-2 (extraction interface + stub + review scaffold)` → `DOC-3 (on-device OCR spike, write-nothing-until-confirm)` → `DOC-4 (taxonomy read model, category-parity reporting)` → **stop and re-review** → `DOC-5+ FUTURE (statements, shared-taxonomy governance, aggregate learning)`. Do not skip DOC-0; do not begin any DOC batch without §28–§30 for that batch resolved.

## 35. Explicit "what NOT to implement yet"

Do **NOT**, in any batch now: integrate/select an OCR/VLM provider; add any OCR/extraction code; create line-item, tag, or taxonomy schema/entities/migrations; build classification or a classifier; implement CC/bank-statement extraction; implement any cross-user/population learning, training, or dataset collection; make any E2EE free-text server-readable; add any external-AI path before the firewall TARGET controls exist; enable any related feature flag in production; modify SRS/Decision Ledger/ADRs/API contracts/OpenAPI/entities/services/controllers/frontend/migrations/config. **Freeze interfaces, not vendors or tag lists.**

---

## Reconciliation

- ✅ **READ-ONLY** — no code, schema, migration, entity, DTO, API/OpenAPI, package, provider, or production change.
- ✅ **Frozen stack untouched** — SRS v1.0, Decision Ledger, ADRs, API contracts, OpenAPI, Matrix, AI-Firewall, Threat Model, Ownership/Migration/Roadmap docs **not modified**.
- ✅ **Boundaries preserved** — FIN-002, E2EE, AI Firewall, REC-1, Goal Engine contract, SEC-KI1 all intact and unmodified.
- ✅ **CURRENT vs TARGET distinguished** — §2 (evidence-backed CURRENT/VERIFIED) is the only "exists today" claim; §8–§35 are TARGET/FUTURE, none implemented.
- ✅ **No decision silently resolved** — PRODUCT/ENGINEERING/COUNSEL/OPEN items surfaced, not answered.
- ✅ **No provider selected** — repo/frozen docs mandate none; none chosen here.

**One-line status:** *Readiness assessment only — substrate exists (attachments, tabular import, category-based reporting, E2EE-safe dedup, replaceable-engine + FIN-002 precedents); intelligence does not. Freeze the two engine contracts; implement nothing until §28–§30 gates clear.*

*End of assessment. Authorises no code, schema, migration, API, model, training, provider, or SRS change.*
