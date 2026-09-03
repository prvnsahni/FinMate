# FinMate — Frozen Decision Ledger

**Status:** FROZEN — single source of truth for the FinMate documentation stack.
**Scope:** Product, security, privacy, data, AI, key, isolation, auth, deletion, and compatibility decisions accumulated across the vision brief, Round 1–2 decision rounds, the Round 3 adversarial review, the final compatibility review, and the repository audit.
**Constraint:** This is a decision record only. It authorises no code, schema, migration, API, encryption, or production change. The SRS is **not** written from this yet.

## How to read this ledger

- **Do not silently change a LOCKED decision.** Any change requires a new dated entry and an ADR.
- Each decision carries: ID · Decision · Status · Type · Reason · Security/Privacy impact · Existing-functionality impact · Production-data impact · Migration · Rollback · Platform (Web/iOS/Android) · Dependencies.
- Legal conclusions are marked **COUNSEL REQUIRED** and are never stated as "compliant."

### Status legend

| Status                   | Meaning                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------- |
| **LOCKED**               | Approved; preserved unless a real contradiction is later proven.                       |
| **DEFERRED**             | Approved as future scope; intentionally out of V1.                                     |
| **COUNSEL REQUIRED**     | Architecture set; legal basis/handling must be validated by qualified privacy counsel. |
| **ENGINEERING REQUIRED** | Locked intent; correctness depends on a specific implementation invariant.             |
| **OPEN**                 | Unresolved decision (none remain at freeze).                                           |
| **RISK**                 | Known unresolved security/operational exposure tracked as a workstream.                |

### Owner/type legend

Product · Engineering · Security · Counsel (an item may be primarily one type with a secondary dependency noted).

---

## 0. Governance principles (binding on all decisions)

### GOV-1 — Backward compatibility is a mandatory architectural principle

- **Decision:** FinMate is a working production application; existing users, financial data, groups, expenses, settlements, People/P2P, authentication, encryption, APIs, DB structures, and Web/PWA behaviour are a **protected baseline**. Prefer additive changes, compatibility layers, and safe migrations over destructive rewrites. Never assume clean-slate migration.
- **Status:** LOCKED · **Type:** Product + Engineering
- **Reason:** Protect production continuity while evolving security/privacy.
- **Security/Privacy impact:** Prevents "security" being used to justify unscoped rewrites; forces named threats.
- **Existing-fn impact:** Protective (constrains all other decisions).
- **Prod-data impact:** Protective. · **Migration:** n/a · **Rollback:** n/a · **Platform:** All · **Dependencies:** Governs every entry.

### GOV-2 — Priority order

- **Decision:** 1) Security/legal requirement → 2) Existing critical functionality → 3) Backward compatibility → 4) New architecture improvement → 5) Convenience/optimization. "Security" alone is never sufficient justification; the concrete threat must be named.
- **Status:** LOCKED · **Type:** Product · **Reason:** Deterministic conflict resolution. · **Security/Privacy impact:** Positive. · **Existing-fn/Prod-data:** Protective · **Migration/Rollback:** n/a · **Platform:** All · **Dependencies:** GOV-1.

### GOV-3 — Guiding objective

- **Decision:** "Secure and evolve the existing FinMate product without unnecessarily breaking it."
- **Status:** LOCKED · **Type:** Product · **Reason:** North star. · **Dependencies:** GOV-1/2.

### GOV-4 — No compliance claims

- **Decision:** Architecture is designed "GDPR-aligned / privacy-by-design." Never claim "GDPR compliant" or certified until independently validated by counsel/auditor.
- **Status:** LOCKED · **Type:** Product + Counsel · **Reason:** Avoid unsupportable legal claims. · **Security/Privacy impact:** Governance. · **Dependencies:** DPIA-1, VEN-1, all COUNSEL items.

### GOV-5 — User data is not automatically AI data

- **Decision:** Possessing user data never implies permission to send it to AI, analytics, personalization, or another module. Each such use requires explicit authorization/consent per its zone and legal basis.
- **Status:** LOCKED · **Type:** Product + Security · **Reason:** Core privacy stance. · **Dependencies:** AI-1..5, ISO-3/4, CON-\*.

---

## 1. Data classification & zones

### Z-1 — Data zones

- **Decision:** Zones **1 / 1a / 1b / 2 / 3**: 1a = opaque E2EE free-text/blobs; 1b = sensitive-but-computable (server-readable, isolated); 2 = core operational (protected plaintext for computation); 3 = isolated modules.
- **Status:** LOCKED · **Type:** Product + Security · **Reason:** Sensitivity ≠ uniform treatment. · **Security/Privacy impact:** Foundational. · **Existing-fn/Prod-data:** None. · **Migration/Rollback:** n/a · **Platform:** All · **Dependencies:** Governs Z/B/K/ISO.

### Z-2 — Financial amounts plaintext-but-protected

- **Decision:** Amounts, dates, currency, category, splits, balances, settlements, P2P ledger, goal-progress numbers remain **Zone 2**: no field/E2EE encryption (needed for computation), protected by TLS, encrypted storage, authorization, least privilege, audit. "Not field-encrypted" ≠ "unprotected."
- **Status:** LOCKED · **Type:** Product + Security · **Reason:** Computation requirement. · **Security/Privacy impact:** Amounts/relationship graph readable by backend/insiders (see OPS-1). · **Existing-fn impact:** Preserves current behaviour. · **Prod-data:** None. · **Migration/Rollback:** n/a · **Platform:** All · **Dependencies:** OPS-1, ISO-1.

### Z-3 — Expense title/description & note title/body E2EE (existing)

- **Decision:** Preserve existing client-side E2EE for expense `title`/`description` and note `title`/`body`.
- **Status:** LOCKED · **Type:** Engineering · **Reason:** Existing ZK guarantee holds in code. · **Security/Privacy impact:** Strong. · **Existing-fn:** Preserved. · **Prod-data:** None. · **Migration/Rollback:** n/a · **Platform:** All · **Dependencies:** K-3.

---

## 2. Free-text encryption expansion

### B-1 — Goal free-text E2EE (born encrypted)

- **Decision:** Goals-v2 free-text (title, reason/why, obstacles) encrypted from first implementation (Class-1). Structured siblings (category, targetAmount, targetDate, priority, status) stay Zone 2 for app logic.
- **Status:** LOCKED · **Type:** Engineering · **Reason:** `goals` table deployed but has **no write path/records** → clean start, no backfill. · **Security/Privacy impact:** Protects sensitive goal text. · **Existing-fn:** None (feature unimplemented). · **Prod-data:** None (empty). · **Migration:** Widen `goal.title varchar(160)→text` (empty table). · **Rollback:** Revert column type. · **Platform:** All · **Dependencies:** K-1, REC-1.

### B-2 — P2P direct-ledger note E2EE + mixed-state

- **Decision:** New P2P notes encrypted with a per-entry `direct_shared` content key wrapped for both registered users. Existing plaintext notes remain via an explicit `legacy_plaintext` vs `direct_shared` marker (no format-sniffing). Client-side opportunistic backfill only. Indefinite mixed-state supported; no forced conversion; readers/export/deletion branch on the marker.
- **Status:** LOCKED · **Type:** Engineering · **Reason:** P2P is in production; plaintext notes may exist; must not break existing users. · **Security/Privacy impact:** Protects P2P note text going forward. · **Existing-fn:** Additive; all read/export/history paths must branch or ciphertext leaks (see KI-1 class). · **Prod-data:** Yes (existing plaintext rows). · **Migration:** Additive nullable marker column + client backfill. · **Rollback:** Readers already handle plaintext; stop writing encrypted. · **Platform:** All · **Dependencies:** K-1, B-3, DEL-3.

