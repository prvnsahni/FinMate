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

---

## §C1 — Implementation note: custom-tag data model (TAG-BATCH-C1, 2026-08-22)

**Nature:** additive implementation record. It does **not** rewrite §C0. **DATA-MODEL ONLY** — no CRUD, API, UI, filter, analytics, export, classifier, or governance was implemented (those remain C2–C5). No frozen document changed; no finance column, group-key/versionId architecture, or E2EE boundary changed.

**Entity/table added — `custom_tags`** (`shared/data-models/src/lib/custom-tag.entity.ts`): the custom-tag DEFINITION layer, personal + group scope. Fields: `id (uuid)`, `scopeType ('personal'|'group')`, `ownerUser?` (personal, `ON DELETE CASCADE`; null for group), `group?` (group, `ON DELETE CASCADE`; null for personal), `createdByUser?` (creator provenance, `ON DELETE SET NULL`), `groupKeyVersion?` (group E2EE key-version, `ON DELETE SET NULL`), `encryptedName (text)`, `status ('active'|'deprecated')`, `version (@VersionColumn)`, `createdAt/updatedAt/deletedAt` (soft-delete). Modelled on the existing `note`/`expense` E2EE entities.

**Encryption representation:** `encrypted_name` stores ONLY the client-produced `iv:ciphertext` (same format as `expense.title`/`note.title`) — **no new crypto primitive**; the existing client-side E2EE + key-wrapping stack is reused at write time (personal → master key; group → per-group AES key + `groupKeyVersion`). The server **never decrypts** it (plain `text` column, **no `ValueTransformer`**). There is **NO** `name`/`plaintextName`/`normalizedKey`/`nameHash`/`nameSearch` companion — de-duplication stays **client-side** per §C0.2.

**`expense_tags` change (assignment layer, unchanged otherwise):** ONE additive column `tag_scope VARCHAR(20) NOT NULL DEFAULT 'global'`. Existing canonical assignments are correctly `'global'` with **no backfill**; canonical filtering/semantics and the existing `unique(expense_id, tag_id)` + `tag_id` index are **unchanged**. Per the §C0.7 unified namespace, `tag_id` holds a canonical slug when `tag_scope='global'` or a `custom_tags.id` UUID when `'personal'`/`'group'` — **no `customTagId` column and no second assignment/filter table.**

**Constraints / indexes:** DB `CHECK chk_custom_tags_scope` enforces the scope invariant (personal ⇒ owner set/group null; group ⇒ group set/owner null). Indexes: `idx_custom_tags_owner (owner_user_id)`, `idx_custom_tags_group (group_id)`, `idx_custom_tags_scope_status (scope_type, status)` — sized for the future C2/C3 "list a user's/group's active tags" access. No new `expense_tags` index (the existing `tag_id` index already serves custom filtering).

**Migration:** `backend/src/migrations/1720200000000-AddCustomTags.ts` — additive + reversible; `up()` creates `custom_tags` + adds `expense_tags.tag_scope`; `down()` drops the column then the table. No `INSERT`/`UPDATE`/backfill, no financial column, no E2EE data transformed. Registered in `migrations/index.ts`, `ormconfig.ts`, and `expenses.module` (`forFeature`, entity registration only — no service). **Not executed against any live DB in this batch** (runs on boot via `migrationsRun`).

**Intentionally NOT implemented (C2+):** custom-tag create/list/rename/delete/merge APIs, assignment of custom tags, filters, analytics, export, classifier suggestions, OCR integration, taxonomy governance/promotion, and any UI.

**Security reconciliation (verified, no STOP):** no server-side decryption; no plaintext custom-tag names; no keys/tokens stored (only a key-*version* reference); scope CHECK prevents cross-scope combos; no global taxonomy write path (canonical stays code-curated); no finance mutation (golden gate GREEN); no SEC-KI1/group-key rotation change; existing canonical `expense_tags` coexist safely.

**Verification:** data-models 4 suites/26; backend 77 suites/803 (finance golden gate GREEN); backend + frontend builds clean; lint 0 errors.

---

## §C2 — Implementation note: custom-tag management API + authorization (TAG-BATCH-C2, 2026-08-22)

**Nature:** additive implementation record. It does **not** rewrite §C0/§C1. **CRUD + AUTHORIZATION ONLY** — no filtering/analytics/export (C3), no classifier suggestion (C4), no governance/promotion (C5), no UI. No frozen document changed; no new migration (reuses the C1 `custom_tags` table); no finance column, group-key/versionId architecture, or E2EE boundary changed. No new crypto primitive.

**New module — `backend/src/app/custom-tags/`** (`CustomTagsModule`, registered in `app.module`; `TypeOrmModule.forFeature([CustomTag, GroupMember, GroupKeyVersion])`, one `CustomTagsService`). The global canonical taxonomy stays in the read-only `TaxonomyModule` and is untouched.

