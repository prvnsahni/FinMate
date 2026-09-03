# FinMate — Document Intelligence + Dynamic Taxonomy: Readiness / Architecture Assessment

**Type:** READ-ONLY readiness assessment. **Authorises nothing.** No code, schema, migration, entity, DTO, API/OpenAPI contract, package, OCR/ML provider, training pipeline, production, or user-data-collection change is made or implied by this document.

**Date:** 2026-08-14 · **Branch:** `feature/documentation` · **Baseline HEAD at assessment:** `abec60d` (Goals-v2 backend `c9c290d` + frontend `abec60d`, QA-verified).

**Companion (parking) doc — not modified by this file:** [`FINMATE_DOCUMENT_INTELLIGENCE_AND_DYNAMIC_TAXONOMY_FUTURE.md`](./FINMATE_DOCUMENT_INTELLIGENCE_AND_DYNAMIC_TAXONOMY_FUTURE.md). That document _parks the direction_; this document is a _repository-grounded readiness assessment_ that inventories what exists today, tests feasibility against the frozen boundaries, and lists the decisions/gates that must precede any implementation. Neither authorises code.

**Frozen boundaries preserved and NOT altered here:** SRS v1.0 (FROZEN 2026-08-12) · Decision Ledger · Data Classification & Encryption Matrix (#2) · Security & Privacy Architecture (#3) · Key Management (#4) · AI Data-Access & Privacy Firewall (#5) · IP/AI Confidentiality (#6) · Threat Model (#7) · Ownership Map (#15) · API & Data Contracts (#16) · Backward-Compat & Migration Plan (#17) · Roadmap · Execution Plan · Goal Engine Architecture & Contract · ADRs. **FIN-002 finance parity, E2EE, AI Firewall, REC-1, Goal Engine contract, and SEC-KI1 remain untouched.**

## Classification legend

`CURRENT` = exists in the repo today (evidence cited) · `VERIFIED` = existence/behaviour confirmed by inspection this pass · `TARGET` = intended future capability behind a stable contract · `FUTURE` = parked, not scheduled · `[PRODUCT DECISION REQUIRED]` · `[ENGINEERING PARAMETER]` · `[COUNSEL]` · `[PRODUCTION VERIFICATION]` · `[OPEN QUESTION]`. **A TARGET/FUTURE idea is never described as CURRENT reality.**

---

## 1. Executive conclusion

`VERIFIED` FinMate today has a **usable substrate** for document intelligence but **zero** of the intelligence itself. Specifically, it already has: file **attachment + receipt-versioning** storage with per-file key wrapping (`attachments`, `receipt_versions`), a **tabular import** path (`POST /import/expenses`, CSV/XLSX via SheetJS), **server-readable structured metadata reporting** (`analytics/categories` grouped on the plaintext `category` field), an **E2EE-safe soft-duplicate** check (`findPotentialDuplicates` — matches amount+date+currency+scope, deliberately **excludes** the E2EE title), a **replaceable-engine** precedent (`GoalEngine`), and a **FIN-002 parity harness**. What does **not** exist: any OCR/extraction, any line-item model, any tag/taxonomy entity, any classification engine, any statement parser, any population learning.

`TARGET` The right shape is exactly the parking doc's one rule: **freeze two interfaces — `DocumentExtractionEngine` and `ClassificationEngine` — mirroring `GoalEngine`, and keep extraction/classification a descriptive metadata layer that produces _candidates_, never a mutation path into the financial record.** The single largest risk is not OCR accuracy; it is **scope-and-privacy creep** — an extraction/tagging feature becoming a backdoor to (a) server-readable free-text, (b) silent financial mutation, or (c) silent training on private data. Each is independently prohibited by the frozen stack and must stay prohibited.

**Recommendation:** do **not** start implementation. The near-term, low-risk, high-value slice is **Total-only + attachment (already 90% present)** and **contract design** (the two engine interfaces + the extraction result model as _documentation_), gated behind the decisions in §28–§30. OCR, tagging, taxonomy, CC-statement extraction, and any learning remain **NOT-NOW** (§35).

---

## 2. Current repository reality (evidence-backed baseline)

| Concern              | CURRENT state                                                                                                                                                                                                                                                | Evidence                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Expense text         | `title`, `description` = `text`, **E2EE client-side** (Zone-1a).                                                                                                                                                                                             | `shared/data-models/src/lib/expense.entity.ts:37-41`; `FINMATE_DATA_CLASSIFICATION_ENCRYPTION_MATRIX.md:103-104` |
| Expense financials   | `amount_total` decimal(12,2), `currency` char(3), `category` varchar(64) — **plaintext, server-readable (Zone-2)**. `transactionType` expense/refund; `encryptionScope` personal/group/direct_shared; `@VersionColumn`; soft-delete.                         | `expense.entity.ts:43-121`; Matrix `:105-107`                                                                    |
| Line items           | **Do not exist.** Expense holds a single total; no per-item rows.                                                                                                                                                                                            | `expense.entity.ts` (no item relation)                                                                           |
| Category             | **Single flat** `varchar(64)`, indexed `['group','category']`. No hierarchy, no per-item categories.                                                                                                                                                         | `expense.entity.ts:53-54,28`                                                                                     |
| Tags / taxonomy      | **Do not exist.** No tag entity, no taxonomy table, no aliases/lifecycle.                                                                                                                                                                                    | repository — no such entity                                                                                      |
| Attachments          | `attachments`: `storageKey`, `originalName`, `mimeType`, `sizeBytes`, `checksumSha256`, **`encryptedFileKey`** (per-file key wrapped under the scope key), **`encryptedOriginalName`** (E2EE). Attach target is expense/note/goal/group (CHECK-constrained). | `attachment.entity.ts:16-74`                                                                                     |
| Receipt versioning   | `receipt_versions`: `action` created/replaced/deleted, `snapshot jsonb`, `actorUser`, indexed by `(expense, createdAt)`.                                                                                                                                     | `receipt-version.entity.ts`                                                                                      |
| OCR / doc extraction | **Does not exist.** No OCR/textract/vision/parse-to-items anywhere.                                                                                                                                                                                          | repository grep                                                                                                  |
| Tabular import       | `POST /import/expenses` — Multer `FileInterceptor`, **CSV + XLSX** parsed via SheetJS into `ParsedRow{row,title?,category?,…}`.                                                                                                                              | `backend/src/app/import/import.controller.ts:30-40`, `import.service.ts:17,105-137`                              |
| Export               | `GET /expenses/export` + `import/export.controller.ts` + `xlsx-workbook.builder.ts`.                                                                                                                                                                         | `expenses.controller.ts:174`                                                                                     |
| Analytics            | `analytics/monthly                                                                                                                                                                                                                                           | yearly                                                                                                           | categories | all-monthly`— categories grouped on the **plaintext**`category` field. | `expenses.controller.ts:193-298`, `services/expenses-analytics.service.ts:56` |
| Duplicate check      | `GET /expenses/duplicates` → `findPotentialDuplicates` matches **amount + date + currency + scope**; **title deliberately excluded** (E2EE-safe).                                                                                                            | `expenses.controller.ts:294-319`, `expenses.service.ts:1315-1360`                                                |
| AI                   | Single opt-in `POST /ai/proxy` forwarding a prompt with **UUID redaction only**; projection firewall is TARGET/not-built.                                                                                                                                    | `ai.service.ts:22-52`; AI Firewall doc                                                                           |
| Goal Engine          | `DeterministicGoalEngine` behind frozen `GoalEngine` interface; **numeric/enum input only**; flag-gated.                                                                                                                                                     | `backend/src/app/goals/engine/*`                                                                                 |
| FIN-002              | Golden-fixture parity harness (BATCH-05) — "same inputs → same balances".                                                                                                                                                                                    | finance golden gate (backend suite)                                                                              |

> Do **not** cite this document as evidence that OCR, taxonomy, line items, classification, or population learning exists. They do **not**.

---

## 3. Existing attachment / receipt infrastructure `VERIFIED`

- **Storage substrate is present and E2EE-aware.** `attachments.encryptedFileKey` holds the per-file symmetric key **wrapped under the scope key** (personal master / groupDataKey / expense contentKey — same key model as expenses), and `encryptedOriginalName` keeps the filename client-encrypted. Server holds only opaque `storageKey`, `mimeType`, `sizeBytes`, `checksumSha256`. `attachment.entity.ts:42-71`.
- **Receipt lifecycle is audited.** `receipt_versions` records created/replaced/deleted with a `jsonb` snapshot + actor, indexed for retrieval. `receipt-version.entity.ts`.
- **Consequence for this feature:** _uploading and attaching a receipt to a Total-only expense is essentially already supported._ Document intelligence adds an **extraction/candidate layer over the existing attachment**, not a new storage stack. `[ENGINEERING PARAMETER]` where OCR runs (client vs server) directly determines whether the server ever sees decrypted document bytes — this is the pivotal privacy decision (§8, §18).

---

## 4. Existing expense creation / import flows `VERIFIED`

- **Create/update** go through `expenses.controller` (`POST /`, `PATCH /:id`) with client-side E2EE title/description, `@VersionColumn` optimistic locking, version snapshots (`/:id/versions`, `/:id/restore`), and soft duplicate warning.
- **Import already exists** as tabular: `POST /import/expenses` accepts CSV/XLSX, parses rows to `{title?, category?, …}`. This is the natural **host** for a future "review candidate transactions" step — a statement importer would produce the _same_ review list, just from a different upstream extractor.
- **Reconciliation precedent:** the existing importer already validates/normalizes rows before persisting; it does not blindly write. Document extraction should feed the **same human-review-then-commit** discipline.

---

## 5. Current E2EE boundaries `VERIFIED` (per frozen Matrix #2)

- **Class-A / Zone-1a (E2EE, opaque to server):** `expense.title`, `expense.description`, `attachment.encryptedOriginalName`, per-file/content keys; `goal.title` (born-E2EE, BATCH-11). Server never key-holds recoverable plaintext outside the frozen RSA-root recovery model.
- **Zone-2 (plaintext, server-readable for computation):** `amountTotal`, `currency`, `category`, dates, `status`, `transactionType`. These power analytics/dedup **without decryption**.
- **Hard rule for this feature (restates Matrix §12):** structured taxonomy metadata is a **parallel, classified** layer. It must **not** create pressure to make E2EE free-text server-readable, and it must **not** be used as a decryption backdoor. Any field's classification stays governed by the frozen Matrix; changing a field's class is a frozen-doc change, not something this feature may assume. `[COUNSEL]` any _new_ derived field (merchant, item label) needs an explicit Matrix classification before it can be stored server-readable (§18).

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

| Class                                          | Privacy                                                                               | Accuracy (receipts/tables)                 | Latency      | Cost        | Lock-in | Notes                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------ | ------------ | ----------- | ------- | ---------------------------------------------------------------------- |
| **On-device / client OCR** (e.g. WASM engines) | **Best** — bytes never leave client; compatible with E2EE with no firewall dependency | Moderate; weak on dense tables/handwriting | Device-bound | ~0 marginal | None    | Preferred for privacy; heavier client bundle `[ENGINEERING PARAMETER]` |
| **Self-hosted OCR** (server-side engine)       | Server sees decrypted bytes → **breaks E2EE-at-rest unless ephemeral + consented**    | Better on tables/PDFs                      | Server cost  | Infra       | Low     | Needs explicit `[COUNSEL]` + Matrix decision                           |
| **Managed OCR / Document-AI**                  | Bytes leave to a third party → **AI-firewall + ZDR + consent required**               | High on receipts/statements                | Network      | Per-page    | High    | Blocked until firewall TARGET exists (§6)                              |
| **LLM/VLM extraction**                         | As above + prompt-injection surface                                                   | High + structure-aware                     | High         | Highest     | High    | Adversarial risk (§32)                                                 |
| **Hybrid OCR→structured**                      | Depends on OCR tier                                                                   | Highest                                    | Compound     | Compound    | Medium  | Most complex                                                           |

Cross-cutting `[ENGINEERING PARAMETER]` / `[OPEN QUESTION]`: Indian formats/currency/GST-tax fields, multilingual receipts, handwriting limits, PDF vs image, page/region provenance, **confidence scoring** (must be first-class), fallback when confidence is low (§26 UX: _ask, don't pretend certainty_), reproducibility (same doc → same extraction for audit). **No provider is selected; the repo/frozen docs mandate none.**

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
- Corrections are the highest-quality learning signal _if_ consent + anonymization + governance permit; absent those, they stay **personal only**.

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

Likely _future_ additions **when/if approved** — none created here: line-item table **or** attachment-scoped item metadata `[PRODUCT DECISION REQUIRED]`; canonical taxonomy + alias/edge tables; per-item classification link (with provenance/confidence/source-authority); extraction-job/result records; consent + learning-signal records. Each needs a Matrix classification, a migration, and (for E2EE fields) `text` ciphertext columns + `@VersionColumn` where mutable. **No schema, no migration, no entity created or altered in this assessment.**

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

- **AI Firewall TARGET controls must exist** before any _external_ extraction/classification (fail-closed, projections, consent, ZDR). On-device class avoids this gate.
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

Before any DOC batch ships: FIN-002 harness green; no E2EE field reclassified; on-device path proven to keep bytes on-device (or firewall+ZDR proven for external); migrations run UP/DOWN/re-apply on disposable Postgres; IDOR scoping tested for documents/items/classifications; feature flags default **OFF**; confidence/low-confidence UX proven to _ask_ not _assume_.

## 32. Threat / adversarial analysis `TARGET`

Prompt-injection via malicious receipt/PDF (esp. LLM/VLM class) → mitigate: extraction outputs are **candidates**, never auto-commit, never auto-execute instructions; **taxonomy poisoning** (crafted inputs promoting junk canonical tags) → OBSERVED/CANDIDATE quarantine + multi-user/multi-observation promotion + governance; **PII exfiltration** via extracted merchant/text crossing AI boundary → firewall projections + minimization; **IDOR** on documents/items → owner/participant scoping; **model/dataset abuse** in learning → consent + poisoning defenses + rollback; **financial tamper** via extraction → FIN-002 candidate-only boundary.

## 33. Risks `TARGET`

Scope/privacy creep (top risk); OCR accuracy on Indian receipts/handwriting; client bundle weight for on-device OCR; taxonomy governance overhead; reconciliation UX complexity; provider lock-in; learning/consent legal exposure; drift/versioning debt.

## 34. Recommended implementation order

`DOC-0 (contracts, docs-only)` → `DOC-1 (Total-only attach)` → `DOC-2 (extraction interface + stub + review scaffold)` → `DOC-3 (on-device OCR spike, write-nothing-until-confirm)` → `DOC-4 (taxonomy read model, category-parity reporting)` → **stop and re-review** → `DOC-5+ FUTURE (statements, shared-taxonomy governance, aggregate learning)`. Do not skip DOC-0; do not begin any DOC batch without §28–§30 for that batch resolved.

## 35. Explicit "what NOT to implement yet"

Do **NOT**, in any batch now: integrate/select an OCR/VLM provider; add any OCR/extraction code; create line-item, tag, or taxonomy schema/entities/migrations; build classification or a classifier; implement CC/bank-statement extraction; implement any cross-user/population learning, training, or dataset collection; make any E2EE free-text server-readable; add any external-AI path before the firewall TARGET controls exist; enable any related feature flag in production; modify SRS/Decision Ledger/ADRs/API contracts/OpenAPI/entities/services/controllers/frontend/migrations/config. **Freeze interfaces, not vendors or tag lists.**

---

---

# ADDENDUM — 2026-08-14 · Scope refinement: document families and extraction paths

**Additive.** This section refines scope on top of §1–§35 above; it **supersedes nothing** and **preserves all prior findings**. Still **documentation only** — no OCR/extraction/taxonomy/tagging/CC/bank import/ML/provider is implemented. Frozen boundaries (FIN-002, E2EE, AI Firewall, REC-1, Goal Engine contract, SEC-KI1) remain intact. **New frozen-doc constraints surfaced this pass** (from SRS v1.0, not modified here): **FUT-004** (V2/FUTURE, MUST — statement/card: _never store CVV/PIN/PAN_; _extract→delete-original by default_; OCR-vendor review; "possible discrepancy" **no-accusation** language) and **OQ-03** (Counsel — _AI/statement features BLOCKED_ pending OCR/vendor cross-border transfer decision). SRS scopes statement import as **V1-OPTIONAL "if dependencies safe"** — and per OQ-03 those dependencies are **not yet safe**, so statements stay gated (§A6).

## §A1. One pipeline, input-specific adapters (refines §9, §13)

All document inputs converge on **one** normalized contract via thin **input-specific extraction adapters** — no separate product flows:

```
IMAGE ────────────► image adapter    (OCR / vision / local OCR / future provider)
TEXT PDF ─────────► pdf-text adapter  (direct PDF text + table extraction)
SCANNED PDF ──────► pdf-render adapter (render pages → image adapter → OCR/vision)
                              │
                              ▼
              DocumentExtractionEngine.extract()   ← adapter-selected by (mimeType, hasTextLayer)
                              │
                    NORMALIZED EXTRACTION CONTRACT  (§A5 — identical shape for every input)
                              │
            classification → user review → reconciliation → user confirmation → FinMate financial data
```

- `sourceType ∈ {image, pdf_text, pdf_scanned}` is detected (mime + PDF text-layer probe), selecting the adapter; the **caller never branches on it**. `[ENGINEERING PARAMETER]` the text-layer heuristic (chars-per-page threshold → treat as scanned).
- The engine returns the **same** `ExtractionResult` regardless of adapter. Adapters are replaceable independently of the engine and of each other. No provider selected (§A9).

## §A2. Document-family classification (NOW / NEXT / FUTURE / OUT)

Rationale per family; **the machine-readable matrix is §A8.**

**NOW / V1 (no OCR — reuses existing attachment substrate):**

- **Grocery · Retail · Restaurant · Fuel · Pharmacy receipts** — _Total-only_ (category + amount + attached receipt) is ≈already supported (§3, §12). First-class, zero extraction, zero new financial risk. _Itemized_ extraction for these is **NEXT** (needs the OCR spike).

**NEXT (V1.x — needs `DocumentExtractionEngine` + OCR/PDF spike; per-family flag; FIN-002 reconciliation):**

- **Online-shopping invoices · General purchase invoices** — often **text-PDF**, so the `pdf-text` adapter can lead (higher accuracy, no OCR); good first itemized target. **Itemized receipts** (grocery/retail/restaurant/fuel/pharmacy) — image OCR; the reconciliation UX proving ground.

**NEXT-but-GATED (V1.x, BLOCKED by OQ-03 counsel + FUT-004 safeguards — do not start until gates clear):**

- **Credit-card statements** (§A3) · **Bank statements** (§A4). SRS = V1-OPTIONAL "if safe"; dependencies are **not** safe (OQ-03). Never NOW.

**FUTURE:**

- **Utility bills · Subscription invoices · Rent/payment receipts** — mostly structured/text-PDF, valuable for recurring-signal detection, but lower priority than the receipt/invoice core. **Loan/EMI statements · Travel payment documents** — statement-like or heterogeneous; after the statement pipeline matures.

**OUT OF CURRENT SCOPE (FUTURE, higher-risk — explicitly not planned):**

- **Investment/broker statements · Complex financial reports · Tax documents · Legal/financial docs requiring interpretation** — require domain interpretation, carry high misclassification/liability risk, and touch domains SRS marks FUTURE/out. Extraction ≠ interpretation; these need `[COUNSEL]` + a separate product decision before even a readiness pass.

## §A3. Credit-card statements — first-class family, gated (refines §13)

Same pipeline (§A1), **statement semantics** (§A5 variant C). Eventual support: PDF + image statements, transaction extraction, date/merchant normalization, amount/sign, refunds/credits, fees, **duplicate detection reusing `findPotentialDuplicates`** (amount+date+currency+scope; E2EE-safe — §21), statement-period metadata, user review + **confirm-before-import**, reconciliation where a statement total exists. **Classification: NEXT / V1.x, BLOCKED.** Gates: **OQ-03** counsel (vendor transfer) + **FUT-004** MUST (no CVV/PIN/PAN storage; delete-original-default; no-accusation language) + AI-Firewall TARGET controls if any external processing. **Do not implement now.**

## §A4. Bank statements — separate semantics, shared engine (refines §13)

Bank statements share the **same `DocumentExtractionEngine`** but need a **different `TransactionNormalization` / statement-classification strategy** — do **not** force them into the CC model. They carry: debit/credit, **running balance**, transfers, UPI/NEFT/IMPS/ATM, fees, interest. Extra normalization: `direction` (debit/credit) + running-balance reconciliation + instrument type (UPI/NEFT/IMPS/ATM/transfer/fee/interest) as an **inferred** `transactionType`. **Classification: NEXT/FUTURE (V1.x+), same OQ-03 + FUT-004 gates, richer semantics → after CC statements.** One engine, **two** statement normalization strategies; the semantic model is per-family, not universal.

## §A5. Normalized extraction contract — refined (refines §10)

One envelope, three payload variants; **every field carries `confidence` + `provenance` + `authority`**, where `authority ∈ {EXTRACTED (machine fact) · INFERRED (machine classification) · USER_CORRECTED · USER_CONFIRMED}`. **`confidence` is an extraction-certainty score — it is NOT financial correctness.** A later low-confidence `INFERRED` value must never overwrite a `USER_CONFIRMED` one.

```
ExtractionResult (envelope)
  documentType   (receipt|invoice|cc_statement|bank_statement|unknown)   [INFERRED]
  sourceType     (image|pdf_text|pdf_scanned)                            [EXTRACTED]
  pageCount, documentDate?, merchant/provider?, currency?                [EXTRACTED|INFERRED]
  subtotal? tax? discount? total?                                        [EXTRACTED]
  rawConfidence, warnings[], unresolvedFields[], provenance{page,region,engineVersion,adapter}

A) LINE ITEMS (receipts/invoices)
  { description[INFERRED], quantity?, unitPrice?, lineTotal?, candidateTags[][INFERRED], confidence, provenance }

B) RECONCILIATION (FIN-002 core — §A6)
  documentTotal · extractedSubtotal · extractedTax · extractedDiscount ·
  sum(lineItemTotals) · allocatedTotal · unallocatedDifference(signed) · reconciliationStatus

C) STATEMENT TRANSACTIONS (cc/bank)
  { transactionDate, merchant[EXTRACTED]→normalizedMerchant[INFERRED], amount, direction(debit|credit),
    currency, reference?, transactionType[INFERRED], confidence, provenance }
```

## §A6. Total reconciliation model (FIN-002 core — refines §12, §19)

```
allocatedTotal        = sum(lineItemTotals)               [derived from EXTRACTED, user-editable]
unallocatedDifference = documentTotal − allocatedTotal     [signed; SURFACED, never hidden]
reconciliationStatus  ∈ { BALANCED | UNDER_ALLOCATED (Δ>0) | OVER_ALLOCATED (Δ<0) | UNRECONCILED }
```

- **`documentTotal` is authoritative** (the user's/transaction's amount). Line items are **subordinate detail**. Example Δ=₹60 (items ₹2,390 < total ₹2,450) → `UNDER_ALLOCATED`, surfaced for the user to resolve. Example items ₹2,510 > total ₹2,450 → `OVER_ALLOCATED`, surfaced — **never auto-alter the transaction**.
- Extraction/classification produce **candidates**; only **user confirmation** mutates finance. Never silently create/modify payer/amount/split/refund/settlement/currency/balances. `[ENGINEERING PARAMETER]` rounding/tax/discount tolerance before a Δ is flagged. The **FIN-002 golden harness stays green** on every touching batch.

## §A7. Taxonomy, global learning, E2EE/search, Goal Engine (unchanged direction — pointers)

- **Taxonomy** (§14–§16): user picks the coarse **main category** (exists today); system _derives_ fine-grained canonical tags (`milk→dairy→food→grocery`) as **INFERRED, correctable**; user need not classify every item. Shared/global canonical taxonomy with stable IDs, aliases, hierarchy, lifecycle `OBSERVED→CANDIDATE→CONFIRMED→ACTIVE→(MERGED|DEPRECATED)`; personal preferences a separate layer. Final data model **undecided** `[PRODUCT DECISION REQUIRED]`.
- **Global learning** (§17): keep **runtime inference / evaluation / aggregate learning / training** strictly separate; private corrections do **not** auto-become training data; all gated on consent + legal basis + anonymization + aggregation + retention + poisoning defense + model versioning/rollback + governance — `[COUNSEL]`, **FUTURE**.
- **E2EE/search** (§5, §7, §18): tags/merchant-id/category/date/amount/currency are structured metadata that can support server-side filtering **within** the frozen Matrix — **no** decryption of title/description/notes. **New caveat:** a **derived tag can itself be sensitive** (e.g. `pharmacy→contraception`, `medical→oncology`) — derived tags are **not automatically harmless**; each new derived field needs a Matrix classification and may warrant client-only storage `[COUNSEL]`.
- **Goal Engine** (§20): consumes only **minimized numeric/enum signals** (monthly grocery/food spend, category trend, volatility, recurring signal) — never image/OCR-text/description/merchant-dump/PII. **`GoalEngine` contract preserved unchanged.**

## §A8. Document-type scope matrix

| Document              | Input(s)         | Extraction strategy                                | Scope                                  | User review                 | Line items | Statement txns |
| --------------------- | ---------------- | -------------------------------------------------- | -------------------------------------- | --------------------------- | ---------- | -------------- |
| Grocery receipt       | image (pdf)      | Total-only NOW; OCR itemized NEXT                  | **NOW** (total) / NEXT (items)         | Yes                         | NEXT       | —              |
| Retail receipt        | image (pdf)      | Total-only NOW; OCR itemized NEXT                  | **NOW** / NEXT                         | Yes                         | NEXT       | —              |
| Restaurant bill       | image            | Total-only NOW; OCR itemized NEXT                  | **NOW** / NEXT                         | Yes                         | NEXT       | —              |
| Fuel receipt          | image            | Total-only NOW; OCR itemized NEXT                  | **NOW** / NEXT                         | Yes                         | NEXT (few) | —              |
| Pharmacy bill         | image            | Total-only NOW; OCR itemized NEXT (sensitive tags) | **NOW** / NEXT                         | Yes                         | NEXT       | —              |
| Online invoice        | text-PDF (image) | pdf-text lead; OCR fallback                        | **NEXT**                               | Yes                         | NEXT       | —              |
| General invoice       | text-PDF / image | pdf-text / OCR                                     | **NEXT**                               | Yes                         | NEXT       | —              |
| Credit-card statement | PDF / image      | statement extraction (gated)                       | **NEXT — BLOCKED** (OQ-03, FUT-004)    | Yes (confirm-before-import) | —          | NEXT           |
| Bank statement        | PDF / image      | statement extraction + bank normalization (gated)  | **NEXT/FUTURE — BLOCKED**              | Yes                         | —          | NEXT/FUTURE    |
| Utility bill          | text-PDF / image | pdf-text / OCR                                     | **FUTURE**                             | Yes                         | Maybe      | —              |
| Subscription invoice  | text-PDF         | pdf-text                                           | **FUTURE** (recurring signal)          | Yes                         | Maybe      | —              |
| Rent receipt          | image / PDF      | OCR / pdf-text                                     | **FUTURE**                             | Yes                         | No         | —              |
| Loan/EMI statement    | PDF              | statement-like                                     | **FUTURE**                             | Yes                         | —          | FUTURE         |
| Travel document       | mixed            | mixed                                              | **FUTURE**                             | Yes                         | Maybe      | —              |
| Investment statement  | PDF              | complex                                            | **OUT OF SCOPE** (FUTURE)              | —                           | —          | —              |
| Tax document          | PDF              | interpretation-heavy                               | **OUT OF SCOPE** (FUTURE, `[COUNSEL]`) | —                           | —          | —              |

## §A9. Implementation sequence — refined & repo-checked (refines §26, §34)

Repo check: DOC-1 is near-CURRENT (attachments exist); statement batches must move **after** classification/taxonomy and **behind OQ-03/FUT-004**, so the generic template is adjusted. Sequence (none authorised; each batch flag-gated, default **OFF**):

| Batch      | Scope                                                                               | Depends on                                | Security gate                           | Migration                                                       | Finance gate                | E2EE impl.                                 | AI-Firewall impl.                  | Prod-verify                       | User approval     |
| ---------- | ----------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------- | --------------------------------------------------------------- | --------------------------- | ------------------------------------------ | ---------------------------------- | --------------------------------- | ----------------- |
| **DOC-0**  | Freeze extraction+classification **contracts** (docs/ADR)                           | —                                         | none (docs)                             | No                                                              | n/a                         | none                                       | none                               | none                              | **Yes** (plan)    |
| **DOC-1**  | Total-only attach/review foundation                                                 | attachments (CURRENT)                     | IDOR scope                              | No                                                              | green (no writes to totals) | reuses file-key model                      | none                               | flag OFF, IDOR test               | **Yes**           |
| **DOC-2**  | `DocumentExtractionEngine` interface + **no-op stub**                               | DOC-0                                     | none (stub)                             | No                                                              | green                       | none                                       | none                               | stub returns nothing              | **Yes**           |
| **DOC-3**  | Extraction **spike**: image-OCR vs text-PDF vs scanned-PDF (on-device class first)  | DOC-2                                     | fail-closed if external                 | No                                                              | green                       | **bytes stay on-device** (on-device class) | **required if any external**       | prove bytes-on-device             | **Yes**           |
| **DOC-4**  | Receipt **itemized extraction + reconciliation** (§A6)                              | DOC-3                                     | write-nothing-until-confirm             | **likely** (line-item store or attachment metadata `[PRODUCT]`) | **green, mandatory**        | subordinate metadata; item labels classify | per DOC-3                          | UP/DOWN/re-apply on disposable PG | **Yes**           |
| **DOC-5**  | Classification / taxonomy **foundation** (read model, category-parity reporting)    | DOC-4                                     | Matrix class for each derived field     | **likely** (taxonomy tables)                                    | green                       | derived-tag sensitivity `[COUNSEL]`        | none (deterministic)               | classification provenance test    | **Yes**           |
| **DOC-6**  | **Credit-card statement** extract/review                                            | DOC-3/5 + **OQ-03 cleared** + **FUT-004** | no CVV/PIN/PAN; delete-original-default | likely (statement/txn)                                          | **green** (candidate-only)  | statement free-text E2EE                   | **required** (external OCR likely) | dedup + no-secret-store test      | **Yes + COUNSEL** |
| **DOC-7**  | **Bank statement** extract/review (bank normalization)                              | DOC-6                                     | same as DOC-6                           | likely                                                          | green                       | same                                       | required                           | running-balance recon test        | **Yes + COUNSEL** |
| **DOC-8+** | Other families (utility/subscription/rent/EMI/travel); population learning (FUTURE) | DOC-5/7 + `[COUNSEL]`                     | consent + governance                    | likely                                                          | green                       | per family                                 | per source                         | per family                        | **Yes + COUNSEL** |

Do not skip DOC-0. **Stop and re-review after DOC-5**; do not begin DOC-6/7 until OQ-03 + FUT-004 + AI-Firewall gates are cleared.

## §A10. Provider strategy (no provider selected — refines §8, §22)

- **Capability needed:** (a) image OCR (receipts, low-structure), (b) text-PDF text+table extraction, (c) scanned-PDF page render → OCR, (d) later: statement table extraction. All behind adapters (§A1).
- **Provider must satisfy:** privacy posture (**can bytes stay on-device?** if not, ZDR/no-train + counsel), accuracy on Indian receipts/GST/multi-currency/multilingual, table/line-item fidelity, confidence scoring, latency budget, cost/page, availability/SLA, graceful fallback, low lock-in, reproducibility.
- **When to evaluate:** at **DOC-3** (spike), **not before**. **Test local/on-device OCR first** — it avoids the AI-Firewall + OQ-03 gates entirely.
- **What forces AI-Firewall changes:** any **external/managed OCR or VLM** (bytes/text leave the device) → requires fail-closed mediation, projections-not-raw, per-signal consent, ZDR, and clears **OQ-03**. On-device class does not.
- **Criteria weighting:** privacy > accuracy > reproducibility > latency > cost (privacy first, per the frozen stack).

---

# ADDENDUM — 2026-08-14 · DOC-0 implemented (contracts + stub only)

**This ADDENDUM records a code change** (the assessment sections §1–§35 and §A1–§A10 above remain read-only analysis; the "Reconciliation" block below describes _those_ sections). **DOC-0** — the stable contract + safe stub foundation from §A9 — is now implemented. **No OCR, no provider, no taxonomy, no CC/bank import, no ML, no migration, no package, no external call, no finance write.**

**Contract location (backend):** `backend/src/app/document-intelligence/`

- `engine/document-extraction-engine.types.ts` — `DocumentExtractionEngine` interface, normalized input/result envelope (header · line items · reconciliation · statement transactions), `ExtractedField<T>` with `confidence`/`provenance`/`authority`, `DocumentFamily`/`ExtractionStatus`/`ReconciliationStatus` enums, `capabilities()`, and the `DOCUMENT_EXTRACTION_ENGINE` DI token. `confidence` is documented as extraction certainty, **not** financial correctness.
- `engine/reconciliation.ts` — pure `computeReconciliation()` (`unallocatedDifference = documentTotal − allocatedTotal`; BALANCED/UNDER_ALLOCATED/OVER_ALLOCATED/UNRECONCILED); **surfaces differences, never corrects them**.
- `engine/stub-document-extraction-engine.ts` — safe stub: validates image/PDF input → returns explicit `invalid_input` / `unsupported_document`; **fabricates no values**, calls no OCR/AI/network, no finance write.
- `engine/classification-engine.types.ts` + `engine/stub-classification-engine.ts` — separate, replaceable `ClassificationEngine` boundary + `CLASSIFICATION_ENGINE` token; stub returns **no** candidate tags (no taxonomy/tagging/learning/persistence).
- `document-intelligence.module.ts` — binds both tokens via `useClass` and exports them. **Not yet registered in `AppModule`** — nothing consumes it until DOC-1.
- Specs: `document-extraction-engine.spec.ts`, `classification-engine.spec.ts`, `document-intelligence.module.spec.ts` (21 tests: input acceptance, failure states, no-fabrication, all four reconciliation states, authority states, confidence≠correctness, engine independence, no finance-write/decrypt/external surface, DI replaceability).

**Intentionally NOT implemented (later DOC batches):** OCR/PDF/vision extraction; provider selection; dynamic/global taxonomy; tag persistence/governance; CC/bank statement import; population learning/training; Goal Engine integration; any DB entity/migration; any API endpoint; `AppModule` registration.

**Boundaries preserved:** FIN-002 (candidates-only; golden gate green), E2EE (no decrypt path; minimized input), AI Firewall (no external call; `usesExternalProvider=false`), Goal Engine contract, SEC-KI1 — all untouched. Frozen stack (SRS/Ledger/ADR/OpenAPI/Matrix) unmodified.

---

# ADDENDUM — 2026-08-14 · DOC-1 implemented (intake boundary: TOTAL_ONLY vs ITEMIZED)

**DOC-1 COMPLETE.** Establishes the safe user-workflow boundary around the **existing** attachment infrastructure — **before** any real extraction. **OCR NOT IMPLEMENTED · PDF extraction NOT IMPLEMENTED · taxonomy NOT IMPLEMENTED · CC/bank statement import NOT IMPLEMENTED · no ML/training · no provider · no package · no migration.**

**What DOC-1 adds (backend `backend/src/app/document-intelligence/intake/`):**

- `document-processing-mode.ts` — `DocumentProcessingMode` enum (`TOTAL_ONLY` | `ITEMIZED`); a **request-level** choice (no persisted column → no migration).
- `document-intake.service.ts` — owner-scoped `process(userId, attachmentId, mode)`. **TOTAL_ONLY** → no extraction (caller uses the normal expense flow). **ITEMIZED** → invokes the DOC-0 `DOCUMENT_EXTRACTION_ENGINE` with a **minimized** input (`buildExtractionInput`: opaque `documentRef` + `sourceType`/`mimeType`/`sizeBytes` only — never `encryptedFileKey`/`encryptedOriginalName`/`storageKey`/keys/PII) → stub returns explicit `unsupported_document`. `resolveSourceType` maps mime → image/pdf/unknown. IDOR-safe: non-uploader → 404.
- `document-intake.controller.ts` — `POST /document-intelligence/attachments/:attachmentId/process`, `JwtAuthGuard` + throttled + flag-gated.
- `document-intelligence-enabled.guard.ts` — gates the surface behind the new `document.intelligence` flag (**default OFF** → 404).
- `document-intelligence.module.ts` — now imports `TypeOrmModule.forFeature([Attachment])` (reuse for the ownership check only), registers the controller + service + guard, keeps the engine token bindings; **registered in AppModule** (first consumer).
- `feature-flags.constants.ts` — additive `document.intelligence` flag (`FEATURE_DOCUMENT_INTELLIGENCE`, default false).
- `openapi.yaml` — additive path for the **implemented** endpoint only.

**Frontend (minimal, self-contained — `frontend/src/app/features/documents/`):** `DocumentIntelligenceApiService` (POSTs mode only) + `DocumentModeSelectorComponent` (Total-only / Extract-items chooser that shows an explicit _"item extraction isn't available yet"_ notice for ITEMIZED — never fake success). **Not wired into the finance-critical create-expense modal** — that integration is deferred to DOC-2 (when extraction is real) to avoid touching finance UX now.

**Boundaries preserved:** FIN-002 (no finance write; golden gate green); E2EE (no server-side decryption; minimized input carries no keys); AI Firewall (no external/OCR call); Goal Engine + SEC-KI1 untouched. **No migration** (mode is request-level; existing attachment storage suffices). Frozen **SRS/Decision-Ledger/ADR/Matrix unmodified**. **Verification:** backend 63 suites/719 tests, frontend 63 suites/524 tests, both builds pass, lint 0.

**Deferred to later batches:** real extraction adapters (DOC-2/3), reconciliation UI + itemized persistence (DOC-4), taxonomy (DOC-5), CC/bank statements (DOC-6/7 — gated by OQ-03 + FUT-004), and wiring the mode selector into the expense flow.

---

# ADDENDUM — 2026-08-14 · DOC-2 extraction technology spike (architecture only; no provider/package)

**DOC-2 COMPLETE (spike).** Implemented the internal **adapter architecture** behind the **unchanged** DOC-0 contract, plus synthetic fixtures, tests, and the engineering comparison doc [`FINMATE_DOCUMENT_EXTRACTION_SPIKE.md`](./FINMATE_DOCUMENT_EXTRACTION_SPIKE.md). **No OCR/PDF package installed, no provider selected, no external service called, no migration, no finance change, no E2EE decryption, no DOC-0 contract change.**

**Added (backend `engine/`):** `adapters/extraction-adapter.types.ts` (internal `ExtractionAdapter` boundary), `adapters/document-source-detector.ts` (`detectSourceType` + `selectAdapterKind`: image / text-PDF / scanned-PDF / none), `adapters/spike-adapters.ts` (Image/PdfText/PdfScan stubs → explicit `provider_unavailable`, each declaring the package a real impl needs), `local-document-extraction-engine.ts` (`LocalDocumentExtractionEngine`: detection → adapter → `computeReconciliation` → `DocumentExtractionResult`; on-device-first, `usesExternalProvider=false`), `__fixtures__/receipts.fixtures.ts` (synthetic, no images/PII). Tests: source detection, adapter routing, reconciliation BALANCED/UNDER/OVER (fixtures + through-engine), no-fabrication, replaceability (`Stub → Local`), no finance-write/decrypt/external surface.

**Not bound:** the stub remains the active engine (zero behaviour change); `LocalDocumentExtractionEngine` is the ready-to-bind artifact.

**Recommendation (not a decision):** on-device-first, **text-PDF-first** — for DOC-3 request approval to add **pdfjs-dist** then **Tesseract.js** (Apache-2.0, on-device, zero unit cost, no firewall/OQ-03 dependency), then run the measured spike against the fixtures. Managed OCR / VLM remain `CANDIDATE — NOT SELECTED` (blocked by AI Firewall + OQ-03). **Installing any package is the first DOC-3 action and requires explicit approval.**

---

# ADDENDUM — 2026-08-14 · DOC-3 measured local extraction (pdfjs + tesseract installed)

**DOC-3 COMPLETE (measured spike).** Approved packages `pdfjs-dist@6.2.108` + `tesseract.js@7.0.0` installed; real adapters implemented behind the **unchanged** DOC-0 contract; measured results recorded in [`FINMATE_DOCUMENT_EXTRACTION_SPIKE.md`](./FINMATE_DOCUMENT_EXTRACTION_SPIKE.md) (§DOC-3). **No other package, no external/cloud/AI call, no migration, no finance change, no E2EE decryption.**

**Measured:** **text-PDF extraction (pdfjs) WORKS** — merchant/date/currency/total/line-items extracted accurately, reconciliation BALANCED/UNDER/OVER correct, fully local, ~15–280 ms (via `backend/tools/doc3-pdf-extraction-harness.mjs`; pdfjs v6 is ESM-only and won't load in Jest, so Jest tests the adapter logic via an injected fake loader + the pure parser). **Image OCR (tesseract) BLOCKED safe-by-default** — v7 defaults to a CDN fetch for core/worker/language data and ships no `eng.traineddata`; the adapter refuses to run (returns `provider_unavailable`) rather than hit the network. **Scanned-PDF BLOCKED** — rendering needs a rasterizer (canvas), not in the approved set.

**New decisions surfaced (not taken):** `[PACKAGE/ENGINEERING]` offline OCR language-data asset (`eng.traineddata`, ~10–15 MB, local `langPath`, no CDN); `[PACKAGE]` rasterizer (`canvas`) for scanned-PDF. Managed OCR/VLM stay blocked (AI Firewall + OQ-03).

**Next (DOC-4, not started):** extraction **review UI** (edit/add/remove items + reconciliation + user confirmation) on the working text-PDF path, kept out of the finance-critical expense modal; line-item persistence remains a `[PRODUCT DECISION]`.

---

# ADDENDUM — 2026-08-14 · DOC-4 review & confirmation layer (frontend, no backend/migration)

**DOC-4 COMPLETE.** The user review/confirmation experience for extracted candidates — **frontend-only**, on the working **PDF-text** path. **No new OCR, no package, no rasterizer, no taxonomy/tags, no CC/bank import, no ML, no cloud/AI, no migration, no backend change, no finance-calc change, no E2EE decryption.**

**Why frontend-only:** DOC-3 established the server cannot extract E2EE attachment content (no plaintext); the review layer consumes a `DocumentExtractionResult` and PDF-text extraction runs **client-side** (pdfjs, code-split, in-browser). No new backend endpoint or migration was required (candidates are edited client-side; only an explicit confirm hands a draft to the existing expense flow), so none was added.

**Added (`frontend/src/app/features/documents/`):**

- `document-review.model.ts` — editable review model (fields carry `authority`: EXTRACTED→USER_CORRECTED on edit→USER_CONFIRMED on confirm), `ConfirmedDocumentDraft`.
- `services/document-review.service.ts` — pure: `fromExtractionResult`, edit/add/delete (raise authority), `reconcile` (BALANCED/UNDER/OVER/UNRECONCILED; **never invents an item, never silently changes the document total**), explicit `confirm()` → draft.
- `services/document-extraction-client.service.ts` + `receipt-text-parser.ts` — client PDF-text extraction (pluggable pdfjs loader; images honestly `provider_unavailable` — no pretend OCR).
- `document-review.component.*` — editable candidates + live reconciliation + explicit Confirm/Cancel; honest failure/unavailable/empty states. `document-intake-page.component.*` — mode selector → TOTAL_ONLY (bypass) / ITEMIZED (extract→review→confirm). Lazy route `/documents`.

**Boundaries:** confirm is the only path to a draft; the draft carries no bytes/keys/OCR text; nothing mutates finance before the existing authoritative flow; not wired into the 700-line expense modal (separate flow); IDOR unchanged (no new attachment access). **Verification:** frontend 67 suites/546 tests, backend 71/756 (finance gate green), both builds pass, lint 0.

**Deferred:** wiring the confirmed draft into the expense-creation flow; image OCR (language-data decision); scanned-PDF (rasterizer); line-item persistence `[PRODUCT DECISION]`.

---

# ADDENDUM — 2026-08-14 · DOC-5 dynamic taxonomy + classification foundation (MIGRATION-FREE)

**DOC-5 COMPLETE.** A deterministic classification foundation over a **single shared canonical taxonomy**, integrated into the DOC-4 review as advisory tags. **No migration, no persistence, no ML/training, no population learning, no cloud/AI, no package, no CC/bank/DOC-6/7 work, no OCR/rasterizer work.**

**Migration decision — NOT required (documented):** the canonical taxonomy is a **bounded code seed** (common to all users by construction — no per-user duplicate, no uncontrolled auto-creation, no taxonomy explosion, stable ids, no destructive renames). Classification is **advisory metadata computed on-the-fly**; user corrections live in the **client review model** (authority transitions). None of this needs a table. **A future migration IS required only to persist** expense↔tag links, per-user tag preferences/corrections, and dynamic tag _proposals_ (candidate→reviewed→active→deprecated lifecycle) — **deferred and reported, not created** (see "Deferred persistence" below). Per the batch rule, no migration was silently created.

**Single shared taxonomy (`@finmate/data-models`, both BE + FE consume it):**

- `taxonomy/canonical-taxonomy.ts` — `CanonicalTag {id, canonicalName, normalizedKey, aliases, parentId?, status(candidate|reviewed|active|deprecated), version}` + a bounded `CANONICAL_TAXONOMY` seed (food>grocery>dairy>milk…, transport>vehicle>fuel, household>cleaning>detergent, dining>restaurant, utilities). **No medical/pharmacy/health/sensitive categories** (surfaced decision).
- `taxonomy/classify.ts` — `normalizeTagKey`, `classifyLabel(label, category?)`: deterministic, alias-aware, ancestor-expanding (milk→dairy→grocery→food), deduped, **only active seed tags** (bounded), `[]` when nothing matches. Output is INFERRED, source `rule_based`, `confidence` = match certainty (**never financial correctness**).

**Backend:** `RuleBasedClassificationEngine` implements the **unchanged** DOC-0 `ClassificationEngine` contract via the shared classifier and is bound to `CLASSIFICATION_ENGINE` (stub → rule_based → future model/population, no contract change). Uses only the minimized `{itemLabel, category}` input — never E2EE title/description, never keys/PII. No endpoint added (no live server consumer; classification's real value is client-side).

**Frontend (extends DOC-4 review, no finance-modal change):** each review line item gets **engine-suggested tags** (INFERRED) from the same shared classifier; the user can **add** a tag (per-user correction → USER_CORRECTED, source `user`, **not** global) or **remove** one; on confirm, kept engine tags become USER_CONFIRMED while user tags stay USER_CORRECTED, and `ConfirmedDocumentDraft.items[].tags` carries the advisory metadata forward for a future safe persistence path — keeping **engine suggestion / per-user correction / global taxonomy** three distinct layers (the basis for future population learning).

**Boundaries:** classifier receives only minimized signals (no E2EE plaintext, no keys); classification/tags never touch amount/payer/split/refund/settlement/currency/balance (FIN-002 gate green); tags are advisory, not financial truth; no cross-user access (corrections are client-side, per-session); sensitive-tag inference explicitly excluded.

**Deferred persistence (needs a future migration — reported, not created):** `taxonomy_tags`/`tag_aliases` (if the seed ever moves to DB + dynamic proposals), `expense_item_tags` (item↔tag links), `user_tag_preferences` (persisted corrections). Each would need a migration + Data-Classification-Matrix entry (a **derived tag can be sensitive**) + governance for candidate→active promotion — all `[PRODUCT DECISION]`/`[COUNSEL]`, unstarted.

**Population-learning boundary:** unchanged and FUTURE — private user corrections do **not** become training data; runtime≠evaluation≠aggregate-learning≠training. **Goal Engine boundary:** unchanged — taxonomy would feed the Goal Engine only as minimized numeric/enum projections, never raw tags/text.

**Verification:** data-models 2 suites/13 tests, backend 72/763 (finance gate green), frontend 67/552, backend + frontend builds pass, lint passes with 0 errors (existing warnings remain).

---

# ADDENDUM — 2026-08-18 · Offline image OCR enabled (DOC-3 language-data completion) — CODE + LOCAL ASSET

**⚠️ Label note (frozen roadmap untouched):** this batch was requested as "DOC-6", but the FROZEN roadmap (§ roadmap table) already assigns **DOC-6 = Credit-card statement** and **DOC-7 = Bank statement** (both gated by OQ-03 + FUT-004 + AI-Firewall, "external OCR likely", COUNSEL). This work is instead the **completion of the DOC-3 deferred `[PACKAGE/ENGINEERING]` OCR language-data decision** — fully on-device, no OQ-03/AI-Firewall gate. **The frozen roadmap rows are intentionally NOT renumbered or modified.** No frozen SRS/Ledger/ADR/Matrix change.

**COMPLETE — image OCR now runs LOCAL/OFFLINE.** The DOC-3 `ImageExtractionAdapter` was safe-by-default (`provider_unavailable`, never a CDN fetch) but had no wired recognizer. It now runs a real **local-only** tesseract.js worker when the local model is present. **No new package** (tesseract.js@7 / tesseract.js-core@7 already installed in DOC-3), **no migration**, **no finance-calc change**, **no E2EE decryption**, **no cloud/AI**, **no rasterizer**, **no CC/bank/DOC-6-7 work**.

**Local OCR language asset (committed):** `backend/src/assets/tessdata/eng.traineddata` — `tessdata_fast` @ tag `4.1.0`, 4,113,088 bytes, SHA-256 `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`, **Apache-2.0**, byte-identical across two independent mirrors. Provenance/license recorded in `backend/src/assets/tessdata/PROVENANCE.md`; `*.traineddata` marked `binary` in `.gitattributes`.

**Local-only wiring (`engine/adapters/local-tesseract-recognizer.ts`):** loads WASM core + worker via local `require('tesseract.js'/-core)` (never network) and the model via `langPath` → the committed dir with `gzip:false`, `cacheMethod:'none'`, **no logger**. tesseract.js is **lazily imported** so it never enters the module graph unless OCR runs. `engLangDataAvailable()` is a **pure filesystem check**; the adapter returns `provider_unavailable` when the asset is absent and the recognizer **fails closed** (throws, never fetches) if constructed without it. tesseract's jsdelivr fallback only triggers when `langPath` is unset — it is always set here, so it is unreachable.

**Offline proof (smoke harness `backend/tools/doc6-ocr-offline-smoke.mjs`):** with `http`/`https`/`fetch` all patched to throw, a synthetic receipt image (pure-Node BMP, no rasterizer package) OCR'd to `"TOTAL 128"` in ~1.2 s with **0 network attempts** — real glyph OCR, fully offline. (The `0→8` slip is the crude synthetic font, not the pipeline; real-receipt glyph accuracy against a rasterizer remains a future measurement.)

**Boundaries preserved:** DOC-0 contract **unchanged**; the review flow is still `document → extraction candidates → user edits → explicit confirm → draft` (no auto-finance mutation); DOC-5 taxonomy tags stay advisory (never touch amount/payer/split/refund/settlement/currency/balance — FIN-002 gate green); the OCR seam receives only image bytes + mime (adversarial test proves no keys/tokens/PII reach it); `document.intelligence` flag remains **OFF by default** and the LocalEngine stays unbound in the module (stub is the active engine); `TOTAL_ONLY` stays extraction-free; scanned-PDF still returns its explicit no-rasterizer boundary.

**Deferred (unchanged, FUTURE):** scanned-PDF rasterizer; real-receipt OCR accuracy tuning (preprocessing/deskew/threshold); larger `tessdata`/`best` model; CC/bank statements (frozen DOC-6/7, OQ-03+FUT-004+COUNSEL); managed OCR/VLM.

**Verification:** backend 73 suites/769 tests (finance golden gate green), frontend unchanged, builds pass, lint 0 errors. Offline smoke: PASS (0 network attempts).

---

## Hardening — 2026-08-18 · offline OCR reproducibility (DOC-3 completion, no new package)

Small non-gated hardening of the existing offline image-OCR path — **no new package, no provider, no migration, no contract change, no production enablement** (flag stays OFF, LocalEngine stays unbound).

- **Build/packaging (verified, corrected):** the backend build already ships the model — `backend/webpack.config.js` uses `NxAppWebpackPlugin` with `assets: ['./src/assets']`, so `eng.traineddata` is copied to `dist/backend/assets/tessdata/eng.traineddata`. (The earlier DOC-6 "deferred production asset-copy" note was inaccurate and is removed.)
- **Recognizer path resolution (fixed):** `local-tesseract-recognizer.ts` now also resolves the **bundled/deployed** layout `resolve(__dirname, 'assets', 'tessdata')` (i.e. `dist/backend/assets/tessdata`) in addition to the dev/test source path and CWD candidates — so offline OCR is discoverable in a built deployment, not only in dev/test. `provider_unavailable` / fail-closed behaviour when the asset is genuinely absent is unchanged.
- **Reproducibility gate (added):** `tessdata-asset.spec.ts` pins the asset's presence, exact size (4,113,088 B) and SHA-256 (`7d4322bd…`) against `PROVENANCE.md` — a missing/corrupt/swapped/wrong-version model fails CI loudly instead of silently degrading.
- **Re-verified boundaries (unchanged):** core/worker via local `require`, model via local `langPath` (no CDN, no `fetch`/`node-fetch` in the runtime path); no OCR text/bytes logged; OCR is backend-only (frontend imports no tesseract); `TOTAL_ONLY` never extracts; DOC-4 review + DOC-5 advisory tags + FIN-002 candidate-only all intact.

---

# ADDENDUM — 2026-08-19 · DOC-3E browser-local receipt OCR + E2EE-safe expense-draft seam (frontend, no package, no migration)

**Why browser-local (privacy boundary):** FinMate attachments are **client-side E2EE** — the create-expense modal generates a per-file key, encrypts the bytes, and wraps the key under the scope key before upload (`create-expense-modal.component.ts`); the `Attachment` entity stores only `encryptedFileKey` + ciphertext. **The backend never sees plaintext receipt bytes.** Therefore the DOC-3/DOC-6 **backend** OCR (Node `LocalTesseractRecognizer`) **cannot** OCR an E2EE receipt without either server-side decryption or shipping plaintext to the server — both forbidden. DOC-3E runs OCR **entirely in the browser** so receipt bytes never leave the device.

**Pipeline (all client-side up to the existing finance flow):** image bytes → browser Tesseract WASM → OCR text → `parseReceiptText` → DOC-5 `classifyLabel` advisory tags → DOC-4 review (edit items/tags, reconciliation, explicit confirm) → `ConfirmedDocumentDraft` → **additive** expense-modal pre-fill → existing finance/E2EE logic (user still submits).

**Implemented (frontend):**

- `services/browser-ocr.service.ts` — `BrowserOcrService`: lazy `import('tesseract.js')` (code-split), `createWorker('eng', LSTM_ONLY, { workerPath, corePath, langPath })` all **same-origin `/assets`**, `gzip:false`, `cacheMethod:'none'`, **no logger**. The jsdelivr CDN fallback is unreachable (paths are always set local); a missing/failed asset **fails closed** (throws → `provider_unavailable`), never a network fetch. Loader is injectable for tests.
- `services/document-extraction-client.service.ts` — the image branch now calls local OCR (was `provider_unavailable`): `ok`/`partial_extraction` with header+items, `no_text_detected` on empty, `provider_unavailable` on failure. Injectable `useOcr()` seam; the service holds **no HttpClient** — receipt bytes never go to the backend.
- `frontend/project.json` — build `assets` copy tesseract worker (`tesseract.js/dist/worker.min.js`), core WASM+loaders (`tesseract.js-core/*.wasm`, `*.wasm.js`) and the **single committed** `eng.traineddata` (from `backend/src/assets/tessdata`) to `/assets/tesseract` + `/assets/tessdata` (same-origin, **no CDN**, no duplicate binary in git).
- `expense-draft-prefill.ts` — pure `mapDraftToExpensePrefill(draft)` → `{ title, amountTotal, currency, expenseDate }` only. **No** payer/split/refund/settlement/category/tags cross into finance.
- `create-expense-modal.component.ts` — **additive** `@Input() prefill: ExpenseDraftPrefill` + create-mode-only `applyPrefill()` that patches only those non-finance fields (mirrors the edit-mode patch). Edit mode ignores it; finance logic (payer/split/refund/settlement/duplicate/encryption) **unchanged**.

**Asset:** reuses the **same** DOC-6 `eng.traineddata` (tessdata_fast 4.1.0, SHA-256 `7d4322bd…`, Apache-2.0) — no new asset, no new package (tesseract.js@7 already installed).

**Backend OCR unchanged & retained:** the Node `LocalTesseractRecognizer` / `LocalDocumentExtractionEngine` remain as an **available, replaceable adapter** behind the unchanged DOC-0 contract; they are **not** bound to E2EE-attachment processing (the stub stays the active engine; `document.intelligence` stays OFF). E2EE receipt OCR uses the browser path.

**Boundaries:** no server-side decryption; no plaintext bytes/keys/OCR text to backend; DOC-0 contract unchanged; DOC-5 taxonomy reused (tags advisory: INFERRED→USER_CONFIRMED on confirm, user adds stay USER_CORRECTED; never touch amount/payer/split/refund/settlement/currency/balance); `TOTAL_ONLY` never OCRs; FIN-002 candidate-only, golden gate green; no migration; flag OFF.

**Verification:** frontend 69 suites/564 tests in the affected set green (full suite in progress); backend unchanged (772). **Browser WASM OCR cannot run in the Jest VM** — unit tests use an injected fake recognizer; a real end-to-end browser OCR run requires a browser and is a manual/e2e check (not fabricated here).

---

# ADDENDUM — 2026-08-19 · DOC-3F receipt-capture UX integration (frontend, no package, no migration)

**Goal:** connect the already-built DI pieces into a **scope-aware** receipt workflow that funnels through the existing authoritative expense flow. **No new package, no migration, no finance-calc change, no server-side decryption, no cloud OCR/CDN, no scanned-PDF, no CC/bank (DOC-6/7), no ML.** The document flow **never creates an expense** and never touches payer/participants/split/refund/settlement/balance/currency.

**Scope model (inspected, reused — not reinvented):** the create-expense modal already carries scope via inputs — **personal** (dashboard: `[groupId]="null"`, `[members]="[]"`) vs **group** (group-detail: group id/members/type). DOC-3F puts the receipt launcher **inside** that already-scoped modal, so the originating scope is preserved automatically with **no parent/routing changes** and **no new scope model**.

**Flow:** modal "Scan a receipt" (create-mode + flag only) → `ReceiptCaptureComponent` overlay → mode select → **TOTAL_ONLY: no extraction** (keep normal flow, existing E2EE attachment) / **EXTRACT_ITEMS**: pick file → browser-local extraction (`DocumentExtractionClientService`: image = DOC-3E Tesseract WASM, text PDF = pdfjs, scanned PDF = `provider_unavailable`) → DOC-4 `DocumentReviewComponent` (edit items, correct tags, reconciliation, **explicit confirm**) → `ConfirmedDocumentDraft` → `mapDraftToExpensePrefill` (header fields only) → modal `applyPrefill` → user **explicitly submits** through the existing finance/E2EE path.

**Implemented (frontend, additive):**

- `receipt-capture.component.ts/.html` — embeddable orchestrator; reuses the mode selector, extraction client, and review component; emits `confirmed`/`totalOnly`/`cancelled`; performs no upload, no finance mutation; extraction runs on the picked file's bytes **in the browser** (no keys/plaintext to backend).
- `create-expense-modal.component.ts/.html` — **additive** flag-gated "Scan a receipt" button (create-mode only) + overlay + handlers (`onReceiptConfirmed` maps draft → existing `applyPrefill`). Finance logic (payer/split/refund/settlement/duplicate/encryption) **unchanged**; edit mode ignores it.
- `environments/environment.ts` + `environment.prod.ts` — additive `documentIntelligence` flag, **default OFF** in both (mirrors the backend `document.intelligence`); when OFF the entry point is hidden (no active workflow). Not enabled in production.
- `document-mode-selector` copy refreshed (the stale "extraction isn't available yet" notice → accurate on-device wording with the scanned-PDF caveat).

**E2EE:** receipt bytes are read **only in the browser** for OCR; no server-side decryption, no keys/plaintext/OCR-text sent to the backend. The final attachment (if the user adds one) continues through the **existing client-side E2EE attachment path** — DOC-3F does not auto-attach or alter that path.

**Taxonomy:** reuses DOC-5 (`DocumentReviewService.suggestTags`/`classifyLabel`); tags stay advisory (INFERRED→USER_CONFIRMED on confirm; user adds stay USER_CORRECTED); the prefill carries **no** tags/category into finance; expense category is not auto-changed.

**Browser OCR e2e:** added `frontend-e2e/src/receipt-ocr-assets.spec.ts` asserting (a) worker/core/model served **same-origin** and (b) **no external OCR/CDN request** on load. **Not executed in this environment** (no served stack/browsers here). Full UI-flow steps (synthetic image → OCR → review → draft → explicit submit) require the flag ON + auth and are a manual/flag-enabled e2e run — **documented, not fabricated**.

**Verification:** frontend affected set 70 suites/574 tests green (full suite + build + lint below); backend unchanged (772; finance golden gate PASS — no backend change). Migration/DB: none. Production/flag: `document.intelligence` and the frontend `documentIntelligence` stay OFF.

---

## Reconciliation

- ✅ **READ-ONLY** — no code, schema, migration, entity, DTO, API/OpenAPI, package, provider, or production change.
- ✅ **Frozen stack untouched** — SRS v1.0, Decision Ledger, ADRs, API contracts, OpenAPI, Matrix, AI-Firewall, Threat Model, Ownership/Migration/Roadmap docs **not modified**.
- ✅ **Boundaries preserved** — FIN-002, E2EE, AI Firewall, REC-1, Goal Engine contract, SEC-KI1 all intact and unmodified.
- ✅ **CURRENT vs TARGET distinguished** — §2 (evidence-backed CURRENT/VERIFIED) is the only "exists today" claim; §8–§35 are TARGET/FUTURE, none implemented.
- ✅ **No decision silently resolved** — PRODUCT/ENGINEERING/COUNSEL/OPEN items surfaced, not answered.
- ✅ **No provider selected** — repo/frozen docs mandate none; none chosen here.
- ✅ **2026-08-14 addendum is additive** — the "Scope refinement" section (§A1–§A10) refines scope on top of §1–§35 and **supersedes no prior finding**. It surfaces (does not modify) SRS constraints **FUT-004** and **OQ-03**; SRS v1.0 remains FROZEN and untouched.

**One-line status:** _Readiness assessment only — substrate exists (attachments, tabular import, category-based reporting, E2EE-safe dedup, replaceable-engine + FIN-002 precedents); intelligence does not. One pipeline with input-specific adapters (image/text-PDF/scanned-PDF) → one normalized contract; receipts NOW (total-only) / NEXT (itemized); CC+bank statements NEXT-but-BLOCKED (OQ-03+FUT-004); investment/tax/legal OUT. Freeze the two engine contracts; implement nothing until the per-batch gates clear._

_End of assessment. Authorises no code, schema, migration, API, model, training, provider, or SRS change._