### B-3 — Full free-text/PII field inventory (Documentation task #1)

- **Decision:** Before freezing the Data Classification & Encryption Matrix, inventory and classify **every** entity/field, incl. settlement notes, `ExpensePayment`, group name/description, profile (`phoneNumber`/`displayName`), attachments, and Contacts (third-party PII).
- **Status:** ENGINEERING REQUIRED · **Type:** Engineering + Security · **Reason:** Current matrix is incomplete; only goal title & P2P note were classified. · **Security/Privacy impact:** Closes hidden-plaintext gaps. · **Existing-fn:** Audit only. · **Prod-data:** None. · **Migration/Rollback:** n/a · **Platform:** All · **Dependencies:** Precedes Matrix doc; feeds Z-1.

---

## 3. Key architecture

### K-1 — Class-1 E2EE keys

- **Decision:** Random per-domain/per-entry keys, wrapped under the user master key **and** the recovery key; **not** HKDF-derived (deterministic keys cannot crypto-shred). Support per-domain revocation, crypto-shred, recovery, versioning.
- **Status:** LOCKED · **Type:** Engineering + Security · **Reason:** Isolation + crypto-shred require random, wrapped keys. · **Security/Privacy impact:** Per-domain confidentiality + shred. · **Existing-fn:** New domains only. · **Prod-data:** None. · **Migration:** Additive key store for new domains. · **Rollback:** n/a · **Platform:** All · **Dependencies:** REC-1, K-3, K-4.

### K-2 — Class-2 server-managed keys

- **Decision:** For server-readable domains (WELLBEING metrics, INTELLIGENCE): per-user/per-domain server/KMS-managed keys, access-gated by purpose+consent, revocable, crypto-shreddable. A **new** key store — not the existing global `EncryptionService` (which cannot per-user shred).
- **Status:** LOCKED · **Type:** Engineering + Security · **Reason:** Server analysis needs server-readable keys; global key can't per-user shred. · **Security/Privacy impact:** App-server compromise can read these domains → mitigated by isolation/role/consent/DPIA. · **Existing-fn:** Preserves existing `EncryptionService` (2FA/avatar). · **Prod-data:** None. · **Migration:** Additive. · **Rollback:** n/a · **Platform:** All · **Dependencies:** A-hybrid, DPIA-1, ISO-1.

### K-3 — Existing personal master-key crypto unchanged

- **Decision:** Existing personal-scope data stays under the current master key; not migrated to per-domain keys.
- **Status:** LOCKED · **Type:** Engineering · **Reason:** Backward compatibility; no concrete threat requires migration. · **Existing-fn:** Preserved. · **Prod-data:** None. · **Migration/Rollback:** n/a · **Platform:** All · **Dependencies:** GOV-1.

### K-4 — Crypto-shred honesty caveat

- **Decision:** Do not market "instant" crypto-shred: wrapped keys also persist in DB backups and may be cached on devices, so true erasure completes only after device-cache clear **and** backup rotation. Crypto-shred's value = revocation + isolation + defense-in-depth.
- **Status:** LOCKED · **Type:** Security · **Reason:** Avoid over-claiming erasure. · **Security/Privacy impact:** Accurate erasure expectations. · **Dependencies:** RET-1, K-1/2, DEL-2.

---

## 4. Domain isolation

### ISO-1 — Isolation model (public stays; new schemas + real DB roles)

- **Decision:** One PostgreSQL. Existing CORE/FINANCE tables remain in `public` (no broad migration). New sensitive domains (GOALS, PRIVATE, WELLBEING, WARDROBE, OPPORTUNITIES, INTELLIGENCE) use dedicated schemas **with genuinely restricted DB principals** (separate datasources/pools or carefully designed RLS). One app is fine; schemas alone are **not** a boundary; a single superuser ORM connection must not defeat isolation.
- **Status:** LOCKED (ENGINEERING REQUIRED for the role enforcement) · **Type:** Engineering + Security · **Reason:** Least-privilege where the newest, most sensitive data lives; avoid risky reshuffle of live finance tables. · **Security/Privacy impact:** Blast-radius containment. · **Existing-fn:** Preserves finance tables/transactions. · **Prod-data:** None (additive schemas). · **Migration:** Additive schemas/roles as domains land. · **Rollback:** n/a · **Platform:** All · **Dependencies:** ISO-2/3/4.

### ISO-2 — INTELLIGENCE holds no raw FKs / no raw copies

- **Decision:** INTELLIGENCE must not hold foreign keys into raw domain tables nor store raw source data; it holds signals, controlled projections, and provenance (domain + opaque IDs) only.
- **Status:** LOCKED (ENGINEERING REQUIRED) · **Type:** Engineering + Security · **Reason:** Prevent INTELLIGENCE becoming a god-module/data lake. · **Security/Privacy impact:** Minimizes central exposure. · **Existing-fn:** None. · **Prod-data:** None. · **Migration/Rollback:** n/a · **Platform:** All · **Dependencies:** INT-1/2, DER-1, RGT-2.

### ISO-3 — Cross-module deny-by-default + contracts (hybrid)

- **Decision:** Modules deny by default; access via defined contracts/projections. **Correctness-critical** cross-domain reads (e.g., GOALS←FINANCE) use synchronous projection-pull; **personalization/insights** use asynchronous pushed signals to INTELLIGENCE.
- **Status:** LOCKED · **Type:** Engineering + Security · **Reason:** Keep goal numbers correct while bounding INTELLIGENCE. · **Security/Privacy impact:** Least-privilege data exchange. · **Existing-fn:** Additive. · **Prod-data:** None. · **Migration:** Additive. · **Rollback:** Disable contracts. · **Platform:** All · **Dependencies:** OUT-1, ISO-4.

### ISO-4 — Consent/legal-basis travels with the signal

- **Decision:** Every signal carries source domain, legal basis, consent scope, provenance, opaque source IDs. INTELLIGENCE enforces permission **at the point of combination**, not only at collection (prevents legitimate-interest single-domain data being laundered into consent-required cross-domain profiling).
- **Status:** LOCKED (ENGINEERING REQUIRED) · **Type:** Engineering + Security + Counsel · **Reason:** Close the consent-laundering hole. · **Security/Privacy impact:** High. · **Existing-fn:** Additive. · **Prod-data:** None. · **Migration/Rollback:** n/a · **Platform:** All · **Dependencies:** CON-3, ISO-3, DPIA-1.

---

## 5. AI data-access & privacy firewall

### AI-1 — Single AI egress firewall

- **Decision:** All external AI access (and any future self-hosted model) passes through one controlled egress/privacy-firewall layer — the sole audit and enforcement chokepoint.
- **Status:** LOCKED · **Type:** Engineering + Security · **Reason:** One place to minimize, audit, rate-limit, kill. · **Security/Privacy impact:** High. · **Existing-fn:** **Reworks the current dashboard chatbot** (thin passthrough proxy today). · **Prod-data:** None. · **Migration:** FE+BE coordinated; opt-in feature. · **Rollback:** Feature-flag old proxy off. · **Platform:** All · **Dependencies:** AI-2/3/4/5, VEN-1.

### AI-2 — Numeric/enum/aggregate-only projections (V1)