**Final API surface** (all `@UseGuards(JwtAuthGuard)`; responses use the shared `SuccessResponse`):

| Method & route | Scope | Authorization |
| --- | --- | --- |
| `POST /custom-tags` | personal | owner = authenticated user (route/JWT-derived) |
| `GET /custom-tags` | personal | own active tags only |
| `POST /groups/:groupId/custom-tags` | group | ACTIVE group membership |
| `GET /groups/:groupId/custom-tags` | group | ACTIVE group membership |
| `PATCH /custom-tags/:id` | both (by id) | owner (personal) / member (group) |
| `DELETE /custom-tags/:id` | both (by id) | owner (personal) / member (group) — **safe deprecation** |

Rationale for the by-id update/deprecate routes handling both scopes: a single scoped-by-id endpoint safely authorizes either scope (no duplicate group/personal update routes), matching the existing "load then authorize" pattern.

**Authorization model.** Scope and ownership are **server-derived** — `scopeType`/`groupId`/`ownerUserId` are NEVER read from the request body, so a caller cannot inject a foreign scope/owner (the `whitelist` ValidationPipe also strips unknown fields). Group access reuses the established `GroupMember … joinStatus='active'` check (→ `ForbiddenException` for a non-member on the group-scoped `:groupId` routes, matching `GroupsService.listMembers`). The **by-id** `PATCH`/`DELETE` paths return **`NotFoundException`** on any authorization failure (non-owner personal, non-member group) — the repository's owner-scoped IDOR/existence-disclosure convention: an attacker enumerating ids cannot distinguish "not found" from "not yours".

**E2EE boundary (unchanged from §C0.2/§C1).** The service handles the tag name ONLY as the opaque client `encryptedName` (`iv:ciphertext`, validated structurally by the existing `IsCiphertext` decorator — no plaintext accepted). It **never** decrypts, normalizes, hashes, searches, or logs the name; there is no decrypt/unwrap method on the service. Responses are mapped to a server-safe projection (`id/scopeType/encryptedName/status/version/groupId/groupKeyVersionId/timestamps`) that deliberately **excludes** the related `ownerUser`/`createdByUser`/`group` account entities. De-duplication remains client-side.

**Group-key version discipline (reused, not reinvented).** Create/rename of a group tag resolves the key version exactly like the expense/recurring flow (`CustomTagsService.resolveGroupKeyVersion`): a declared `groupKeyVersionId` must belong to the group and not be `REVOKED` (else `VAL_INVALID_INPUT`); otherwise the group's current `ACTIVE` version is stamped. No auto-provisioning of a missing version (that stays group-key-management territory) and no re-encryption flow was invented — a rename across a rotation simply re-stamps the client-supplied version.

**Optimistic locking.** `PATCH` (rename) requires the caller's last-seen `version` and returns the existing `PreconditionFailedException { errorCode: 'CON_VERSION_CONFLICT' }` on a stale value — identical to `GroupsService.updateGroup`. No new error format.

**Lifecycle / deprecation.** `DELETE` performs a **safe deprecation** (`status → 'deprecated'`), never a hard delete: the tag disappears from the active `GET` lists (both list queries filter `status='active'`) while historical `expense_tags` assignments stay intact and resolvable. The service holds no expense/`expense_tags` repository, so it cannot rewrite or remove any financial record; deprecation is idempotent.

**Global-taxonomy protection.** C2 adds **no** path to create/rename/delete a global canonical tag or to promote a custom tag into the canonical set — the service exposes no such method and the endpoints only ever read/write `custom_tags`. Canonical taxonomy stays code-curated behind read-only `GET /taxonomy`.

**Intentionally deferred (unchanged):** custom-tag **assignment** to expenses, filtering, analytics, export columns, assignment UX (C3); classifier/OCR suggestion, population learning (C4); governance/request/promotion and any management UI (C5).

**Security reconciliation (verified, no STOP condition hit):** no server-side decryption/plaintext search; no key material stored (only a key-*version* reference); scope is route-derived (no scope injection); IDOR closed on personal + group by-id paths; non-member and cross-group access denied; malformed/missing ciphertext rejected at the DTO boundary; stale entity/key versions rejected via the existing conventions; no finance mutation; no group-key rotation / SEC-KI1 change; no new migration.

**Verification:** targeted `custom-tags` suite green (authz/E2EE/lifecycle/scope/finance-structural/adversarial); backend build + lint clean; FIN-002 finance-golden gate GREEN; working tree contains only the intended C2 files.

---

## §C3 — Implementation note: custom tags integrated with expenses (TAG-BATCH-C3, 2026-08-22)

