# FinMate — Document Intelligence & Dynamic Taxonomy (FUTURE / PARKED)

**Status:** **Future design / parked pending SRS v1.0 closure.** This is a **parking document** for capabilities discussed but **intentionally NOT added to the frozen SRS v1.0**.

**Nature:** design exploration / parking documentation **only**. Authorises **no** code, schema, migration, entity, API contract, DTO, OCR/ML model, training pipeline, package, external-AI provider, production, or user-data-collection change. **No frozen document is modified by this file** — not the SRS, not the Decision Ledger, not any ADR, not any API contract, not the Data Classification Matrix, not the Key Management / Security / AI Firewall / IP / Threat Model / Ownership Map / Migration Plan / Roadmap / Execution Plan documents. Nothing here is a decision; unresolved items are marked `[OPEN QUESTION]`, `[PRODUCT DECISION REQUIRED]`, `[ENGINEERING PARAMETER]`, or `[COUNSEL / COMPLIANCE VALIDATION REQUIRED]`.

**Governing (frozen) sources this document must respect (and does not alter):** SRS v1.0 (FROZEN 2026-08-12) · Decision Ledger · Data Classification & Encryption Matrix (#2) · Security & Privacy Architecture (#3) · Key Management Architecture (#4) · AI Data-Access & Privacy Firewall (#5) · IP/AI Confidentiality Policy (#6) · Threat Model (#7) · Module & Data Ownership Map (#15) · API & Data Contracts (#16) · Backward Compatibility & Migration Plan (#17) · Implementation Roadmap · Pre-Implementation Execution Plan · Goal Engine Architecture & Contract · ADRs (esp. ADR-003 Class-A/B, ADR-008 INTELLIGENCE = signals-not-raw, ADR-009/010 AI firewall, ADR-011 external-AI consent, ADR-024 Zone-2).

**Labels used throughout (identical to the frozen stack):** **CURRENT** = exists in the repository today (evidence-backed) · **TARGET / FUTURE** = the document-intelligence, OCR, itemization, global dynamic taxonomy, classification-learning, statement-extraction, and population-learning concepts explored here — **none implemented** · **UNKNOWN / [DECISION]** = needs PRODUCT / ENGINEERING / COUNSEL.

> **The one rule that makes this document worth writing:** FinMate should be able to grow *document intelligence* and a *shared, evolving taxonomy* **behind stable interfaces** — a `DocumentExtractionEngine` and a `ClassificationEngine`, mirroring the way the **Goal Engine** is a replaceable component behind a frozen contract — **without** loosening the financial-correctness boundary (FIN-002), the E2EE boundary, or the AI Privacy Firewall. Freeze the **interface/contract**, not the tag list or the vendor.

---

## §0. How to read this document

This document deliberately **parks** a direction. It exists so that a coherent, already-discussed set of ideas is written down **once**, in the frozen stack's own vocabulary, **without** leaking into the frozen requirements. It resolves nothing that is not already frozen elsewhere. When the current implementation/version is closed, §18 and §20 describe the formal impact review that must precede any SRS revision.

Every capability below is **TARGET / FUTURE** unless a **CURRENT** row explicitly cites repository evidence.

---

## §1. CURRENT repository reality (evidence-backed baseline)

To keep TARGET honest, here is what exists **today**. Nothing beyond this table is claimed to exist.

| Concern | CURRENT state | Evidence |
|---|---|---|
| Expense category | A **single flat** category string per expense: `category varchar(64)` (indexed with `group`). No hierarchy, no per-item categories. | `shared/data-models/src/lib/expense.entity.ts` (`category!: string`, `@Index(['group','category'])`) |
| Attachments / receipts | Attachments and **receipt versioning** exist (`receipt_versions` with `action` created/replaced/deleted, `snapshot jsonb`, actor). A receipt can be attached to an expense. | `shared/data-models/src/lib/attachment.entity.ts`, `attachment-version.entity.ts`, `receipt-version.entity.ts` |
| OCR / document extraction | **Does not exist.** No OCR, no text extraction, no image/PDF parsing, no receipt-to-items pipeline anywhere in `backend/src`, `frontend/src`, or `shared`. | repository grep — no `ocr`/`tesseract`/`textract`/document-intelligence code |
| Taxonomy / tags | **Does not exist.** No taxonomy table, no tag entity, no per-item tags, no shared/global taxonomy, no synonyms/aliases, no candidate lifecycle. | repository — no taxonomy/tag entities |
| Item-level detail | **Does not exist.** Expenses have a total (`amountTotal`), currency, payer/split/refund model — **no line items**. | `expense.entity.ts` |
| AI | A single opt-in `POST /ai/proxy` forwarding a prompt with UUID redaction. The **projection firewall is TARGET, not built** (per AI Firewall doc). | `FINMATE_AI_DATA_ACCESS_PRIVACY_FIREWALL.md` §CURRENT vs TARGET |
| Goal Engine | Deterministic `DeterministicGoalEngine` behind the frozen `GoalEngine` interface (BATCH-11, flag-gated). Numeric/enum input only. | `backend/src/app/goals/engine/*` |

**Do not** cite this document as evidence that OCR, dynamic taxonomy, global classification learning, or document intelligence exists. They do **not**.

---

## §2. Document Intelligence / Receipt Extraction (TARGET / FUTURE)

**Future capability.** Users may upload: receipt images · invoice images · PDFs · credit-card statements · (later) bank statements. The system **may** extract structured financial information from these documents.

### §2.1 Mandatory user-control rule — extraction is user-chosen, never forced

The user MUST be able to choose between two modes on any uploaded document:

**A. TOTAL-ONLY MODE (default expectation)**
- User records the main category and the total amount.
- The system does **NOT** need to extract individual items.
- The receipt/document may remain **supporting evidence** only (as receipts already do today).
- **No forced itemization.**

**B. ITEMIZED MODE (explicit opt-in per document)**
- User **explicitly** asks FinMate to extract individual items.
- OCR / document extraction runs.
- Extracted items are presented for **user review**.
- User can **edit, delete, add, or correct** items before final confirmation.

> **Rule:** OCR/extraction is **NOT** mandatory for every uploaded receipt. Uploading a document must never silently trigger itemization. `[PRODUCT DECISION REQUIRED]` whether TOTAL-ONLY is always the default and ITEMIZED is always an explicit action.

---

## §3. Financial Reconciliation (TARGET / FUTURE) — preserves FIN-002

For itemized documents, the **authoritative expense total remains the user's / transaction's final financial amount.** Extracted item amounts are **subordinate detail** — descriptive, not financial-source-of-truth.

**Illustration:**

```
Authoritative total = ₹3,200   (user/transaction — SOURCE OF TRUTH)

Extracted (subordinate detail):
  Milk         ₹240
  Rice         ₹650
  Vegetables   ₹520
  ...
  --------------------------------
  sum(items)   ≤ ₹3,200
  unallocated  = ₹3,200 − sum(items)   ← surfaced, not hidden
```

The reconciliation invariant the system SHOULD expose:

```
sum(extracted_items)  ≤  authoritative_total
remaining/unallocated =  authoritative_total − sum(extracted_items)   (surfaced for review)
```

When extraction produces **missing items, duplicate items, taxes, discounts, rounding differences, or uncertain values**, the system MUST **surface these for review** rather than silently changing the authoritative expense amount.

### §3.1 Hard financial boundary (restates and preserves FIN-002)

The system **MUST NOT** let OCR / classification silently modify:
- payer
- amount (`amountTotal`)
- split
- refund
- settlement
- currency
- financial balances

This preserves **FIN-002** (*"same inputs → same balances as production"*) and the existing financial-correctness boundary. Extraction and classification are a **descriptive/metadata layer on top of** the financial record — never a mutation path into it. Any change to payer/amount/split/refund/settlement/currency remains a **user-driven financial action**, subject to the existing month-lock (FIN-013), spectator (FIN-014), and correctness rules.

---

## §4. Global Dynamic Taxonomy (TARGET / FUTURE)

Taxonomy/tagging discussed as **GLOBAL** across FinMate users — **not** a separate duplicated taxonomy per user.

Future design SHOULD prefer a **shared/global taxonomy table or equivalent shared taxonomy service**. Different users reference the **same stable taxonomy/tag IDs**.

```
Global taxonomy (shared, stable IDs):

Food
 └── Grocery
      ├── Dairy
      │    └── Milk
      ├── Staples
      └── Snacks
Household
 └── Cleaning
```

```
User A expense item → tag_id = MILK
User B expense item → tag_id = MILK
User C expense item → tag_id = MILK
```

> **Rule:** do **NOT** duplicate "Milk" per user. Users **reference** shared, stable taxonomy IDs; they do not each own a private copy of the concept. (Personal overrides/preferences are a **separate** layer — see §9.)

**Important:** the taxonomy shape, table design, ID scheme, and governance are **NOT** decided here. This section states a **direction**, not a schema.

---

## §5. Dynamic Taxonomy Evolution (TARGET / FUTURE)

The taxonomy should **NOT** be a permanently hard-coded list. A future system should be capable of: detecting new concepts · creating **candidate** tags/categories · merging duplicate concepts · splitting overly broad concepts · deprecating obsolete concepts · maintaining aliases/synonyms · evolving the hierarchy as new data appears.

**Guardrail:** a **single uncertain extraction** MUST NOT immediately pollute the global taxonomy. Use a lifecycle such as:

```
OBSERVED → CANDIDATE → CONFIRMED → ACTIVE → (MERGED | DEPRECATED)
```

Only **ACTIVE** concepts are first-class shared taxonomy. **OBSERVED/CANDIDATE** are quarantined signals, not global truth.

> **Exact thresholds are intentionally UNDECIDED** and MUST remain future engineering/product decisions: `[ENGINEERING PARAMETER]` / `[PRODUCT DECISION REQUIRED]` — how many independent observations/users promote OBSERVED→CANDIDATE→CONFIRMED→ACTIVE; merge/split criteria; deprecation triggers. See §19.

---

## §6. User Category vs System Classification (TARGET / FUTURE)

The user normally supplies the **MAIN category at the expense level** (this maps to today's single `category` field). The user SHOULD **NOT** have to manually classify every extracted item.

```
User supplies:
  Category = Grocery
  Total    = ₹3,200

FinMate may infer (subordinate, correctable):
  Milk       → Food / Grocery / Dairy / Milk
  Rice       → Food / Grocery / Staples / Rice
  Detergent  → Household / Cleaning
```

The user can **correct** these classifications before finalization.

> **Principle:** *"User supplies coarse intent; FinMate derives fine-grained structure."* Coarse user intent is authoritative; fine-grained structure is inferred and correctable.

---

## §7. Multi-Dimensional Tagging (TARGET / FUTURE)

Classification should **not** be limited to one flat tag. Future items may carry **multiple structured dimensions**.

```
Milk:
  domain      = Food
  category    = Grocery
  subcategory = Dairy
  itemType    = Milk

Additional (flexible) tags:
  household · essential · recurring
```

Keep **"category"**, **"taxonomy classification"**, and flexible **"tags"** conceptually **distinct** where useful:
- **category** — the coarse, user-supplied intent (exists today, flat).
- **taxonomy classification** — the structured, hierarchical, shared placement (domain/category/subcategory/itemType).
- **tags** — flexible, possibly cross-cutting labels (essential, recurring, household).

> **Freeze the interface/contract, not the tag list.** Do not prematurely freeze the actual taxonomy contents.

---

## §8. Classification Provenance (TARGET / FUTURE)

Future classification records SHOULD distinguish the **source/authority** of each classification:

- `USER_CONFIRMED`
- `RULE_DERIVED`
- `MODEL_INFERRED`
- `GLOBAL_TAXONOMY`
- `CANDIDATE`

Where appropriate, retain: **confidence** · **classifier/engine version** · **provenance**.

> **Authority rule:** **user-confirmed classification has higher authority than inferred classification.** A later low-confidence `MODEL_INFERRED` result must never silently overwrite a `USER_CONFIRMED` one. (Mirrors the frozen INTELLIGENCE = signals-not-raw stance and the Goal Engine's provenance discipline.)

---

## §9. Global Learning / Cross-User Improvement (TARGET / FUTURE) — privacy-bounded

**Long-term objective:** classification improves across the **FinMate population** rather than independently relearning the same concept for every user. Example: many users repeatedly classify `"AMUL TAAZA" → Milk → Dairy → Grocery`; this **can** improve the global classifier/taxonomy for future users.

**BUT — the boundary that this section exists to state:**

> **"Better classification across users does not mean silently training on private user data."**

Do **NOT** assume that raw user receipts, OCR text, encrypted descriptions, or private documents may automatically become training data. Population learning/training MUST remain subject to:
- the existing **privacy architecture** (E2EE, Zone-2, data classification)
- **consent** requirements (external-AI consent AI-5 style, per-signal)
- **counsel** decisions `[COUNSEL / COMPLIANCE VALIDATION REQUIRED]`
- **AI firewall** requirements where applicable (fail-closed, projections, ZDR)
- **data minimization**
- **retention** rules

> **Runtime inference, evaluation, and training are three separate concepts** (identical to the Goal Engine doc). Runtime user data is **never** silently turned into training data.

---

## §10. Personal vs Global Knowledge (TARGET / FUTURE)

Future architecture may support two layers:

- **GLOBAL** — shared taxonomy/classification knowledge available to all users (ACTIVE concepts, §4/§5).
- **PERSONAL** — user-specific corrections/preferences/classifications.

Rules:
- A **personal** classification MUST NOT automatically become **globally** visible.
- A **global** taxonomy concept may eventually be **promoted from aggregate evidence only**, under approved privacy/governance rules (§9), never from a single user's private correction.

This mirrors the CURRENT/frozen split between user-held (Class-A) private data and server-managed, minimized, consented signals.

---

## §11. Search / Filter / Reporting (TARGET / FUTURE) — the actual point

Structured taxonomy is **not just for OCR**. Its purpose is to enable future: expense filtering · search · category reports · item-level reports · monthly comparisons · price history · spending trends · goal projections · intelligence signals.

```
"Show grocery spending last month"
"How much did I spend on dairy?"
"Show cleaning expenses"
```

These SHOULD be answerable using **structured taxonomy/tag metadata** rather than relying on searching **encrypted title/description** free-text. Structured, queryable metadata is what makes these features possible **without** breaking E2EE.

---

## §12. Encrypted Free-Text Compatibility (TARGET / FUTURE) — no server-side decryption backdoor

This future design MUST respect the existing privacy architecture and the frozen Data Classification & Encryption Matrix.

- Free-text such as **title, description, notes,** and **document content classified as sensitive** may be **E2EE/private** (as today for the fields the Matrix marks Class-A / E2EE).
- **Structured metadata** required for legitimate filtering/reporting may remain **separately queryable** according to the **frozen data-classification model** — i.e., only fields the Matrix already permits to be server-readable/Zone-2 are queried server-side; nothing is reclassified by this document.

> **Rule:** do **NOT** use this future feature as a backdoor to decrypt user free-text on the server. Structured taxonomy metadata is a **parallel, classified** layer — its existence must not create pressure to make encrypted free-text server-readable. Any field's classification remains governed by the frozen Matrix, and any change to a field's classification is a frozen-doc change, not something this feature may assume.

---

## §13. Document Extraction Engine boundary (TARGET / FUTURE)

The Expense module MUST NOT be tightly coupled to a specific OCR provider or ML model. Separate the stages:

```
Document
  ↓
Extraction Engine            (replaceable: OCR-A → OCR-B → multimodal model → …)
  ↓
Normalized Items
  ↓
Classification / Taxonomy Engine
  ↓
User Review
  ↓
Expense Item Metadata
  ↓
Reports / Search / Intelligence / Goal Engine
```

**Possible future evolution** — OCR provider A → OCR provider B → multimodal model → better extraction engine — **without changing the core Expense API unnecessarily.** The extraction implementation MUST be **replaceable later**. `[ENGINEERING PARAMETER]` / `[PRODUCT DECISION REQUIRED]`: provider selection, hosting, ZDR posture — all deferred and subject to the AI firewall where an external provider is involved.

---

## §14. Classification Engine boundary (TARGET / FUTURE) — mirror the Goal Engine

Define a future **stable conceptual interface**, in the same spirit as the frozen `GoalEngine` contract (replaceable component behind a stable interface). **Illustrative only — NOT an API being implemented:**

```
ClassificationEngine  (conceptual sketch — NOT a contract, NOT implemented)
  classify()
  suggestTags()
  discoverCandidates()
  mergeConcepts()
  deprecateConcept()
  capabilities()
```

> **Architectural principle:** the Expense module depends on the **classification contract**, not on a specific ML framework, a specific OCR vendor, OpenAI, a particular model, or training infrastructure. A deterministic/rule-based classifier and a model-informed classifier must satisfy the **same** interface, exactly as `DeterministicGoalEngine` and a future population-informed engine both satisfy `GoalEngine`. **The exact API is NOT being designed or implemented now.**

---

## §15. Future Goal Engine integration (TARGET / FUTURE)

Structured taxonomy should eventually feed the **Goal Engine** through **minimized numeric/enum projections** — never raw encrypted descriptions.

```
Example projections (numeric/enum only):
  monthly_grocery
  monthly_dining
  monthly_transport
  monthly_dairy
  monthly_subscriptions
```

> The Goal Engine MUST NOT need raw encrypted descriptions. Taxonomy → Goal Engine is a **projection**, consistent with the frozen Goal Engine contract (numeric/enum input only) and ADR-008 (INTELLIGENCE = signals-not-raw). This keeps the GoalEngine contract **swappable and privacy-preserving**.

---

## §16. Future Credit-Card / Bank Statement support (TARGET / FUTURE)

Document extraction may eventually support: credit-card statements · bank statements · invoices · receipts. The **same normalized transaction/classification pipeline** (§13) should be reusable.

> Do **NOT** implement statement import in this document. Provider/file-format specifics (statement layouts, parsing, merchant strings) remain **future design work**. Note: SRS v1.0 already scopes **statement import** as **V1 OPTIONAL "if dependencies safe"** — this document does not change that scope or promote it.

---

## §17. Privacy / Security guardrails (must be preserved by any future work)

Any eventual implementation MUST explicitly preserve:

- **E2EE boundaries** (Class-A free-text stays end-to-end encrypted; server never key-holds recoverable data outside the frozen model)
- **AI firewall** (mediated access, projections, fail-closed)
- **data minimization**
- **consent** (per-signal / external-AI consent)
- **ZDR** where external AI is used (zero-data-retention / no-train provider posture)
- **fail-closed** behavior (any check fails → nothing sent/extracted for external processing)
- **no raw / free-text leakage** across the AI boundary
- **no automatic training on private data** (§9)
- **user control over extraction** (§2 — TOTAL-ONLY vs ITEMIZED)
- **user correction before finalization** (§2 / §6 / §8)
- **financial correctness parity** (FIN-002 — §3)
- **authorization / IDOR boundaries** (documents, extracted items, and classifications are owner/participant-scoped exactly like the entities they attach to)

---

## §18. CURRENT / TARGET status labelling

- **CURRENT** — only §1 describes what exists (flat expense `category`, attachments + receipt versioning, opt-in AI proxy, deterministic Goal Engine). Nothing else in this document exists.
- **TARGET / FUTURE** — everything in §2–§16 (document intelligence, OCR, itemization, global dynamic taxonomy, classification learning, statement extraction, population learning). **None implemented.**

> Do **NOT** claim OCR, dynamic taxonomy, global classification learning, or document intelligence currently exists. No repository evidence supports it (§1).

---

## §19. Relationship to the frozen SRS

- **SRS v1.0 remains FROZEN** (FROZEN 2026-08-12).
- **This document does NOT modify the SRS** (or any frozen document).
- These ideas are **parked** for a **future SRS revision** (R2+), which — per the SRS change-control rule (§0 of the SRS) — requires a new dated revision entry; **no silent edits**.
- **No implementation should begin solely because this document exists.**
- **When the current implementation/version is closed, perform a formal impact review** (§20).
- **Only then** decide which requirements (if any) should enter a future SRS revision.

---

## §20. Open questions (unresolved — do NOT resolve here)

Captured, not decided. Each is `[OPEN QUESTION]` unless already frozen elsewhere:

1. OCR / extraction **provider selection** and hosting (external vs future self-hosted) `[ENGINEERING PARAMETER]` `[COUNSEL]`
2. Image / PDF **processing limits** (size, page count, formats)
3. **Document retention** (how long uploaded documents / extracted text are kept)
4. **Extraction cost controls** (per-user quotas, throttling, batching)
5. **Confidence thresholds** for surfacing vs auto-suggesting classifications `[ENGINEERING PARAMETER]`
6. **Reconciliation tolerance** (rounding / tax / discount handling for `sum(items) ≤ total`) `[ENGINEERING PARAMETER]`
7. **Global taxonomy governance** (who approves ACTIVE concepts; audit) `[PRODUCT DECISION REQUIRED]`
8. **Candidate → active thresholds** (§5 lifecycle promotion counts) `[ENGINEERING PARAMETER]`
9. **Taxonomy merge / split rules**
10. **Global vs personal taxonomy boundaries** (§10 promotion criteria)
11. **User-correction propagation** (does a correction stay personal, or feed aggregate evidence, and under what consent)
12. **Training / learning consent** model `[COUNSEL / COMPLIANCE VALIDATION REQUIRED]`
13. **Population-learning legal basis** `[COUNSEL / COMPLIANCE VALIDATION REQUIRED]`
14. **Retention of classification signals**
15. **Differential privacy / federated learning** applicability
16. **Model evaluation** methodology (separate from runtime inference)
17. **Drift detection** for classifier/taxonomy
18. **Classifier versioning** and provenance retention
19. **Rollback / reclassification** strategy (re-classify historical items safely without touching financial fields)
20. **Statement parsing formats** (per-issuer layouts)
21. **Merchant normalization** (raw merchant string → canonical merchant)
22. Whether **itemized detail becomes an expense-item entity** or **document-attached metadata** `[PRODUCT DECISION REQUIRED]` / `[ENGINEERING PARAMETER]`

None of the above is resolved by this document.

---

## §21. Required reconciliation

**Confirmations for this documentation-only change:**

- ✅ **SRS v1.0 was NOT modified** — `FINMATE_SRS.md` untouched; remains FROZEN 2026-08-12.
- ✅ **Frozen Decision Ledger was NOT modified** — `FINMATE_DECISION_LEDGER.md` untouched.
- ✅ **No ADR was modified** — `docs/architecture/adr/*` and `ADR_INDEX.md` untouched.
- ✅ **No API contract was modified** — `FINMATE_API_DATA_CONTRACTS.md`, `API_CONTRACT_INDEX.md`, and `openapi.yaml` untouched.
- ✅ **No code / schema / migration was changed** — no entity, controller, service, DTO, migration, or config touched. No package added.
- ✅ **No implementation started** — no OCR, taxonomy, classification, Goal Engine, statement-import, or migration work performed.
- ✅ **CURRENT vs TARGET distinguished** — §1 is the only CURRENT claim (evidence-backed); §2–§16 are TARGET/FUTURE, none implemented.

**Contradictions found:** **None.** This document is consistent with the frozen stack and asserts nothing that contradicts it. Two intentional **consistency notes** (not contradictions):
- SRS v1.0 already lists **statement import** as **V1 OPTIONAL "if dependencies safe"** — §16 defers to that scope and does not promote it.
- Today's expense **`category` is a single flat field**; §4/§6/§7 describe a *future* hierarchical/multi-dimensional layer **on top of / beside** it, not a change to the current field.

**One-line status:** *Future design / parked pending SRS v1.0 closure — no implementation authorised.*

---

*End of document. This is a parking document. It authorises no code, schema, migration, API, model, training, or SRS change. Any future work requires the §20 formal impact review and, if adopted, a new dated SRS revision (R2+).*

---

## §C0 — Addendum: Approved Custom-Tag / Dynamic-Taxonomy Direction (TAG-BATCH-C0, 2026-08-22)

**Nature:** additive decision record. It does **not** rewrite any section above; it **resolves specific open questions** from §4–§14/§20 into an approved architectural direction for a future custom-tag implementation. It still authorises **no** code, schema, migration, entity, API, DTO, UI, package, model, or training change — **TAG-BATCH-C1 is NOT started.** Frozen documents (SRS v1.0, Decision Ledger, ADRs, API/OpenAPI contracts, Data Classification & Encryption Matrix, Key Management / Security / AI Firewall / IP / Threat Model / Ownership Map / Migration Plan) are **unchanged** by this addendum.

**Basis:** the TAG-BATCH-C read-only product/architecture review (prior session) and the shipped tag stack — TAG-BATCH-A (persist confirmed expense tags, `bde0912`), B (filtering + analytics, `8fe4832`), B1 (visibility + analytics UI, `31fd036`), B2 (dashboard chips + monthly trend, `f316a3d`).

**Frozen-boundary reconciliation (verified, no contradiction):** the direction below reuses the **existing** Data Classification pattern and E2EE/key stack — it introduces **no** new field classification, **no** new cryptographic primitive, and requires **no** change to the frozen Matrix, E2EE architecture, SEC-KI1 group-key/versionId discipline, group-key rotation, recovery/key-wrapping, or FIN-002. Custom-tag **names** map to the same class as `expense.title`/`description` (E2EE, Zone-1a); custom-tag **ids** map to the same class as `expense.category` (plaintext, Zone-2). See §C0.11.

### §C0.1 Custom-tag scope — `[PRODUCT DECISION — APPROVED]`

**TARGET.** Support **both** scopes, kept strictly separate from the global taxonomy:

| Scope | Visibility | Name storage |
|---|---|---|
| **GLOBAL_CANONICAL** | all users | server-readable (Zone-2), code-curated |
| **PERSONAL** (`ownerUserId`) | owner only | **E2EE** (Zone-1a) |
| **GROUP** (`groupId`) | members of that group only | **E2EE** (Zone-1a) |

A group tag MUST NOT resolve for another group; a personal tag MUST NOT resolve for another user (query-enforced exactly like expenses). Users MUST NOT directly create or promote a **global** tag.

### §C0.2 Custom-tag name privacy — `[PRODUCT DECISION — APPROVED]` / `[COUNSEL-aligned]`

**TARGET.** Custom-tag **names are E2EE**. The server MAY store: opaque `customTagId`, `scopeType`, `ownerUserId` (personal), `groupId` (group), lifecycle metadata, and **encrypted name/key material per the existing E2EE architecture**. The server MUST NOT decrypt custom-tag names and MUST NOT require plaintext names for server-side search/classification. Server-side **assignment, filtering, authorization, and analytics operate on the opaque id only.** No new encryption primitive — C1 will reuse the established client-side E2EE + key-wrapping stack (personal → master key; group → per-group AES-256-GCM key; recovery via existing RSA-wrapping). **Duplicate detection is client-side** (the owner holds decrypted names locally); no server-side normalization of E2EE names (a deterministic server hash would leak equality — rejected).

### §C0.3 Sensitive tags — `[COUNSEL]` (unchanged gate)

**CURRENT + TARGET.** The global canonical taxonomy continues to **exclude** sensitive categories (medical/pharmacy/health/religion/financial-hardship, etc.) unless explicitly approved through the required COUNSEL process. User-created private/group custom tags MAY contain arbitrary user intent, but their names remain **E2EE and private** and MUST NOT become global taxonomy automatically. **No automatic sensitive-tag promotion. No population learning from sensitive custom tags.**

### §C0.4 Classification boundary — `[TARGET]`

**CURRENT (unchanged):** DOC-0 `ClassificationEngine` → global canonical candidates → user review/confirmation (server input stays minimized: `itemLabel`/coarse `category`, never E2EE free-text). **TARGET (future, not implemented):** custom-tag suggestions MAY run **client-side** (the client can decrypt its own + its group's custom-tag names and the local expense/document text). The **server MUST NOT receive plaintext custom-tag names** merely to classify. The replaceable ClassificationEngine boundary is preserved.

### §C0.5 Global taxonomy governance — `[PRODUCT DECISION — APPROVED]` + `[COUNSEL]`

**TARGET.** The canonical taxonomy stays **code-curated**. Users may eventually **request** a new global tag but MUST NOT directly create / modify / rename / merge global tags or promote personal/group tags globally. Future global promotion path: **request/candidate → evidence/aggregate review → product/admin review → optional COUNSEL review → curated taxonomy update.** Population learning and ML remain **FUTURE / PARKED**.

### §C0.6 Taxonomy lifecycle — `[TARGET]` (preserve existing states)

Preserve `candidate → reviewed → active → deprecated`. Only **active** canonical tags may be suggested or offered for filtering. **Deprecated tags MUST NOT silently disappear from historical assignments** (assignments keep their id; the id resolves as deprecated). Lifecycle persistence is not implemented in C0.

### §C0.7 Tag namespace — `[PRODUCT DECISION — APPROVED]`

**TARGET.** Retain **ONE unified `tagIds` namespace.** Canonical ids stay stable slugs (`grocery`); future custom ids are **UUIDs**; the resolver distinguishes them internally (slug → canonical, else UUID → scoped custom). **Do NOT** introduce `canonicalTagIds` / `customTagIds` or a second filter state. Existing semantics stand: **OR within the tag dimension, AND across other filter dimensions.**

### §C0.8 Assignment model — `[TARGET]`

```
GLOBAL / PERSONAL / GROUP tag definitions
                 ↓
          one assignment layer
                 ↓
            expense_tags   (existing join table — UNCHANGED in C0)
                 ↓
     filter / analytics / trend / export   (resolver scopes each id)
```

`expense_tags` remains the assignment/join layer. It is **not modified in C0**. (A future `tagScope` discriminator column + a scoped `custom_tag` definition table are C1 territory — additive, not done here.)

### §C0.9 Learning policy — `[TARGET]` / `[COUNSEL]` / `[PARKED]`

| Mechanism | Direction |
|---|---|
| A. deterministic alias mapping | **allowed / curated** |
| B. personal user-correction memory | **potentially allowed, owner-scoped** |
| C. aggregate cross-user statistics | **`[COUNSEL]` / privacy decision required** |
| D. global taxonomy promotion | **product/admin governance + `[COUNSEL]` where applicable** |
| E. population learning | **PARKED** |
| F. ML / model training | **PARKED** |

**No cross-user learning implementation is authorised.**

### §C0.10 Security reconciliation — `[APPROVED / documented]`

- Personal custom-tag names: **E2EE.** · Group custom-tag names: **E2EE.** · Global canonical names: **Zone-2 / server-readable** (unchanged).
- Server uses **opaque ids** for custom tags (assignment, filter, auth, analytics). **No server-side decryption. No plaintext custom-tag search.**
- **No cross-user / cross-group leakage** (scope query-enforced like expenses). **No global taxonomy poisoning** (canonical stays code-curated; users only request). **No automatic sensitive-tag promotion.**
- **No new cryptography** — reuse the existing established E2EE / key-wrapping architecture at C1 time.

### §C0.11 Recommended staged sequence (unchanged from review; nothing here authorises a batch)

`C0 (this addendum — decisions)` → **`C1` custom-tag data model** (additive `custom_tag` table with E2EE name + scope; `tagScope` column on `expense_tags`; migration additive/reversible) → **`C2`** personal-then-group custom-tag CRUD (IDOR-scoped) → **`C3`** assignment/filter/analytics integration (unified `tagIds` resolver) → **`C4`** client-side classifier suggestion of custom tags → **`C5`** governance (request/candidate/promotion — gated on `[COUNSEL]`). **C1 requires a separate explicit authorisation and must not begin until the C0.2 E2EE-name decision is treated as fixed (it determines the schema).**

**Status of this addendum:** *Approved architectural direction for future custom-tag work. Authorises no implementation. TAG-BATCH-C1 not started.*