- **Decision:** V1 AI projections contain **no stored user free-text** — numeric values, enums, controlled categories, aggregates, bounded projections only. Free-text may be reintroduced later after prompt-injection + leakage controls are validated.
- **Status:** LOCKED · **Type:** Engineering + Security · **Reason:** Removes injection/leakage vector cheaply. · **Security/Privacy impact:** High. · **Existing-fn:** Changes chatbot (drops free-text/userName). · **Prod-data:** None. · **Migration/Rollback:** with AI-1. · **Platform:** All · **Dependencies:** AI-4.

### AI-3 — Server owns model + prompt; `assistant_qa` untrusted & stateless

- **Decision:** Client sends **intent + parameters**, never arbitrary prompt/model. Server owns model selection and system prompt. A single bounded `assistant_qa` intent over a fixed capped projection is allowed; the user question is **untrusted input** (never overrides security rules), is **not logged**, and `assistant_qa` retains **no server-side conversation transcript**.
- **Status:** LOCKED · **Type:** Engineering + Security · **Reason:** Injection defense + prompt = IP. · **Security/Privacy impact:** High. · **Existing-fn:** Replaces free-form chat with bounded intent. · **Prod-data:** None. · **Migration/Rollback:** with AI-1. · **Platform:** All · **Dependencies:** RGT-3, AI-2.

### AI-4 — Controlled-category mapping

- **Decision:** Only controlled categories (e.g., FOOD/TRANSPORT/SHOPPING/HEALTH/ENTERTAINMENT) may reach the model. Custom user categories are mapped to controlled enums before egress; arbitrary category text is never sent. Merchant-level AI insights are out of V1 scope.
- **Status:** LOCKED · **Type:** Engineering + Security · **Reason:** Prevents free-text leaking via category. · **Existing-fn:** Additive. · **Prod-data:** None. · **Dependencies:** AI-2.

### AI-5 — External-AI consent enforced

- **Decision:** External-AI processing requires the explicit external-AI consent toggle (server-enforced); no user data reaches a provider without it (existing `aiOptIn` gate is the baseline).
- **Status:** LOCKED · **Type:** Engineering + Security + Counsel · **Reason:** Consent gate. · **Existing-fn:** Preserves existing opt-in gate. · **Prod-data:** None. · **Dependencies:** CON-3, VEN-1.

---

## 6. Intelligence & personalization

### INT-1 — Small signals, not databases

- **Decision:** INTELLIGENCE receives small pushed signals + controlled projections + provenance, never entire raw datasets.
- **Status:** LOCKED · **Type:** Engineering + Security · **Reason:** Minimize central footprint. · **Dependencies:** ISO-2/3/4.

### INT-2 — Provenance without raw data

- **Decision:** Provenance = source domain + opaque source IDs (+ confidence/reason/date for user transparency), never raw sensitive source data.
- **Status:** LOCKED (ENGINEERING REQUIRED) · **Type:** Engineering · **Reason:** Support deletion cascade + "what we know" page without a data lake. · **Dependencies:** RGT-2, DER-1.

### INT-3 — Profiling gated OFF until DPIA

- **Decision:** INTELLIGENCE cross-domain/profiling processing is feature-flagged OFF until DPIA sign-off, even though the plumbing may ship earlier.
- **Status:** LOCKED (COUNSEL gate) · **Type:** Engineering + Counsel · **Reason:** High-risk processing must be assessed first. · **Existing-fn:** None. · **Prod-data:** None. · **Dependencies:** DPIA-1.

### INT-4 — Durable suppression/override (N1)

- **Decision:** Rejecting/correcting a derived fact writes a **persistent override/suppression state stored independently of the deletable derived data**, honoured unconditionally by recomputation — so a consent withdrawal → re-consent cycle (which deletes derived data) does **not** resurrect a rejected inference.
- **Status:** LOCKED (ENGINEERING REQUIRED) · **Type:** Engineering + Security · **Reason:** Adversarial break N1: suppression stored with derived data would be deleted and regenerate. · **Security/Privacy impact:** Preserves rectification guarantee. · **Existing-fn:** None. · **Prod-data:** None. · **Migration/Rollback:** n/a · **Platform:** All · **Dependencies:** RGT-1, CON-1, DER-1.

---

## 7. Derived data, deletion, consent

### DER-1 — RAW → DERIVED → RECOMMENDATION cascade

- **Decision:** Three layers with provenance. Source deletion/change → **mark dependent aggregate stale → recompute or drop**, never blind "delete one source = delete the aggregate." Derived data is treated as sensitive.
- **Status:** LOCKED (ENGINEERING REQUIRED) · **Type:** Engineering + Security · **Reason:** Correct + privacy-safe derived lifecycle. · **Dependencies:** OUT-1, INT-2/4.

### DEL-1 — Account deletion = personal erase + anonymize-in-place shared

- **Decision:** Personal-scope data erased per policy; **shared financial records and audit are retained where legally justified with the departed identity tombstoned/pseudonymized in place** — because existing NOT-NULL user FKs on `direct_ledger_entries`, `expenses`, `settlements`, `audit_logs` make row-DELETE impossible without corrupting other users' ledgers.
- **Status:** LOCKED (arch); COUNSEL REQUIRED (retention basis) · **Type:** Engineering + Counsel · **Reason:** Art. 17 vs shared-record integrity. · **Security/Privacy impact:** Balanced erasure. · **Existing-fn:** Protects others' P2P/group/settlement history. · **Prod-data:** Yes (anonymize, not delete). · **Migration:** New deletion service (no current delete feature). · **Rollback:** n/a (new). · **Platform:** All · **Dependencies:** DEL-2/3, CON-1, OUT-1.

### DEL-2 — Backup-restore tombstone replay

- **Decision:** Deletion/withdrawal tombstones survive restoration and are replayed after any DB restore, so a restore within the retention window cannot resurrect erased data.
- **Status:** LOCKED (ENGINEERING REQUIRED) · **Type:** Engineering + Security · **Reason:** Restore-resurrection trap. · **Dependencies:** RET-1, DEL-1, CON-1.

### DEL-3 — Departed-user personal content in retained shared free-text (N4)

- **Decision:** Retained shared free-text (e.g., a legacy plaintext P2P note authored by a deleted user) may contain that user's personal content; whether it needs redaction/tombstoning beyond identity anonymization is a legal call.
- **Status:** COUNSEL REQUIRED · **Type:** Counsel + Engineering · **Reason:** Adversarial break N4. · **Security/Privacy impact:** Residual personal-data retention. · **Existing-fn:** P2P history. · **Prod-data:** Yes (shared notes). · **Dependencies:** DEL-1, B-2.

### CON-1 — Consent withdrawal semantics

- **Decision:** Withdrawal = stop future processing + stop cross-domain use + invalidate/recompute dependent derived data + revoke server-side analysis-key access + record withdrawal state; **retain raw** unless the user separately requests deletion. Integrates with the same durable cascade as deletion.
- **Status:** LOCKED · **Type:** Engineering + Security · **Reason:** Withdrawal ≠ raw deletion. · **Existing-fn:** None. · **Prod-data:** Derived only. · **Dependencies:** OUT-1, INT-4, K-2.

### CON-2 — First-party single-domain display needs no consent

- **Decision:** Showing a user their own single-domain data (e.g., existing dashboard aggregates) is not "personalization/profiling" and must not be consent-gated. Consent applies to cross-domain combination + external-AI egress.
- **Status:** LOCKED · **Type:** Product + Engineering · **Reason:** Prevents breaking the existing dashboard. · **Existing-fn:** **Preserves current dashboard.** · **Prod-data:** None. · **Dependencies:** CON-3.

### CON-3 — Tiered consent + consent ledger