**Nature:** additive implementation record. It does **not** rewrite §C0/§C1/§C2. **INTEGRATION ONLY** — custom tags now flow through the EXISTING expense-tag pipeline (assignment → response → filter → analytics → export → UI). No classifier (C4), governance/promotion (C5), no new taxonomy system, no new finance calculation. No new migration (reuses the C1 `custom_tags` table + `expense_tags.tag_scope`), no new crypto primitive, no group-key/SEC-KI1 change, no frozen-doc change. One unified `tagIds` namespace throughout — no `canonicalTagIds`/`customTagIds` split in filter state.

**Assignment (create only).** `ExpensesService.persistConfirmedExpenseTags` now writes custom-tag assignments alongside the canonical ones into the SAME `expense_tags` table (no second join table). Canonical ids keep the TAG-BATCH-A materializer (ancestors, drop-deprecated); every id the active canonical taxonomy does not claim is treated as a candidate custom id and authorized SERVER-SIDE (`resolveAssignableCustomTags`, the client-supplied scope is never trusted): a **personal** custom tag must be owned by the creator AND the expense personal (no group); a **group** custom tag must belong to the expense's own group. Invalid / deprecated / inaccessible / cross-scope ids are silently dropped (never an error, never another owner's/group's tag), exactly like an unknown canonical id. Custom rows store `tag_scope='personal'|'group'` and `taxonomy_version=0` (non-canonical sentinel). **Update leaves `expense_tags` untouched** (unchanged TAG-BATCH-A contract) — an ordinary edit never reclassifies or drops canonical or custom assignments; there is no tag-replacement path in C3.

**Expense response.** The list + detail tag projection now carries `tagScope` next to `tagId/authority/source` (still ids + scope + provenance only — **never** a plaintext/E2EE name). `tagScope` tells the client how to resolve the display name: `global` → `GET /taxonomy`; `personal`/`group` → the encrypted custom-tag payload (`GET /custom-tags` / `GET /groups/:id/custom-tags`), decrypted client-side.

**Filtering (`GET /expenses?tagIds=`, group trash, analytics, export).** The unified `tagIds` param now matches custom ids too, in the SAME correlated `EXISTS` over `expense_tags` (OR-within-tags, AND-across-dimensions preserved; no second query param). Custom ids are authorized server-side first (`resolveAccessibleCustomTagIds` — personal owned by caller; group belongs to a group the caller is an ACTIVE member of, and, for a group-scoped query, that group; `active` only). Unauthorized / unknown / deprecated ids are dropped (canonical fail-safe). The outer query scope (owner / group membership) still bounds every match, so a custom id can never surface another user's/group's rows even if it leaked. Export stays group-scoped and only that group's active group custom tags qualify; the export adds **no tag column** and never emits a plaintext name.

**Analytics (`/expenses/analytics/tags` + `/tags-trend`).** Custom tags flow through with ZERO server-side name work: the aggregation already groups by the opaque `tag.tagId` over the same scoped, dimension-filtered set, so a custom UUID appears with its amount and the client resolves the name locally. No plaintext name is ever decrypted server-side; the existing overlap semantics ("spending by tag", not an exclusive breakdown) are unchanged.

**Frontend.** New `CustomTagService` (`core/services/custom-tag.service.ts`) fetches the C2 custom-tag lists and decrypts each `encryptedName` **client-side**, reusing the SAME crypto as the expense-title path (`CryptoSessionManager` for the personal master key / per-group key + version, `ClientEncryptionService.decrypt`) — **no new crypto primitive**. Decrypted names are cached in memory only (never localStorage/sessionStorage), never sent back to the API, never placed in a URL, never logged; a name that cannot be decrypted (key not ready / no access) stays opaque (the tag is left out of the facet) rather than shown as a fabricated label. `group-detail` merges this group's custom tags into the SAME unified tag facet (`tagLabelById` + `tagPillOptions`) as the canonical taxonomy, so the filter selector, row chips and "spending by tag" analytics all resolve custom names through the one existing mechanism and feed the one `tagIds` filter. Best-effort: any failure leaves the canonical-only facet intact and the ledger/infinite-scroll behaviour unchanged.

**Privacy boundary (verified, no STOP condition hit).** No server-side decryption of custom-tag names anywhere (assignment, response, filter, analytics, export); no plaintext custom-tag search/analytics/export; no plaintext name in any expense response; no new crypto; no second assignment table; canonical taxonomy semantics and code-curation unchanged; no finance mutation; no E2EE/group-key/SEC-KI1 change.

**Performance.** List tags load in the existing single bulk `expense_tags` query (no N+1). Custom-tag filter authorization is one `custom_tags` lookup (+ at most one membership lookup) per request, not per row/expense. Analytics stays one query for distribution and one for the whole trend range. The frontend resolves each distinct group-key version once per page and caches decrypted names, so a name is decrypted at most once.