- **Decision:** Legitimate interest (with LIA + easy opt-out) for Level-1 non-special-category single-domain finance aggregates; **explicit consent** for wellbeing, cross-domain correlation, and external-AI egress. Toggles: master personalization/AI + finance-insights + wellbeing + external-AI + wardrobe-vision. Consent ledger records scope/policy-version/timestamp/withdrawal state. Legitimate interest **cannot** cover Art. 9 special-category data.
- **Status:** LOCKED (COUNSEL for bases) · **Type:** Product + Engineering + Counsel · **Reason:** Lawful, non-fatiguing consent. · **Security/Privacy impact:** High. · **Existing-fn:** Additive. · **Prod-data:** None. · **Dependencies:** ISO-4, DPIA-1, GOV-4.

---

## 8. Reliability backbone

### OUT-1 — Transactional outbox (V1)

- **Decision:** Deletion/consent-invalidation guarantees depend on reliable delivery. V1 uses PostgreSQL transaction → transactional outbox → durable event → worker/retry → idempotent consumer → derived-data invalidation. No Kafka/heavy infra unless scale requires it.
- **Status:** LOCKED (ENGINEERING REQUIRED) · **Type:** Engineering · **Reason:** Fire-and-forget would drop deletes → orphaned derived data (GDPR + correctness). · **Existing-fn:** Additive (outbox insert in existing write tx). · **Prod-data:** None. · **Migration:** Additive table + worker. · **Rollback:** Disable worker (events queue). · **Platform:** All · **Dependencies:** DER-1, DEL-1/2, CON-1.

---

## 9. Authentication & session

### AU-1 — Dual-transport refresh

- **Decision:** Web = HttpOnly+Secure+SameSite=Lax refresh cookie, path-scoped, CSRF-protected, access token in memory only, **not** returned in body. Native = refresh token in iOS Keychain / Android Keystore via Capacitor secure storage, sent by header. Backend distinguishes transports by capability (never `if(iOS)`); a cookie-presented refresh **always** requires CSRF; the header path must **never** be satisfiable by an ambient browser cookie. Retain refresh rotation + Redis session hashing; logout revokes session + clears the right credential.
- **Status:** LOCKED · **Type:** Engineering + Security · **Reason:** Fixes W3 (XSS-exfiltratable body token). · **Security/Privacy impact:** High. · **Existing-fn:** **Changes web auth response contract** (see AU-4 transition). · **Prod-data:** None. · **Migration:** Dual-emit transition. · **Rollback:** Re-enable body emission (cookie additive). · **Platform:** Web (cookie), iOS/Android (secure storage). · **Dependencies:** AU-2, AU-4, W3.

### AU-2 — Web cookie topology (resolved)

- **Decision:** Production FE `finmate.prvnsahni.com` and API `finmate-api.prvnsahni.com` share registrable domain `prvnsahni.com` → **schemefully same-site, cross-origin** → **SameSite=Lax is correct** (SameSite=None not required). Constraint recorded: if API ever moves to a different registrable domain it flips to cross-site → SameSite=None+Secure.
- **Status:** LOCKED · **Type:** Engineering + Security · **Reason:** Determines cookie/CSRF model from real topology (not guessed). · **Existing-fn:** Auth. · **Prod-data:** None. · **Platform:** Web. · **Dependencies:** AU-1, AU-2a.

### AU-2a — Web cookie/CORS configuration

- **Decision:** Cookie = HttpOnly + Secure + SameSite=Lax + **host-only** to `finmate-api.prvnsahni.com` (no `Domain=.prvnsahni.com`) + path `/api/v1/auth/refresh`. CORS = exact origin `https://finmate.prvnsahni.com` with `Allow-Credentials: true` (never `*`); prod `CORS_ORIGINS` set accordingly. CSRF double-submit on the cookie-authed refresh (same-site sibling subdomains can still drive credentialed POSTs). FE CSP `connect-src` must allow `https://finmate-api.prvnsahni.com`.
- **Status:** ENGINEERING REQUIRED (verify-before-GA) · **Type:** Engineering + Security · **Reason:** Cross-origin same-site requires exact CORS + CSRF + host-only scoping. · **Existing-fn:** Auth + CSP. · **Prod-data:** None. · **Platform:** Web. · **Dependencies:** AU-2, W5.

### AU-3 — Passkeys/biometrics ≠ master-key derivation

- **Decision:** In V1 passkeys/biometrics are login/2FA mechanisms only; the E2EE master key stays password/passphrase-derived. Encryption-unlock credential is kept separate from the login credential. Passwordless E2EE decoupling is future work.
- **Status:** LOCKED · **Type:** Engineering + Security · **Reason:** Passwordless login would otherwise break `PBKDF2(password)` master key. · **Existing-fn:** None. · **Prod-data:** None. · **Platform:** All. · **Dependencies:** REC-1; future OMR-1.

### AU-4 — Old-mobile compatibility for the auth transition (N3)

- **Decision:** The dual-emit/CSRF transition must also cover **already-installed old mobile app versions** that read the refresh token from the body: keep body-token emission (or a versioned compat path) until a **minimum-supported app version** is enforced; add min-version gating. Additive within `/api/v1`.
- **Status:** LOCKED (ENGINEERING REQUIRED) · **Type:** Engineering · **Reason:** Adversarial break N3: hard cutover breaks un-updatable installs. · **Security/Privacy impact:** Neutral (bounded transition). · **Existing-fn:** Protects old mobile clients. · **Prod-data:** None. · **Migration:** Phased with min-version enforcement. · **Rollback:** Extend body emission window. · **Platform:** iOS/Android. · **Dependencies:** AU-1, W3.

---

## 10. Recovery, rotation, offline

### REC-1 — Mandatory recovery before E2EE storage

- **Decision:** Recovery-code setup is mandatory / strongly-gated before a user stores highly sensitive E2EE data, with clear messaging that lost recovery means unrecoverable E2EE data. Do not weaken E2EE for recovery convenience.
- **Status:** LOCKED · **Type:** Product + Engineering · **Reason:** Optional recovery + per-domain E2EE = permanent multi-domain data loss. · **Existing-fn:** Onboarding change. · **Prod-data:** None. · **Platform:** All. · **Dependencies:** K-1.

### ROT-1 — Event-driven rotation; no retroactive-revocation claim

- **Decision:** Key rotation is event-driven (member removal, suspected compromise, key-loss/recovery, defined security events); no calendar rotation unless a later threat model justifies it. V1 does **not** claim retroactive revocation — a removed member may retain access to data they already decrypted/cached; rotation protects future data. Fix the existing group-key `versionId`-ignored bug (KI-1) before more encrypted domains rely on rotation. _(⟳ 2026-08-13: the KI-1 prerequisite is **VERIFIED satisfied** in the repository — see the SEC-KI1 status correction two entries below and [FINMATE_SEC_KI1_VERIFICATION.md](FINMATE_SEC_KI1_VERIFICATION.md).)_
- **Status:** LOCKED · **Type:** Engineering + Security · **Reason:** Honest revocation semantics + prerequisite fix. · **Existing-fn:** Preserves group behaviour; fixes a latent bug. · **Prod-data:** None. · **Platform:** All. · **Dependencies:** SEC-KI1.

### OFF-1 — Offline scope

- **Decision:** V1 offline supports personal-scope operations only; group expense writes require online. Group keys are never persisted offline merely to enable offline group writes.
- **Status:** LOCKED · **Type:** Engineering + Security · **Reason:** Preserve session-only group-key stance. · **Existing-fn:** Preserved. · **Prod-data:** None. · **Platform:** All (esp. PWA/native). · **Dependencies:** K-1.

---

## 11. Export, notifications, vendors, retention

### EXP-1 — Data export

- **Decision:** One export experience with labelled **provided** vs **derived/inferred** sections (no Art. 20 portability claim on inferred data). Group exports requester-scoped (no unnecessary other-user PII). Async generation, expiring signed download, re-authentication. E2EE domains exported client-side (decrypt-in-browser); server cannot export their plaintext.
- **Status:** LOCKED (COUNSEL for portability scope) · **Type:** Engineering + Counsel · **Reason:** Arts. 15/20 distinction. · **Existing-fn:** Additive. · **Prod-data:** Read-only. · **Platform:** All. · **Dependencies:** DEL-1, K-1.

### NOT-1 — Notification privacy

- **Decision:** Push payloads contain **no** sensitive financial/health/mood/journal/wardrobe/relationship content ("New Finmate insight"); the app fetches details after authentication. Privacy levels (minimal default) control lock-screen/post-auth display, **not** what transits Apple/Google/FCM.
- **Status:** LOCKED · **Type:** Engineering + Security · **Reason:** Third-party push networks must not carry sensitive content. · **Existing-fn:** Additive. · **Prod-data:** None. · **Platform:** Web/iOS/Android push. · **Dependencies:** —.

### VEN-1 — Processor/vendor policy

- **Decision:** Living vendor register + DPA per vendor; verified no-training/ZDR/privacy config before any user data is sent (do not trust a bare "not used for training" claim). Prefer EU-region processing where supported; else appropriate transfer mechanism (SCCs) documented, plus sub-processor-change notification + objection/review. V1 register: OpenAI (AI), Resend (email). Future OCR/vision/storage/push → security/privacy/legal review before use.
- **Status:** LOCKED (COUNSEL for transfers) · **Type:** Security + Counsel · **Reason:** Controlled third-party exposure + Arts. 44–46. · **Existing-fn:** Additive. · **Prod-data:** None. · **Platform:** All. · **Dependencies:** AI-5, TRN-1, CARD-1.

### RET-1 — Retention SLA (parametric)

- **Decision:** Publish **one conservative** deletion/erasure window (~30 days as a working figure) but do **not** hard-code the number until PostgreSQL backups, PITR/WAL, object storage, Redis, logs, AI/email/analytics vendors, and mobile/device backups are mapped and can actually guarantee it. Treated as a parameter in the SRS until verified.
- **Status:** OPEN VALUE (LOCKED as parametric) · **Type:** Engineering + Counsel · **Reason:** Avoid an unmeetable erasure promise. · **Security/Privacy impact:** Defines Art. 17 SLA. · **Dependencies:** DEL-2, K-4, VEN-1.

---

## 12. IP confidentiality & development-AI policy

### IP-1 — Crown-jewel isolation + dev-AI controls

- **Decision:** Restrict crown-jewel IP (threat model, algorithms, roadmap, prompt library, security design) to a restricted path/private space excluded from AI context, trade-secret-marked; isolate the 1–2 genuinely differentiating algorithms behind an internal API/module. Secretless working tree is the real boundary (AI-ignore files are best-effort per-tool). Business/enterprise no-train/ZDR dev-AI tiers; secret scanning; synthetic fixtures; least-knowledge task-specific context; audit where available.
- **Status:** LOCKED · **Type:** Security + Product · **Reason:** Reduce disclosure of proprietary IP to AI. · **Security/Privacy impact:** IP protection. · **Existing-fn:** Dev process only. · **Prod-data:** None. · **Platform:** n/a. · **Dependencies:** SEC-W1, IP-2.

### IP-2 — No guarantee against independent reproduction

- **Decision:** It is impossible to guarantee no external AI ever independently produces a similar product. Rely on layered controls: information minimization, architectural isolation, technical controls, provider/contractual controls, IP/legal protection, operational controls. Do not claim guarantees.
- **Status:** LOCKED · **Type:** Product + Counsel · **Reason:** Honest IP posture. · **Dependencies:** IP-1.

---

## 13. Domain-specific product decisions (Q1–Q9)

### RGT-1 — Rectification & restriction (Q1)

- **Decision:** Users can correct inaccurate personal info, challenge/reject incorrect derived facts, and temporarily restrict processing. Three distinct states: **override/suppression** (permanent per-fact, see INT-4), **restriction** (reversible pause, distinct from withdrawal), **withdrawal** (stop + invalidate). E2EE correction = client-side re-encrypt.
- **Status:** LOCKED (ENGINEERING REQUIRED) · **Type:** Product + Engineering + Counsel · **Reason:** Arts. 16/18 + trust. · **Security/Privacy impact:** Positive. · **Existing-fn:** None. · **Prod-data:** None. · **Platform:** All. · **Dependencies:** INT-4, CON-1, DER-1.

### RGT-2 — "What Finmate knows about me" (Q2)

- **Decision:** Provide (vNext) a page where each learned fact shows fact, source/provenance, confidence, date, reason (where appropriate), with delete/reset and disable-personalization. No raw source data stored in INTELLIGENCE to support it.
- **Status:** LOCKED (data model required now; feature vNext) · **Type:** Product + Engineering · **Reason:** Transparency/Art. 15. · **Existing-fn:** None. · **Prod-data:** None. · **Platform:** All. · **Dependencies:** INT-2, RGT-1.

### RGT-3 — AI memory (Q3)

- **Decision:** V1 = limited **structured** AI memory only (a governed view of INTELLIGENCE), no unrestricted conversational memory; `assistant_qa` stateless; user can inspect/delete/disable structured memory.
- **Status:** LOCKED · **Type:** Product + Engineering · **Reason:** Bounded, controllable memory. · **Existing-fn:** None. · **Platform:** All. · **Dependencies:** AI-3, INT-2.

### WARD-1 — Wardrobe: clothing-only + approved-provider baseline (Q4 + N2)

- **Decision:** Wardrobe V1 = clothing/style analysis only. Finmate must **not** perform facial recognition, identify people, build biometric profiles, infer sensitive characteristics, or intentionally use faces/background for styling. Before external egress, minimize face/background where technically feasible. **Baseline:** route all wardrobe vision through an **approved provider/config appropriate to the sensitivity**; treat minimization as best-effort enhancement, not the gate. If neither reliable minimization nor an approved path is available, **the operation must not proceed** (fail-closed).
- **Status:** LOCKED (ENGINEERING REQUIRED) · **Type:** Product + Engineering + Security + Counsel · **Reason:** Adversarial break N2: face-detection false-negatives make minimization-as-gate fail-open toward biometric leakage. · **Security/Privacy impact:** Avoids Art. 9 biometric exposure. · **Existing-fn:** None (new module). · **Prod-data:** None. · **Platform:** All. · **Dependencies:** VEN-1, ISO-1, K-1.

### TRN-1 — No model training on user data in V1 (Q5)

- **Decision:** No user-data training in V1 — internal or external. Providers must have verified no-training/ZDR/privacy config before receiving user data. Any future improvement dataset is separately designed, controlled, anonymized/aggregated, legally reviewed, separately documented.
- **Status:** LOCKED · **Type:** Product + Security + Counsel · **Reason:** Privacy + IP. · **Existing-fn:** None. · **Dependencies:** VEN-1, AI-5.

### CNT-1 — Contacts / non-users (Q6)

- **Decision:** Contacts (names/emails of non-users) use strict minimization + minimum retention; **excluded** from AI, personalization, intelligence, behavioural profiling without a separately approved legal basis. A non-user rights-request process must exist. Legal basis and non-user rights handling are COUNSEL REQUIRED.
- **Status:** LOCKED (arch); COUNSEL REQUIRED (basis/rights) · **Type:** Product + Counsel + Engineering · **Reason:** Third-party PII without consent. · **Existing-fn:** Additive to Contacts. · **Prod-data:** Possibly (existing contacts). · **Platform:** All. · **Dependencies:** CNT-2, GOV-4.