**Intentionally deferred (unchanged):** classifier/OCR suggestion of custom tags + population learning (C4); governance / request / global promotion and any tag-management UI redesign or bulk operations (C5). Export tag *columns* remain deferred (filtering only). Personal-ledger/dashboard custom-tag *name* display beyond the group-detail facet is not wired in C3 (the reusable `CustomTagService.getPersonalCustomTags` exists for a later surface); those surfaces show canonical names as before and opaque ids for personal customs, per the "leave it opaque rather than add a new path" rule.

**Verification:** backend 78 suites / 851 (was 831 — +20 C3 tests: assignment authz, filter IDOR, response `tagScope`, analytics opaque-id, util custom matching); frontend 72 suites / 622 (incl. new `CustomTagService` spec); backend + frontend builds clean; backend + frontend lint 0 errors; FIN-002 finance-golden gate GREEN; no new migration; no package change.

---

## §C4 — Implementation note: client-side custom-tag suggestions + correction memory (TAG-BATCH-C4, 2026-08-22)

**Nature:** additive implementation record. It does **not** rewrite §C0–§C3. **CLIENT-ONLY, FRONTEND-ONLY** — no backend file, endpoint, DB table, or migration; no package change; no finance change; no E2EE/group-key/SEC-KI1 change; no frozen-doc change. No ML, no embeddings/vectors, no LLM/cloud AI, no external network call, no population/cross-user learning, no global-taxonomy mutation. Canonical DOC-5 classification (`classifyLabel`) is unchanged and remains the authoritative first layer.

**Client-only classifier (pure engine).** `frontend/.../documents/services/custom-tag-suggestion.ts` exports the pure `suggestCustomTags(label, authorizedTags, rememberedTagIds)`. Same input ⇒ same output; no I/O, no crypto, no persistence, no logging, no deps beyond `normalizeTagKey`. It only ranks tags the caller **already authorized and decrypted** (input, never fetched here). Deterministic, explainable signals, highest-wins-per-tag: (1) **correction memory** — a remembered id still in the authorized set (`confidence 0.95`, "Matched a previous correction"); (2) **exact normalized name match** (`0.8`, "Matched tag name"); (3) **keyword match** — every word of the tag name present in the label (`0.6`, "Matched label keywords"). No semantic/vector/LLM inference. Output is INFERRED advisory metadata; `confidence` is match certainty, never financial correctness.

**Correction memory (device-local, session-only).** `frontend/.../core/services/custom-tag-correction-memory.service.ts` is an in-memory `Map` only — **nothing written to localStorage / sessionStorage / IndexedDB / URL / query params**, so no decrypted custom-tag NAME is ever persisted (only opaque tag ids + normalized labels are held). **Storage decision:** session-scoped memory was chosen deliberately (C4 STEP 5 allows it); persistent correction memory would need a new encrypted-storage mechanism, which is a STOP condition — not built. Keys are `userId :: (personal | g:<groupId>) :: normalizedLabel`, so memory is **scope-isolated**: one user's/group's corrections can never influence another's, and a user's group memory is separate from their personal memory. `clear()` wipes it (e.g. logout). Never sent to the backend, never logged.

**Orchestration.** `frontend/.../documents/services/custom-tag-suggestion.service.ts` ties the C3 `CustomTagService` (authorized fetch + client decrypt + cache — reused, **no new crypto**), the correction memory, and the pure engine. `loadAuthorizedTags(scope)` loads **only** the scoped tags (personal → the user's; group → that one group's), dropping any whose name did not decrypt. `suggest(...)` is pure delegation (no I/O). The current user id comes from `AuthState`.

**Scope isolation.** Suggestions only ever use tags the current user is authorized to see; a group tag from Group A can never influence Group B (different `getGroupCustomTags` call + different memory key), and personal names never enter another user's context. Unknown/deprecated ids remembered from before are dropped (they are no longer in the authorized set).

**UI integration (DOC-4, personal receipt review).** `DocumentReviewService.mergeCustomSuggestions(model, suggestFor)` is a **pure** merge that adds custom suggestions onto each line item as advisory **INFERRED**, **custom** chips **alongside** (never replacing) the canonical tags; it de-dupes by id (idempotent) and never touches any finance field. `DocumentReviewComponent` loads the user's authorized personal custom tags best-effort once per extraction (failure / no scope / no tags → canonical-only review intact, no clobbering of user edits) and, on **explicit confirm**, records each kept custom tag against its item label in device-local memory. Suggested custom chips are visually distinct (amber, dashed, ✨ + `reason` tooltip) from canonical and from confirmed tags. Nothing is auto-assigned: a chip stays INFERRED until the user confirms the draft.

**Authority / provenance (unchanged semantics).** Suggested custom tag = **INFERRED**; kept-and-confirmed = **USER_CONFIRMED** (existing `confirm()` upgrade path); a manual user correction = **USER_CORRECTED**. Classification confidence is never treated as financial correctness. The confirmed draft carries `{tagId, authority, source}` and, because the custom `tagId` is a `custom_tags.id`, the existing **C3** server-side assignment authorization re-validates scope on create — a suggestion is only ever a hint.

**Sensitive-tag safety.** The engine never invents canonical or sensitive tags — it only ranks the user's OWN authorized custom tags; canonical classification (which already excludes medical/pharmacy/health/religion/hardship by omission) is untouched, and C4 adds **no** automatic rule for any sensitive category and does not expand the sensitive taxonomy. No automatic promotion of anything.

**Performance.** Reuses the C3 `CustomTagService` in-memory decrypted-name cache (a name is decrypted at most once); authorized tags load once per extraction, not per expense/per tag; the engine is a bounded in-memory scan. No API request is made just to suggest.

**Intentionally deferred (unchanged):** ML/embeddings/vector/LLM/cloud classification, population/cross-user learning, global-taxonomy promotion, governance workflow, custom-tag management CRUD/UI redesign, new backend endpoints/tables/migrations, server-side custom-tag name processing, export tag columns, statement classification, and any **persistent** correction memory (would require a new encrypted-storage mechanism — a STOP condition). Group-scoped suggestion in the 700+ line finance modal is not wired (the modal is off-limits); the orchestrator already supports a group scope for a future safe surface.

**Verification:** frontend 75 suites / 654 (was 72 / 622 — +3 suites, +32 C4 tests: pure-engine determinism/no-network/signals/scope/sensitive, correction-memory isolation + no-persistent-storage, orchestrator scope + no-auto-network, `mergeCustomSuggestions` + no-auto-assign + finance-untouched, component merge/record-on-confirm/canonical-only-when-signed-out); frontend build + lint clean (0 errors); backend untouched — 78 suites / 851 still green, **FIN-002 finance-golden gate GREEN**; no migration, no package change, no backend plaintext processing, no external network call.

---

## §C5a — Implementation note: custom-tag management UI (TAG-BATCH-C5a, 2026-08-22)

**Nature:** additive implementation record. It does **not** rewrite §C0–§C4. **FRONTEND-ONLY, UI over the existing C2 API + C3 crypto** — no backend file, no new endpoint, no schema/migration, no package change; no finance change; no E2EE/group-key/SEC-KI1 change; no frozen-doc change. Implements **only** the C5-a slice from the read-only C5 assessment (management UI). Explicitly NOT included: restore, hard delete, merge, aliases, ordering/pinning persistence, role governance (C5-c), canonical-tag requests (C5-d), persistent learning, population/ML, global promotion.

**Reused C2 operations (no new endpoints):** `POST/GET /custom-tags` (personal), `POST/GET /groups/:groupId/custom-tags` (group), `PATCH /custom-tags/:id` (rename, optimistic-locked), `DELETE /custom-tags/:id` (deprecate). Group access stays **server-enforced** (active membership); the C2 "any active member can rename/deprecate" policy is **preserved unchanged** (role gating is C5-c).

**Service (`core/services/custom-tag.service.ts`, extended):** added `ManagedCustomTag` (safe metadata + client-decrypted `name` + `version`), `getManagedPersonalTags` / `getManagedGroupTags` (list with version), and the write methods `createPersonalTag` / `createGroupTag` / `renameTag` / `deprecateTag`. **Names are encrypted CLIENT-SIDE before every write** — `personalKey()` uses the master key (`CryptoSessionManager.ensureCryptoContext`); `groupWriteKey()` reuses the same write-path resolver as a group expense title (`ensureGroupKey(groupId, 'write')` → current `{key, versionId}`). Create/rename send only `encryptedName` (+ `groupKeyVersionId` + optimistic `version`); the server never receives plaintext. Reuses the existing in-memory decrypted-name cache (updated on create/rename, cleared on deprecate) — **no new crypto primitive**, no persistent storage. Reads that feed the facet still degrade to `[]`; management reads/writes surface errors (incl. `412 CON_VERSION_CONFLICT`) for the UI.

**Reusable component (`shared/components/custom-tag-management/`):** ONE scope-parameterized widget (`scope: 'personal' | 'group'` + `groupId`) — no personal/group duplication. Create (validated, ≤100 chars), inline rename (encrypt-new-name + optimistic version; a 412 shows a "changed elsewhere" notice and refreshes), two-step deprecate confirmation (copy explains historical expenses are preserved; on success the row drops from the active list). Shows only `active` tags. A tag whose name cannot be decrypted renders a non-sensitive **"Encrypted tag"** placeholder (never fabricated, never logged); actions still work (rename replaces the payload). Honest loading / empty / error / network states; all error messages are name-free.