### CNT-2 — Contact→user conversion (Q6b / N5)

- **Decision:** When a contact registers (existing claim-flow), pre-consent contact data is **not** retroactively ingested into INTELLIGENCE/personalization; personalization starts fresh, prospectively, post-consent.
- **Status:** LOCKED (ENGINEERING REQUIRED) · **Type:** Engineering + Security · **Reason:** Adversarial break N5. · **Existing-fn:** Preserves claim-flow. · **Prod-data:** None new. · **Platform:** All. · **Dependencies:** CNT-1, ISO-4.

### ACC-1 — Admin access / break-glass (Q7)

- **Decision:** V1 = **no routine** employee/developer access to user data; restrict production DB credentials; least privilege; audit production access; record emergency access. A sophisticated automated break-glass workflow is future work. The current production DB-access exposure must be explicitly recorded (see OPS-1) — policy alone does not solve it.
- **Status:** LOCKED (V1 controls); DEFERRED (full break-glass workflow) · **Type:** Security + Product · **Reason:** Insider-threat reduction. · **Security/Privacy impact:** High. · **Existing-fn:** Ops. · **Prod-data:** Access governance. · **Platform:** Backend/ops. · **Dependencies:** OPS-1.

### CARD-1 — Card & bank-statement data (Q8)

- **Decision:** **Never** store CVV, PIN, or full PAN/card number. Store only what's needed (last4, issuer, type, statement transactions, charges, cashback/reward info). Uploaded original statements: raw = Zone 1a E2EE, **process → extract → delete original by default**, retain only on explicit user choice; extracted transactions become Zone 2 for reconciliation. Any OCR/document-processing vendor goes through security/vendor review before use.
- **Status:** LOCKED (net-new; OCR vendor COUNSEL/VEN review) · **Type:** Product + Security + Counsel · **Reason:** Minimize financial-sensitive data; PCI-scope avoidance. · **Existing-fn:** None (unimplemented). · **Prod-data:** None. · **Platform:** All. · **Dependencies:** VEN-1, Z-1.

### CERT-1 — Certifications (Q9)

- **Decision:** Certifications are a roadmap, not a launch blocker (GDPR operational readiness, ISO 27001/27701, SOC 2; PCI DSS only if a PCI-scoped payment role is ever entered). Build evidence/control artifacts (audit log, processor register, classification matrix, access reviews) from the start. No compliance/certification claims until independently validated.
- **Status:** DEFERRED (artifacts LOCKED now) · **Type:** Product + Security + Counsel · **Reason:** Make future certification practical. · **Dependencies:** GOV-4, VEN-1.

### SCR-1 — Opportunities / web data (P)

- **Decision:** Opportunity discovery prefers official APIs / licensed feeds / approved providers / source-specific legally reviewed collection; **no unrestricted broad scraping**. OPPORTUNITIES runs as a separate low-trust service/store with an egress allowlist (SSRF defense) and one-way data flow (public → recommendation; user side sends only minimal constraints). Any new provider → privacy/security/legal/vendor review.
- **Status:** LOCKED (COUNSEL for source legality) · **Type:** Product + Security + Counsel · **Reason:** ToS/EU database-rights risk. · **Existing-fn:** None (future). · **Platform:** Backend. · **Dependencies:** VEN-1, ISO-1.

### DPIA-1 — DPIA timing (O)

- **Decision:** A DPIA is required before sensitive wellbeing/profiling processing goes live, scoped to cover financial behavioural profiling + AI egress + wellbeing (staged). Profiling infrastructure may exist but stays flag-OFF until sign-off (INT-3).
- **Status:** COUNSEL REQUIRED · **Type:** Counsel + Engineering · **Reason:** Art. 35 high-risk combination. · **Dependencies:** INT-3, ISO-4, CON-3, GOV-4.

---

## 14. Security risks & P0/P1 workstream (independent of documentation)

### SEC-W1 — Secret/blob exposure in git history (P0)

- **Decision:** Add secret scanning (gitleaks CI + pre-commit); one-time history scan; BFG/filter-repo purge of the committed encrypted-image blobs; rotate anything flagged.
- **Status:** RISK (P0, open) · **Type:** Security · **Reason:** Committed artifacts in immutable history + no scanning. · **Existing-fn:** Repo only (history rewrite → re-clone). · **Prod-data:** None. · **Migration:** Coordinated history rewrite. · **Rollback:** Pre-rewrite mirror. · **Platform:** n/a. · **Dependencies:** IP-1.

### SEC-W2 — Tokens/email/IP in logs (P0)

- **Decision:** Redact `token`/`email` query params from access logs; drop/hash IP in the app logging interceptor (allowlist logging); ensure reverse-proxy access logs at `finmate-api` don't capture GET token query strings.
- **Status:** RISK (P0, open) · **Type:** Security · **Reason:** Single-use auth tokens + PII reach logs via `originalUrl`; raw IP logged. · **Existing-fn:** Logging only. · **Prod-data:** None. · **Migration:** None. · **Rollback:** Trivial. · **Platform:** Backend. · **Dependencies:** —.

### SEC-W3 — Refresh token in response body (P0)

- **Decision:** Remove refresh token from the web response body via the dual-emit transition (AU-1/AU-4); honour already-issued tokens until rotation.
- **Status:** RISK (P0, open) · **Type:** Security · **Reason:** XSS-exfiltratable; docs already promise HttpOnly cookie. · **Existing-fn:** **All web + old mobile sessions.** · **Prod-data:** None. · **Migration:** Dual-emit + min-version. · **Rollback:** Re-enable body emission. · **Platform:** Web + iOS/Android. · **Dependencies:** AU-1, AU-4.

### SEC-W5 — Swagger/CSP (P2)

- **Decision:** Gate/remove Swagger in production; harden production CSP (drop `unsafe-inline`); exclude sensitive endpoints from PWA service-worker caching.
- **Status:** RISK (P2, open) · **Type:** Security · **Reason:** XSS surface (E2EE doesn't protect runtime). · **Existing-fn:** `/docs` + CSP + PWA cache. · **Prod-data:** None. · **Platform:** Web/PWA. · **Dependencies:** AU-2a.

### SEC-W6c — Attachment `originalName` plaintext/encrypted duplication (P1)

- **Decision:** Resolve the plaintext `originalName` stored alongside the encrypted filename (drop the plaintext column or accept with justification) before attachments GA.
- **Status:** RISK (P1, open) · **Type:** Security + Engineering · **Reason:** Plaintext copy defeats the encrypted filename. · **Existing-fn:** Attachments (roadmap). · **Prod-data:** Possibly future. · **Platform:** All. · **Dependencies:** B-3.

### SEC-W7 — Audit-log email in `metadataJson` (P1)

- **Decision:** Stop storing plaintext `email` in audit `metadataJson`; minimize PII in audit metadata.
- **Status:** RISK (P1, open) · **Type:** Security · **Reason:** PII accumulation in audit store. · **Existing-fn:** Audit writes. · **Prod-data:** Existing rows may contain email. · **Platform:** Backend. · **Dependencies:** SEC-W2.

### SEC-W9 — `trust proxy` unconditional (P2)

- **Decision:** Review/condition `trust proxy=true` so `X-Forwarded-For` is trusted only behind a known proxy.
- **Status:** RISK (P2, open) · **Type:** Security · **Reason:** Spoofable IP weakens throttle/audit if exposed without a trusted proxy. · **Existing-fn:** Throttle/audit IP. · **Platform:** Backend. · **Dependencies:** SEC-W2.

### SEC-KI1 — Group-key `versionId` ignored (P2, pre-existing)

- **Decision:** Fix `GET /groups/:id/keys/me?versionId=` (backend ignores the param, serves ACTIVE) so post-rotation history is decryptable for new members / after logout; prerequisite for ROT-1 and further encrypted domains.
- **Status:** RISK (P2, open) · **Type:** Engineering + Security · **Reason:** Documented KI-1; rotation history gap. · **Existing-fn:** Group history decryption. · **Prod-data:** None. · **Platform:** All. · **Dependencies:** ROT-1.

> **⟳ SEC-KI1 STATUS CORRECTION — 2026-08-13 (additive; the entry above is preserved as the historical finding, not rewritten).** Repository verification ([FINMATE_SEC_KI1_VERIFICATION.md](FINMATE_SEC_KI1_VERIFICATION.md)) established that the canonical group-key `versionId` path is **honored end-to-end** — fixed **2026-07-17** on branch `Expense-module0a` (`gap-tracker.md` ENC-002/EXP-002/EXP-003 = Done). `GET /groups/:id/keys/me?versionId=` serves the **requested** version; **SUPERSEDED** versions remain available; **REVOKED** is rejected; caller-specific wrapped keys are returned; and **historical canonical expenses remain decryptable after normal rotation** (unit-tested: `groups.service.spec.ts:1289/1210/1335/1344`). **Previous status:** P2 OPEN (prerequisite). **Verified status:** MITIGATED. **M-KEYVER = VERIFY-ONLY** — no migration, no historical re-encryption, no key rotation, no schema/production change, no rollback (nothing changes). **Residual (distinct, display-only, NOT canonical data loss):** GRP-007 — group history-log entries snapshot ciphertext titles into `audit_logs.metadataJson` without a version stamp → placeholder after rotation. **Separate, still-open items (not decided here):** GRP-005 (leaver retains cached wrapped key), legacy **NULL-`versionId`** rows (REQUIRES PRODUCTION VERIFICATION), and **REVOKED semantics** — all **[PRODUCT/SECURITY DECISION REQUIRED]**. The invariant _"historical encrypted data must remain decryptable after normal key rotation"_ remains **required** and is verified satisfied. _(This is a status correction, not a new decision.)_

### OPS-1 — Current production DB-access exposure (RISK)

- **Decision:** Record that production DB credentials currently permit reading plaintext Zone-2 finance data (amounts, balances, P2P graph, category). E2EE protects titles/notes, not Zone-2. Mitigate with least-privilege prod creds + access audit (ACC-1); residual is inherent to Zone-2 server-readability.
- **Status:** RISK (P1, open) · **Type:** Security + Ops · **Reason:** Insider-threat; not solved by policy alone. · **Existing-fn:** Ops. · **Prod-data:** Read exposure. · **Platform:** Backend/ops. · **Dependencies:** ACC-1, Z-2.

---

## 15. Reconciliation report (against all prior rounds)

**Method:** cross-checked the original vision brief (§1–58 + §59), Round 1 report, Round 2A/2B decisions, Round 3 adversarial review, the final compatibility review, the "forgotten items" audit, and the Q1–Q10 confirmations.

**Recovered items explicitly restored (had dropped from an earlier checklist):**

- **SEC-W7** (audit-log email) — dropped after Round 1, restored.
- **SEC-W6c** (attachment `originalName` duplication) — the unresolved third of W6, restored.
- **SEC-KI1** (group-key `versionId` bug) — only ever a "prerequisite," now tracked.
- **B-3** (full field inventory) — never scoped before; now the first documentation task.
- **RGT-1/RGT-2/RGT-3** (rectification/restriction, "what we know," AI memory) — raised in vision, unratified until Q1–Q3.
- **ACC-1/OPS-1** (break-glass + current access risk), **CNT-1/CNT-2** (contacts), **CARD-1** (card/statement), **CERT-1** (certifications) — from the forgotten-items audit, now ratified.

**Adversarial additions carried in:** INT-4 (N1), WARD-1 (N2), AU-4 (N3), DEL-3 (N4), CNT-2 (N5).

**Contradictions found:** **None unresolved.** The historically sharpest tensions were resolved and are preserved here, not silently changed:

- E2EE-vs-server-analysis for wellbeing → resolved by two key classes (K-1/K-2) + hybrid zone 1b (Z-1); mood used for analysis is Class-2 server-managed (not E2EE) — consistent, no contradiction.
- HKDF vs crypto-shred → resolved to random wrapped keys (K-1), superseding the earlier HKDF suggestion (this supersession is recorded, not silent).
- "Instant crypto-shred" vs backups → reconciled by K-4 + RET-1 (no over-claim).
- Consent-laundering via async bus → resolved by ISO-4.
- Suppression deleted by withdrawal cycle → resolved by INT-4.
- Auth topology unknown → resolved by AU-2 (same-site, Lax).

**Nothing appears lost or contradicted at freeze.** The only intentionally-unfinished value is **RET-1** (retention number, parametric pending infra mapping) — recorded as such, not an omission.

**Intentionally DEFERRED (not lost):** full break-glass workflow (ACC-1), passwordless-E2EE decoupling (AU-3/future OMR-1), history re-encryption / retroactive revocation (ROT-1), merchant-level AI insights (AI-4), model-improvement/anonymization pipeline (TRN-1 future), blind-index search on encrypted fields, certifications (CERT-1).

---

---

## 16. Document #2 Back-port Addendum — 2026-08-12

**Nature:** Additive only. This addendum records decisions discovered/locked while producing Document #2 ([FINMATE_DATA_CLASSIFICATION_ENCRYPTION_MATRIX.md](FINMATE_DATA_CLASSIFICATION_ENCRYPTION_MATRIX.md), FROZEN). **No existing locked decision (§0–§15) is modified, superseded, or reinterpreted.** The original ledger history above is preserved verbatim. **No code, schema, migration, encryption, API, or production change has been implemented** — these are decisions only. Legal/GDPR classification is marked **[COUNSEL]** exactly where Document #2 marks it.

### PRIN-1 — Least-Protective-Mechanism Principle

- **Decision:** Use the **least protective mechanism that safely satisfies the actual security/privacy requirement** — E2EE where server access is unnecessary; server-managed encryption where server analysis is required; plaintext-but-protected where server functionality genuinely needs readable values; hashing for secrets; minimize/do-not-store where storage is unnecessary. Do **not** encrypt everything by default.
- **Status:** LOCKED · **Type:** Product + Security · **Reason:** Prevent both over-encryption that breaks functionality (GOV-2) and under-protection. · **Security/Privacy impact:** Right-sized protection; governance principle. · **Existing-fn:** None (principle). · **Prod-data:** None. · **Migration/Rollback:** n/a · **Platform:** All · **Dependencies:** Consistent with Z-2, K-1/K-2/K-3; governs FLD-1..FLD-7. · **Source:** Doc #2 §3.

### FLD-1 — `settlements.note`

- **Decision:** **E2EE for new records** (group-scoped/shared key model); legacy plaintext temporarily supported via explicit **mixed-state** discriminator; **no destructive migration**.
- **Status:** LOCKED (arch); **[COUNSEL]** (GDPR classification of note content) · **Type:** Engineering + Counsel · **Reason:** Free-text personal content; server access unnecessary → PRIN-1 selects E2EE; parity with `expense.description`. · **Security/Privacy impact:** Removes server plaintext exposure of settlement notes. · **Existing-fn:** Additive; all readers/export/history must branch on the marker (KI-1 class). · **Prod-data:** **Yes.** · **Migration:** Additive discriminator column + client-side opportunistic backfill; permanent mixed-state; non-destructive. · **Rollback:** Plaintext read-branch retained; stop writing encrypted. · **Platform:** All · **Dependencies:** B-2 pattern, K-1. · **Source:** Doc #2 §5A/FLD-1, §6, §13, §14.

### FLD-2 — `groups.description`

- **Decision:** **E2EE for new records**; legacy plaintext **mixed-state** compatibility; **must not break invite/pre-join behavior**; pre-join display remains **[ENG-UNKNOWN]** until verified.
- **Status:** LOCKED (arch); **[ENG-UNKNOWN]** (pre-join preview surface); **[COUNSEL]** (classification) · **Type:** Engineering + Counsel · **Reason:** Free-text group content; server access unnecessary → PRIN-1 E2EE. · **Security/Privacy impact:** Protects group description. · **Existing-fn:** Additive; must not break member group display; if `description` is shown pre-join to non-members, that surface must degrade gracefully (hide pre-join), not break. · **Prod-data:** **Yes.** · **Migration:** Additive discriminator + client backfill; non-destructive. · **Rollback:** Plaintext read-branch retained. · **Platform:** All · **Dependencies:** Group data key, B-2 pattern. · **Source:** Doc #2 §5A/FLD-2.

### FLD-3 — `groups.name`

- **Decision:** **Plaintext-but-protected**; group-scoped authorization; **no external AI by default**; do not log unnecessarily.
- **Status:** LOCKED (arch); **[COUNSEL]** where a name is personal/sensitive in context · **Type:** Engineering + Security · **Reason:** Functional display/identifier (UI, navigation, references, search/notifications) → server must read it; PRIN-1 selects plaintext-but-protected; E2EE would redesign group functionality (GOV-1/GOV-2). · **Security/Privacy impact:** Authorization + domain scoping; OPS-1 residual (DBA plaintext read). · **Existing-fn:** **Preserved (no change).** · **Prod-data:** Yes → **no migration.** · **Migration:** None. · **Rollback:** n/a · **Platform:** All · **Dependencies:** OPS-1. · **Source:** Doc #2 §5A/FLD-3.

### FLD-4 — `group_members.nickname`

- **Decision:** **Plaintext-but-protected**, group-scoped; **no external AI by default**; not exposed outside authorized group/member contexts.
- **Status:** LOCKED (arch); **[COUNSEL]** as personal data · **Type:** Engineering + Security · **Reason:** Cosmetic display name in member lists/search/UI → server must read it (PRIN-1). · **Security/Privacy impact:** Group-scoped authz. · **Existing-fn:** **Preserved.** · **Prod-data:** Yes → **no migration.** · **Migration:** None. · **Rollback:** n/a · **Platform:** All · **Dependencies:** —. · **Source:** Doc #2 §5A/FLD-4.

### FLD-5 — `profiles.monthlyIncome` (and `monthlyBudget`)

- **Decision:** **Server-readable sensitive financial data** — plaintext-but-protected with **strict access control**; **raw value must not be sent to external AI**; only a **minimum-necessary derived projection** may be used where permitted.
- **Status:** LOCKED (arch); **[COUNSEL]** (financial personal data; personalization legal basis) · **Type:** Engineering + Security + Counsel · **Reason:** Required for FinMate calculations/personalization where the user enabled the processing → server needs the value; PRIN-1 selects plaintext-but-protected (field-level at-rest encryption only if a concrete threat later justifies it). · **Security/Privacy impact:** Strict access + consent-gated personalization; OPS-1 residual. · **Existing-fn:** **Preserved.** · **Prod-data:** Yes → **no data migration** (access-tightening + consent-gating only). · **Migration:** None (governance). · **Rollback:** n/a · **Platform:** All · **Dependencies:** Z-2, CON-3, AI-1/AI-2, OPS-1. · **Source:** Doc #2 §5A/FLD-5.

### FLD-6 — `attachments.originalName`

- **Decision:** **Minimize exposure.** New uploads reference the file by a **safe internal storage identifier** (`storageKey`); a retained user-visible filename is **encrypted/protected** via the attachment content model; **never log** the original filename. **SEC-W6c remains an open security work item.**
- **Status:** LOCKED (arch); cross-ref RISK **SEC-W6c** · **Type:** Engineering + Security · **Reason:** Plaintext filename can leak content → PRIN-1 minimization + E2EE-where-server-doesn't-need-it. · **Security/Privacy impact:** Removes plaintext filename for new uploads. · **Existing-fn:** Existing attachments must remain readable. · **Prod-data:** **[ENG-UNKNOWN]** (backend upload path is roadmap). · **Migration:** Stop populating plaintext `originalName` for new uploads; keep/read existing during transition; resolve the plaintext/encrypted duplication (SEC-W6c) before attachments GA; non-destructive. · **Rollback:** Re-enable plaintext population. · **Platform:** All · **Dependencies:** SEC-W6c, Z-3. · **Source:** Doc #2 §5A/FLD-6.

### FLD-7 — `group_invites.invitedEmail`

- **Decision:** **Plaintext-but-protected** personal data; server-readable **only for invitation functionality**; **retention-limited**; **no AI/personalization/intelligence access**.
- **Status:** LOCKED (arch); **[COUNSEL]** (personal data, possibly of non-users) · **Type:** Engineering + Security + Counsel · **Reason:** Invite delivery/lookup needs the address server-side (PRIN-1). · **Security/Privacy impact:** Strict access + retention limit. · **Existing-fn:** **Preserved** (invitation flows unchanged). · **Prod-data:** Yes → **no storage migration**; add retention purge. · **Migration:** Additive retention purge (e.g., on accepted/expired invite); non-destructive; must not break existing invitation flows. · **Rollback:** Disable purge job. · **Platform:** All · **Dependencies:** CNT-1. · **Source:** Doc #2 §5A/FLD-7.

### Addendum reconciliation (2026-08-12)

- **Added:** 8 new LOCKED items — **PRIN-1, FLD-1, FLD-2, FLD-3, FLD-4, FLD-5, FLD-6, FLD-7.**
- **Updated ledger totals:** 71 → **79 items**; LOCKED 56 → **64**.
- **Counsel-flagged among new items:** FLD-1, FLD-2, FLD-3 (contextual), FLD-4 (contextual), FLD-5, FLD-7.
- **Engineering-unknown nested:** FLD-2 (pre-join display), FLD-6 (existing prod rows).
- **New production-data migration candidates:** FLD-1 (E2EE backfill), FLD-2 (E2EE backfill), FLD-7 (retention purge), FLD-6 (dedup). **No migration:** FLD-3, FLD-4, FLD-5.
- **Supersessions:** **None.** No prior LOCKED/DEFERRED/COUNSEL/ENGINEERING/RISK item was modified or replaced.
- **Contradictions:** **None** — verified each new item against §0–§15; all are additive and consistent (PRIN-1 aligns with Z-2/K-1/K-2/K-3/GOV-2; FLD-1/2 follow the B-2 mixed-state pattern; FLD-3/4/5/7 follow Z-2 plaintext-but-protected; FLD-6 follows Z-3 + SEC-W6c).
- **Implementation state:** nothing implemented — decisions only.

---

_End of Frozen Decision Ledger. Change control: any modification to a LOCKED item requires a new dated entry here plus an ADR. This ledger governs the documents that follow it in the stack._