**Navigation (reused existing surfaces — no second settings architecture):** personal tags live in the **Dashboard → Settings tab** (below `app-dashboard-settings`); group tags live in the **Group detail → Settings tab** (below the Group Settings form). Both are existing tab surfaces; no routes/guards/layout were added or changed.

**Canonical vs custom:** the screen manages **custom tags only**; it exposes no path to edit canonical names/aliases/lifecycle/ids (those stay code-curated, `GET /taxonomy` read-only). Copy labels the surface as personal/group custom tags.

**Privacy/security (verified):** no server-side plaintext custom-tag name; no plaintext name in any request body/URL/log; personal isolation (own tags only) and group isolation (server membership) preserved; IDOR unchanged (C2 by-id → 404); optimistic locking surfaced; historical `expense_tags` untouched (deprecate is non-destructive); C3 unified `tagIds` filter/analytics behaviour unchanged; no finance field touched. Names never persisted to localStorage/sessionStorage/IndexedDB/URL — in-memory only.

**Verification:** frontend 76 suites / 674 (was 75 / 654 — +1 suite, +20 C5-a tests: encrypt-before-send + no-plaintext-in-body, personal/group scope + groupId, rename version + 412 surface, deprecate DELETE + no-body, decrypt fail-safe, no-storage; component load/scope/create/rename/deprecate/conflict/empty/error/no-storage); frontend build + lint clean (0 errors); backend untouched — 78 suites / 851 still green, **FIN-002 finance-golden gate GREEN**; no migration, no package change.

---

## §C5b — Implementation note: custom-tag lifecycle completion (restore + rename guard) (TAG-BATCH-C5b, 2026-08-22)

**Nature:** additive implementation record. It does **not** rewrite §C0–§C5a. **Additive over the existing schema** — no migration, no schema change, no package change; no new crypto; no server-side decryption; no finance change; no E2EE/group-key/SEC-KI1 change; no Data Classification Matrix change; no frozen-doc change. Implements **only** the C5-b slice (lifecycle completion). Group-role governance (C5-c) and canonical-tag requests (C5-d) remain out of scope; hard delete / merge / aliases / ordering persistence / persistent learning / population/ML / global promotion remain PARKED.

**Restore (`deprecated → active`).** New additive endpoint `POST /custom-tags/:id/restore` (by-id, both scopes — a dedicated endpoint because the existing rename `PATCH` requires an `encryptedName` this operation must not send). Body is `RestoreCustomTagDto { version }` only. `CustomTagsService.restore` reuses the exact C2 authorization (personal → owner; group → active member; IDOR → **404**), is optimistic-locked via `version` (stale → the existing `PreconditionFailedException { CON_VERSION_CONFLICT }`), and touches **only** `status`: the opaque `encryptedName`, the `groupKeyVersion`, and every historical `expense_tags` assignment are left exactly as they were — the server never decrypts the name. Idempotent: restoring an already-active tag is a no-op that returns it (no save, no version bump).

**Deprecated-rename guard.** `CustomTagsService.rename` now rejects a `deprecated` tag with `ConflictException { errorCode: 'CUSTOM_TAG_DEPRECATED' }` — the caller must restore it first, then rename. This resolves the C5-assessment finding (deprecated tags were previously renamable). An **active** tag renames exactly as before (client-side E2EE, optimistic `version`, `CON_VERSION_CONFLICT` unchanged). **Product policy for this batch:** "restore before rename" (no silent policy pick — the repo had no contrary convention).

**Deprecated listing.** `GET /custom-tags` and `GET /groups/:groupId/custom-tags` accept an additive optional `?status=deprecated` (default `active` — backward compatible; existing callers and the C3 filter facet are unchanged). Group listing still requires active membership. This powers the restore view; it never returns another scope's tags.

**Frontend.** `CustomTagService` gained `restoreTag(tag)` (`POST …/restore` with only the optimistic `version`; the name — already decrypted for the deprecated view — is carried over, so **no re-encryption or key access** happens on restore) and a `status` argument on `getManagedPersonalTags`/`getManagedGroupTags` (appends `?status=deprecated`). The C5-a management widget gained an **Active | Deprecated** toggle: Active keeps create/rename/deprecate; **Deprecated** lists deprecated tags with a **Restore** action only — **no rename** (matching the server guard) and **no destructive delete**. Deprecated names show decrypted where available, else the safe "Encrypted tag" placeholder. Restore success drops the row from the deprecated list (with a "find it under Active" notice); a `412` shows a "changed elsewhere" notice and refreshes. Best-effort, name-free error messages, in-memory only (no localStorage/sessionStorage/URL).

**Security/privacy (verified):** IDOR unchanged (by-id → 404); personal isolation (owner) and group isolation (membership) preserved — restore cannot activate another user's/group's tag; `encryptedName` never becomes plaintext server-side; no names logged; **no `expense_tags` row is read, added, or removed** by restore/guard; canonical taxonomy remains code-curated and unreachable through this API; hard delete remains unavailable (no delete/remove path); no finance field touched; optimistic locking correct on rename + restore.

**API note:** custom-tag endpoints remain internal (never added to the frozen `openapi.yaml` since C2); the additive restore route + `status` query are documented here rather than in OpenAPI — no frozen contract changed.

**Verification:** backend 78 suites / 864 (was 851 — +13 C5-b tests: restore personal/group, unauthorized/non-member → 404, stale-version conflict, id/encryptedName/groupKeyVersion preserved, idempotent no-op, deprecated-rename → Conflict, active-rename still works, deprecated list filters + active default, no hard-delete path); frontend 76 suites / 682 (was 674 — +8 C5-b tests: deprecated `?status` personal/group, restore posts version-only + no encrypt, restore 412; component deprecated-view load, restore drops row, restore 412 refresh); backend + frontend builds clean; backend + frontend lint 0 errors; **FIN-002 finance-golden gate GREEN**; no migration, no package change.

---

## §C5c — Implementation note: group custom-tag authority (owner/admin governance) (TAG-BATCH-C5c, 2026-08-22)

**Nature:** additive implementation record. It does **not** rewrite §C0–§C5b. **Additive authorization change only** — no migration, no schema/package change, no new crypto, no server-side decryption, no finance change, no E2EE/group-key/SEC-KI1 change, no Data Classification Matrix change, no new role/guard/permission system, no frozen-doc change. Reuses the existing `owner`/`admin`/`member` roles and the repo's established inline role-check convention.

**Assessment (grounded):** the repository gates **every group-shared-state mutation** to owner/admin via inline `role !== 'owner' && role !== 'admin'` service checks — edit settings, invite/remove members, change roles, regenerate/create invite links, provision/rotate keys, inspect missing keys, update contributions (archive/delete = owner-only) — while any active member creates personal financial **content** (expenses). `GroupRolesGuard` reads the group id from `params.id`/`params.groupId`/`body.groupId`, so it works for the group **create** route but **cannot** serve the by-id `/custom-tags/:id` routes (there `params.id` is the tag id, and the group is only known after the tag is loaded) — hence role enforcement is done inline in the service, matching the dominant convention.

**Authority model chosen — Option B (owner/admin governance).** A group custom tag is **shared group vocabulary**, so its **governance** — `create`, `rename`, `deprecate`, `restore` — is owner/admin, exactly like all other group-shared-state mutation. **CREATE is included** (not left member-open): creating a shared tag definition adds to the group's vocabulary set, which the repo treats as owner/admin config creation, not member content — so uniform owner/admin is the convention-consistent choice and needs no product approval. **USAGE is untouched:** any active member still **sees, assigns, filters (C3), and gets suggestions (C4)** for group tags; `listGroup` remains any-active-member. **Personal tags are unaffected** (owner-only).

**Backend:** new `assertGroupGovernance(membership)` helper throws `ForbiddenException { RES_FORBIDDEN, 'Only group owners and admins can manage group tags' }` when the member's role is not owner/admin. `createGroup` calls it after `assertActiveMembership`. `loadAuthorizedTag` now returns `{ tag, membership }` (the membership it already fetched for the IDOR check — no extra query), and `rename`/`deprecate`/`restore` call the gate for group-scoped tags. **IDOR preserved:** a non-member is still 404'd by `loadAuthorizedTag`/`assertActiveMembership` **before** the role gate, so the role check only ever runs for a real member — a member who lacks the role gets **403** (they may SEE the tag, just not govern it: no existence disclosure), a non-member gets **404** (unchanged). No route/DTO/controller change; optimistic locking, E2EE opacity, and historical `expense_tags` are all untouched.

**Frontend:** the C5-a/b management widget gained a `canManage` input (default `true` → personal stays fully manageable). `group-detail` passes `[canManage]="isOwnerOrAdmin()"` (its existing role signal). For a non-managing member the widget shows the active list **read-only** with a note ("Only group owners and admins can manage these tags. You can still use and filter by them…") and hides create, rename, remove, the Active|Deprecated toggle, and restore; the mutating methods also early-return on `!canManage` (defense-in-depth — the server is the authority). Managers keep the full C5-a/b experience. C3 tag-filter and C4 suggestion behaviour are unchanged.

**Security (verified):** authorization enforced **server-side** (frontend hiding is UX only); IDOR unchanged (member → 403, non-member → 404); personal tags remain owner-only; group membership still checked; `encryptedName` never decrypted/searched server-side; no names logged; no `expense_tags` row read/added/removed; canonical taxonomy remains code-curated and unreachable; optimistic locking correct; no finance field touched.

**Verification:** backend 78 suites / 872 (was 864 — +8 C5-c tests: admin create/rename/deprecate allowed, member create/rename/deprecate/restore → Forbidden, non-member → 404 unchanged, member LIST still allowed, personal unaffected); frontend 76 suites / 685 (was 682 — +3 C5-c tests: non-manager read-only list + hidden affordances + note, direct-call guards no-op, manager keeps affordances); backend + frontend builds clean; backend + frontend lint 0 errors; **FIN-002 finance-golden gate GREEN**; no migration, no package change.

---

## §C6-DISPLAY — Implementation note: custom-tag name display consistency (TAG-C6-DISPLAY, 2026-08-22)

**Nature:** additive implementation record. It does **not** rewrite §C0–§C5c. **FRONTEND-ONLY display fix** for the three TAG-C6 audit findings — no backend, API-contract, schema, migration, package, crypto, taxonomy, C5-d, learning, export, or finance change; the server keeps returning **only opaque custom-tag ids**. Fixes F1 (UUIDs in analytics), F2 (deprecated-tag click dead-end), F3 (personal custom tags missing on the dashboard).

**One reusable resolution path.** New `CustomTagService.getCustomTagNameMap(scope)` is THE single custom-tag name resolver: it returns `id → { name, deprecated }` for a scope, covering **active + deprecated** tags, decrypting CLIENT-SIDE with the correct scope key (personal → master key via `ensureCryptoContext`; group → per-group key/version via `ensureGroupKey('read', …)`) through the existing `getManaged*` path and the shared in-memory decrypt cache. Best-effort (per-status `.catch`), so a failure never throws into a page. No decryption logic is duplicated in any presentation component; plaintext names are never sent, URL-encoded, stored, or logged.

**F1 — analytics resolve custom names.** `analytics-charts` gained a `customTagNames?: Map<string,{name,deprecated}>` input. Canonical ids still resolve from `/taxonomy`; custom ids resolve from that input; an **unresolved UUID is never shown** — it falls back to the neutral **"Custom tag"** (a non-UUID unknown id, e.g. a deprecated canonical slug, keeps its readable slug). Distribution + trend both use one `resolveTagLabel`. The component caches the last raw analytics rows and **re-labels on `customTagNames` change without re-fetching** (the parent resolves names asynchronously). Applies to group-detail analytics and dashboard analytics (same component).

**F2 — deprecated custom tags.** Backend aggregation is unchanged (historical `expense_tags` intentionally remain). The chart now labels a deprecated tag with its decrypted historical name, marks it **"Deprecated"**, and **disables activation** — `onTagBarActivate` is a no-op for a deprecated id, so the UI never applies a filter the backend would reject (which previously returned an empty ledger with an unlabeled chip). Deprecated tags are still visible to explain historical spend; they never become active.

**F3 — personal custom tags.** The dashboard now loads the caller's personal custom-tag map once via `getCustomTagNameMap({})` and (a) merges **active** names into the row-chip `tagNameMap` (so `dashboard-home` rows render names via the existing chip code — undecryptable/deprecated omitted, never a UUID) and (b) passes the full map to `dashboard-analytics → analytics-charts`. Group behaviour is preserved: `group-detail` now resolves via the same `getCustomTagNameMap({ groupId })` (group key), feeding the filter facet, row chips, and the new analytics input from **one** load.

**Performance.** One resolver call per page (group or personal) = two GETs (active + deprecated), decrypted once and cached; the filter facet, row chips, and analytics all reuse that single result — no per-component/per-row/per-chart refetch, no N+1. Analytics re-labels from cached raw data on name arrival rather than re-fetching.

**Scope/E2EE/finance safety (verified):** group tags decrypt with the group key/version and personal tags with the master key (never crossed); no server-side decryption; no plaintext in requests/URLs/storage/logs; canonical taxonomy and classification unchanged; C4 correction memory untouched; no finance field touched.

**Verification:** frontend 76 suites / 694 (was 685 — +9 tests: analytics resolves custom name, "Custom tag" fallback for unknown/undecryptable (never UUID), canonical slug preserved, deprecated mark + activation no-op + disabled button, active custom clickable/emits, re-label-on-input-change without refetch; `getCustomTagNameMap` group-scope-endpoint/key + personal-scope-endpoint/key isolation, best-effort partial); frontend build + lint clean (0 errors); backend **untouched** — 78 suites / 872 still green, **FIN-002 finance-golden gate GREEN**; no migration, no package change, no API/contract change.
