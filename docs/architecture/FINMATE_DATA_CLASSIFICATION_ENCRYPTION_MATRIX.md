# FinMate — Data Classification & Encryption Matrix (B-3)

**Governing document:** [FINMATE_DECISION_LEDGER.md](FINMATE_DECISION_LEDGER.md) (frozen source of truth).
**Nature:** Analysis + documentation only. Authorises no code, schema, migration, encryption, API, or production change.
**Method:** Every field's **CURRENT** state was read from the actual repository (TypeORM entities in `shared/data-models/src/lib/*`, migrations, services, `main.ts`, interceptors, and the existing audit docs). Product-vision fields that do not exist in code are **not** inventoried as current; they appear only under §10 (new domains) where the ledger already defines them.

### Statement-type legend (mandatory tagging)
- **[CURRENT FACT]** — verified in the repository as it exists today.
- **[TARGET]** — target architecture per the frozen ledger.
- **[REQUIREMENT]** — an engineering invariant the target imposes.
- **[ENG-UNKNOWN]** — needs engineering verification before matrix freeze.
- **[COUNSEL]** — legal validation required.

---

## 1. Purpose

Produce a complete, evidence-based inventory of FinMate's current stored data model and classify every relevant field, so the Security & Privacy Architecture and Encryption design (Documents #3+) are built on facts, not assumptions — and so no existing production field is silently re-encrypted or broken. This is the execution of ledger item **B-3** (the first documentation task).

## 2. Scope

**In scope:** all persisted TypeORM entities; server-side encryption utilities; Redis session/token structures; frontend key persistence (IndexedDB/memory); logging/audit; notification payloads; object storage references. **Out of scope:** implementing anything; new-domain schemas (classified only where the ledger defines them); legal conclusions (marked [COUNSEL]).

## 3. Classification definitions

Two orthogonal axes (per ledger GOV-5 and the USER/IP/PUBLIC axis).

**Sensitivity class:**
| Class | Meaning |
|---|---|
| **PUBLIC** | Non-sensitive, safe to expose. |
| **INTERNAL** | Operational metadata; low harm if leaked. |
| **PERSONAL** | Identifies/relates to a person (GDPR personal data). |
| **SENSITIVE** | Personal data whose leak causes real harm (financial, free-text content, relationships). |
| **SPECIAL_CATEGORY** | GDPR Art. 9 (health/mood/biometric/etc.). **None in current production.** |
| **SECURITY_SECRET** | Credentials, hashes, key material, tokens. |
| **FINMATE_CONFIDENTIAL** | Company IP (not a stored user field; tracked in IP-1/IP-2). |

**Zone (ledger Z-1):** 1a (opaque E2EE) · 1b (server-readable sensitive) · 2 (protected plaintext for computation) · 3 (isolated module). CORE auth/security fields sit outside the zones as SECURITY_SECRET.

**PRIN-1 — Least protective mechanism (new architectural principle).** Use the **least protective mechanism that safely satisfies the actual security/privacy requirement**, not the strongest available:
- **E2EE** where server access is genuinely unnecessary;
- **server-managed encryption** where server-side analysis is required;
- **plaintext-but-protected** where server functionality genuinely needs readable values (Zone 2);
- **hashing** for secrets;
- **minimization / do-not-store** where storage is unnecessary.
Do **not** encrypt everything by default. This principle is consistent with the frozen ledger (Z-2, K-2, K-3) and governs the FLD-1..FLD-7 decisions below.
> **[REQUIREMENT — governance]** PRIN-1 and FLD-1..FLD-7 are **new LOCKED product/architecture decisions** made in this review. They are recorded here in Document #2; per the freeze rule they must be **back-ported into `FINMATE_DECISION_LEDGER.md` as new dated entries** (the ledger was **not** modified in this task, per instruction). This is a pending governance action, not a contradiction.

---

## 4. Current architecture inventory (summary of facts)

- **[CURRENT FACT]** ORM: single TypeORM datasource, all tables in the default `public` schema (no schema/role isolation yet — ledger ISO-1 is target).
- **[CURRENT FACT]** Two encryption systems: (a) **client-side E2EE** (Web Crypto, PBKDF2 master key + per-group AES-256-GCM keys, RSA-OAEP wrapping) for expense/note/recurring free-text and attachment file keys; (b) **server-side `EncryptionService`** (AES-256-GCM, key = SHA-256(`ENCRYPTION_KEY`)) used **only** for 2FA secrets and `profile.avatarUrl`.
- **[CURRENT FACT]** Key material tables: `encrypted_group_keys` (legacy, master-wrapped), `member_wrapped_group_keys` (versioned), `group_key_versions` (rotation state machine), `encrypted_expense_keys` (direct-shared per-participant). Server never holds plaintext keys.
- **[CURRENT FACT]** Redis holds: refresh sessions (`refresh_token:{userId}:{sha256(refreshId)}` → argon2 hash of refreshId), `email_verify:{token}`→userId, `pwd_reset:{token}`→userId, throttle counters.
- **[CURRENT FACT]** Frontend: master key cached in **IndexedDB** (`ZkKeyVaultService`, non-extractable CryptoKey) + memory; group keys **session-memory only**; legacy `localStorage['finmate_ai_opt_in']`; access token in memory; **refresh token currently returned in response body** (SEC-W3).
- **[CURRENT FACT]** No object storage / attachment upload backend is implemented (attachment entity exists; storage path is roadmap). 4 encrypted-image blobs are committed in git history (SEC-W1).
- **[CURRENT FACT]** No AI-derived data, no INTELLIGENCE store, no wellbeing/wardrobe/journal data exists (all target/new domains).

---

## 5. Entity/field classification matrix (CURRENT FACT)

Columns: Field · Type · Null · Current protection · Class · P=Personal S=Special F=Financial K=Security U=User-content R=Relationship/shared D=Derived · Prod-data exists?
Metadata columns (`id` PK, `version`, `createdAt`, `updatedAt`, `deletedAt`) are INTERNAL and omitted per-row except where noteworthy.

### 5.1 CORE — `users`
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| email | varchar(255) uniq | N | plaintext | PERSONAL | P | Yes |
| username | varchar(50) uniq | Y | plaintext | PERSONAL | P | Yes |
| phoneNumber | varchar(20) uniq | Y | plaintext | PERSONAL | P | Yes |
| passwordHash | varchar(255) | N | **argon2 hash** | SECURITY_SECRET | K | Yes |
| displayName | varchar(120) | Y | plaintext | PERSONAL | P | Yes |
| status | varchar(20) | N | plaintext | INTERNAL | — | Yes |
| emailVerified | bool | N | plaintext | INTERNAL | — | Yes |
| lastLoginAt | timestamptz | Y | plaintext | INTERNAL | P | Yes |
| twoFactorSecret | varchar(255) | Y | **server AES-256-GCM** | SECURITY_SECRET | K | Yes |
| isTwoFactorEnabled | bool | N | plaintext | INTERNAL | — | Yes |
| aiOptIn | bool | N | plaintext | INTERNAL (consent) | — | Yes |
| publicWrappingKey | text | Y | plaintext (public key) | INTERNAL | K | Yes |
| encryptedPrivateWrappingKey | text | Y | **E2EE (master-wrapped)** | SECURITY_SECRET | K | Yes |
| recoveryWrappedKey | text | Y | **E2EE (recovery-wrapped)** | SECURITY_SECRET | K | Yes |
| recoveryKeyCreatedAt | timestamptz | Y | plaintext | INTERNAL | — | Yes |

### 5.2 CORE — `profiles`
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| avatarUrl | text | Y | **server AES-256-GCM** (undocumented drift) | PERSONAL | P | Yes |
| locale | varchar(10) | N | plaintext | INTERNAL | — | Yes |
| timezone | varchar(64) | N | plaintext | PERSONAL | P | Yes |
| defaultCurrency | char(3) | N | plaintext | INTERNAL | F | Yes |
| **monthlyBudget** | decimal(12,2) | Y | plaintext | **SENSITIVE** | F,P | Yes |
| **monthlyIncome** | decimal(12,2) | Y | plaintext | **SENSITIVE** | F,P | Yes |

> **Finding:** `monthlyIncome`/`monthlyBudget` are plaintext financial personal data (Zone 2). Legitimately server-readable for budgeting math, but income is high-sensitivity — flag for access-tightening, not encryption.

### 5.3 FINANCE — `expenses`
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| title | text | N | **E2EE (client)** | SENSITIVE (Zone 1a) | U,P | Yes |
| description | text | Y | **E2EE (client)** | SENSITIVE (Zone 1a) | U,P | Yes |
| amountTotal | decimal(12,2) | N | plaintext | SENSITIVE (Zone 2) | F | Yes |
| currency | char(3) | N | plaintext | INTERNAL | F | Yes |
| category | varchar(64) | N | plaintext | SENSITIVE (Zone 2) | F | Yes |
| transactionType | varchar(20) | N | plaintext | INTERNAL | F | Yes |
| expenseDate | date | N | plaintext | SENSITIVE (Zone 2) | F | Yes |
| status | varchar(20) | N | plaintext | INTERNAL | — | Yes |
| ledgerMonth | char(7) | Y | plaintext | INTERNAL | — | Yes |
| isCarryForward | bool | N | plaintext | INTERNAL | — | Yes |
| encryptionScope | varchar(20) | N | plaintext | INTERNAL | — | Yes |
| paidByUser/paidByGroupMember/ownerUser/group/groupKeyVersion | FK | mixed | plaintext refs | SENSITIVE (Zone 2, R) | R,F | Yes |

### 5.4 FINANCE — `expense_splits`
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| splitType | varchar(16) | N | plaintext | INTERNAL | — | Yes |
| shareValue | decimal(12,4) | N | plaintext | SENSITIVE (Zone 2) | F | Yes |
| amountOwed | decimal(12,2) | N | plaintext | SENSITIVE (Zone 2) | F,R | Yes |
| isSettled/settledAt | bool/ts | mixed | plaintext | INTERNAL | — | Yes |
| participantUser/participantGroupMember | FK | XOR | plaintext refs | SENSITIVE (R) | R | Yes |

### 5.5 FINANCE — `expense_payments`
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| amount | decimal(12,2) | N | plaintext | SENSITIVE (Zone 2) | F | Yes |
| paidByUser/paidByGroupMember | FK | XOR | plaintext refs | SENSITIVE (R) | R | Yes |

### 5.6 FINANCE — `settlements`
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| amount | decimal(12,2) | N | plaintext | SENSITIVE (Zone 2) | F,R | Yes |
| currency | char(3) | N | plaintext | INTERNAL | F | Yes |
| status | varchar(20) | N | plaintext | INTERNAL | — | Yes |
| settledOn | date | Y | plaintext | INTERNAL | F | Yes |
| **note** | text | Y | **plaintext** | **SENSITIVE (Zone 1a-candidate)** | U,P | Yes |
| from/to User/GroupMember | FK | CHECK | plaintext refs | SENSITIVE (R) | R | Yes |

> **Finding (gap):** `settlement.note` is free-text plaintext — structurally identical to `expense.description` (which **is** E2EE). Not covered by any locked decision. See §16/§20.

### 5.7 FINANCE / People — `direct_ledger_entries` (P2P)
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| entryType | varchar(16) | N | plaintext | INTERNAL | — | Yes |
| amount | decimal(12,2) | N | plaintext | SENSITIVE (Zone 2) | F,R | Yes |
| currency | char(3) | N | plaintext | INTERNAL | F | Yes |
| **note** | text | Y | **plaintext (CURRENT)** → **E2EE `direct_shared` (TARGET B-2)** | SENSITIVE (Zone 1a) | U,P | **Yes** |
| occurredOn | date | N | plaintext | INTERNAL | F | Yes |
| fromUser/toUser/createdByUser | FK | N | plaintext refs | SENSITIVE (R) | R | Yes |

### 5.8 FINANCE — `recurring_expenses` (+ `recurring_expense_splits` [ENG-UNKNOWN exact cols; mirrors expense_splits])
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| title | text | N | **E2EE (client)** | SENSITIVE (Zone 1a) | U,P | [ENG-UNKNOWN — recurring beta] |
| description | text | Y | **E2EE (client)** | SENSITIVE (Zone 1a) | U,P | [ENG-UNKNOWN] |
| amountTotal | decimal(12,2) | N | plaintext | SENSITIVE (Zone 2) | F | [ENG-UNKNOWN] |
| currency/category/dates/frequency/status | mixed | mixed | plaintext | SENSITIVE/INTERNAL (Zone 2) | F | [ENG-UNKNOWN] |

### 5.9 GROUPS — `groups`
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| **name** | varchar(120) | N | **plaintext** | **SENSITIVE (Zone 1a-candidate)** | U,P | Yes |
| **description** | text | Y | **plaintext** | **SENSITIVE (Zone 1a-candidate)** | U,P | Yes |
| visibility/currency/groupType/carryForwardEnabled/isArchived | mixed | mixed | plaintext | INTERNAL | — | Yes |
| inviteToken | uuid uniq | Y | plaintext (capability token) | SECURITY_SECRET | K | Yes |
| ownerUser | FK | N | plaintext ref | SENSITIVE (R) | R | Yes |

> **Finding (gap):** `group.name`/`group.description` are plaintext free-text (e.g., "Divorce lawyer fund"). Not covered by any locked decision.

### 5.10 GROUPS — `group_members`
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| **nickname** | varchar(120) | Y | **plaintext** | **PERSONAL/SENSITIVE-candidate** | U,P | Yes |
| role/joinStatus | varchar(20) | N | plaintext | INTERNAL (authz) | — | Yes |
| joinedAt/leftAt | ts | Y | plaintext | INTERNAL | — | Yes |
| user/contact | FK | ≥1 | plaintext refs | SENSITIVE (R) | R,P | Yes |

### 5.11 GROUPS — `group_member_contributions`
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| ledgerMonth | char(7) | N | plaintext | INTERNAL | — | Yes |
| percentage | decimal(5,2) | N | plaintext | SENSITIVE (Zone 2) | F | Yes |

### 5.12 GROUPS — `group_invites`
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| inviteToken | uuid uniq | N | plaintext (capability) | SECURITY_SECRET | K | Yes |
| **invitedEmail** | varchar(255) | Y | plaintext | PERSONAL | P | Yes |
| wrappedGroupKey | text | Y | **E2EE (TIK/PWK-wrapped)** | SECURITY_SECRET | K | Yes |
| status/expiresAt | mixed | Y | plaintext | INTERNAL | — | Yes |

### 5.13 CONTACTS — `contacts` (third-party PII)
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| **email** | varchar(255) | Y | plaintext | PERSONAL (3rd-party) | P | Yes |
| **phoneNumber** | varchar(20) | Y | plaintext | PERSONAL (3rd-party) | P | Yes |
| **displayName** | varchar(120) | Y | plaintext | PERSONAL (3rd-party) | P | Yes |
| status | varchar(20) | N | plaintext | INTERNAL | — | Yes |
| createdByUser/claimedByUser/mergedIntoContact/mergedByUser | FK | mixed | plaintext refs | INTERNAL (R) | R | Yes |

> **Finding:** Contacts store **non-user** PII with no data-subject consent. Governed by ledger **CNT-1/CNT-2** ([COUNSEL] for basis + non-user rights).

### 5.14 PRIVATE/GROUP — `notes`
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| title | text | N | **E2EE (client)** | SENSITIVE (Zone 1a) | U,P | [ENG-UNKNOWN feature/data] |
| body | text | N | **E2EE (client)** | SENSITIVE (Zone 1a) | U,P | [ENG-UNKNOWN] |
| visibility | varchar(20) | N | plaintext | INTERNAL | — | [ENG-UNKNOWN] |

### 5.15 GOALS — `goals` (table deployed; **no write path/endpoints → effectively empty**)
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| title | varchar(160) | N | **plaintext (CURRENT)** → **E2EE (TARGET B-1)** | SENSITIVE (Zone 1a) | U,P | **No (empty)** |
| targetAmount/savedAmount | decimal(12,2) | N | plaintext | SENSITIVE (Zone 2) | F | No |
| currency/targetDate/status | mixed | mixed | plaintext | INTERNAL/Zone 2 | F | No |

> **Finding:** `goal.title` is `varchar(160)` — too small for ciphertext; B-1 requires widening to `text` (empty table → safe).

### 5.16 ATTACHMENTS — `attachments` (backend upload path = roadmap; likely no prod data)
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| storageKey | text | N | plaintext (opaque ref) | INTERNAL | — | [ENG-UNKNOWN] |
| **originalName** | varchar(255) | N | **plaintext** | SENSITIVE (Zone 1a) | U,P | [ENG-UNKNOWN] |
| mimeType | varchar(128) | N | plaintext | INTERNAL | — | [ENG-UNKNOWN] |
| sizeBytes | bigint | N | plaintext | INTERNAL | — | [ENG-UNKNOWN] |
| checksumSha256 | char(64) | Y | hash | INTERNAL | — | [ENG-UNKNOWN] |
| encryptedFileKey | text | Y | **E2EE (scope-wrapped)** | SECURITY_SECRET | K | [ENG-UNKNOWN] |
| **encryptedOriginalName** | text | Y | **E2EE** | SENSITIVE (Zone 1a) | U | [ENG-UNKNOWN] |

> **Finding (SEC-W6c):** `originalName` (plaintext) **and** `encryptedOriginalName` (E2EE) both exist — the plaintext copy defeats the encrypted one.

### 5.17 KEY MATERIAL — `encrypted_group_keys`, `member_wrapped_group_keys`, `encrypted_expense_keys`, `group_key_versions`
| Entity.Field | Protection | Class | Prod? |
|---|---|---|---|
| encrypted_group_keys.wrappedKey | **E2EE (master-wrapped groupDataKey)** | SECURITY_SECRET (K) | Yes |
| member_wrapped_group_keys.wrappedGroupKey | **E2EE (versioned, master/RSA-wrapped)** | SECURITY_SECRET (K) | Yes |
| member_wrapped_group_keys.wrappingAlgorithm / publicKeyFingerprint | plaintext metadata | INTERNAL | Yes |
| encrypted_expense_keys.wrappedKey | **E2EE (direct-shared content key, per-participant)** | SECURITY_SECRET (K) | Yes |
| group_key_versions.version/algorithm/status/rotatedAt | plaintext | INTERNAL | Yes |
| group_key_versions.rotationReason | plaintext free-text | INTERNAL (minor U) | Yes |

### 5.18 AUDIT — `audit_logs`
| Field | Type | Null | Protection | Class | Flags | Prod? |
|---|---|---|---|---|---|---|
| action/entityType/entityId/scope | mixed | N | plaintext | INTERNAL | — | Yes |
| requestId | varchar(64) | Y | plaintext | INTERNAL | — | Yes |
| ipHash | varchar(128) | Y | **SHA-256 hash** | INTERNAL | P (pseudonymized) | Yes |
| **metadataJson** | jsonb | Y | plaintext (**contains `email`** on auth events) | PERSONAL/SENSITIVE | P | Yes |
| actorUser/group | FK | Y | plaintext ref | PERSONAL (R) | P,R | Yes |

> **Finding (SEC-W7):** `metadataJson` stores plaintext `email` on `auth.login_success`.

### 5.19 HISTORY/VERSION tables — `expense_versions`, `expense_split_versions`, `settlement_versions`, `attachment_versions`, `receipt_versions`
- **[ENG-UNKNOWN]** exact columns not individually read this pass. **[REQUIREMENT]** they are point-in-time snapshots and **inherit the parent field's classification and protection** (encrypted parent fields must remain ciphertext in snapshots; plaintext-sensitive parents carry the same gaps). The encryption audit already flagged that audit/version metadata stores **ciphertext titles without a version stamp** (KI-1 rotation caveat). Verify exact columns before matrix freeze.

---

## 5A. Resolved existing-field classifications (FLD-1..FLD-7 — new LOCKED decisions)

These seven fields were flagged as uncovered gaps in the first pass. Product/architecture decisions are now recorded, applying **PRIN-1**. Each separates the **technical protection decision** from the **legal/GDPR classification** ([COUNSEL] where noted). None contradicts a frozen ledger item.

### FLD-1 — `settlements.note`
- **CURRENT:** `text`, nullable, **plaintext**; production data exists.
- **TARGET:** **E2EE for new records**; legacy plaintext retained via an explicit discriminator (mixed-state), reusing the **B-2 pattern**.
- **REASON:** free-form personal content; server access unnecessary → PRIN-1 selects E2EE. Structurally identical to `expense.description` (already E2EE).
- **ACCESS:** settlement parties / group members holding the key; **backend cannot read plaintext**.
- **ENCRYPTION:** E2EE. **[REQUIREMENT]** settlements are always group-scoped (`group` NOT NULL in repo) → natural key domain is the group's existing **versioned group data key**; final key-domain choice (group key vs per-entry) confirmed in Document #3. Marker: `legacy_plaintext` vs `encrypted`.
- **AI ACCESS:** none (free-text; AI-2 numeric-only).
- **PRODUCTION DATA:** **Yes** → permanent mixed-state; no forced conversion.
- **MIGRATION:** additive nullable discriminator column; **client-side opportunistic re-encryption** on next key-holding session; **no destructive migration**.
- **ROLLBACK:** readers keep the plaintext branch; stop writing encrypted.
- **USER IMPACT:** none for existing history; new notes encrypted; some legacy notes stay plaintext permanently (users who never return).
- **LEGAL/COUNSEL:** technical protection decided; **[COUNSEL]** GDPR classification of note content.

### FLD-2 — `groups.description`
- **CURRENT:** `text`, nullable, **plaintext**; production data exists.
- **TARGET:** **E2EE for new records**; legacy plaintext via discriminator (mixed-state, B-2 pattern).
- **REASON:** free-form group content; server access unnecessary → PRIN-1 E2EE.
- **ACCESS:** group members holding the group key; **backend cannot read plaintext**.
- **ENCRYPTION:** E2EE with the **group's versioned data key** (members already receive it). Marker as FLD-1.
- **AI ACCESS:** none by default.
- **PRODUCTION DATA:** **Yes** → mixed-state.
- **MIGRATION:** additive discriminator + client backfill; non-destructive.
- **ROLLBACK:** plaintext branch retained.
- **USER IMPACT:** must not break group display for members. **[ENG-UNKNOWN]** verify whether `description` is shown in any **pre-join / invite-preview** context to non-members — E2EE would prevent server-rendered pre-join display; if such a surface exists it must degrade gracefully (hide description pre-join) rather than break.
- **LEGAL/COUNSEL:** technical decided; **[COUNSEL]** where description holds personal data.

### FLD-3 — `groups.name`
- **CURRENT:** `varchar(120)`, NOT NULL, **plaintext**; production data exists.
- **TARGET:** **plaintext-but-protected** (Zone 2). **Not E2EE.**
- **REASON:** functional display/identifier used by group UI, navigation, references, search/notifications → server must read it (PRIN-1 selects plaintext-but-protected). Forcing E2EE would redesign group functionality — prohibited (GOV-1/GOV-2).
- **ACCESS:** authorized group members + backend (authorization + domain scoping). **DBA plaintext read** — same OPS-1 residual.
- **ENCRYPTION:** none at field level; protected by authz, domain scoping, TLS, encrypted storage.
- **AI ACCESS:** **not sent to external AI unless specifically required and permitted**; never by default.
- **PRODUCTION DATA:** Yes → **no migration** (stays plaintext).
- **MIGRATION:** none. **ROLLBACK:** n/a.
- **USER IMPACT:** none; **do not log unnecessarily**.
- **LEGAL/COUNSEL:** **[COUNSEL]** if a name constitutes personal/sensitive data in context.

### FLD-4 — `group_members.nickname`
- **CURRENT:** `varchar(120)`, nullable, **plaintext**; production data exists.
- **TARGET:** **plaintext-but-protected and group-scoped**. Not E2EE.
- **REASON:** cosmetic display name in member lists/search/UI → server must read it (PRIN-1).
- **ACCESS:** authorized group/member contexts only; **not exposed outside the group**.
- **ENCRYPTION:** none at field level; authz + group scoping.
- **AI ACCESS:** **none by default**.
- **PRODUCTION DATA:** Yes → **no migration**.
- **MIGRATION:** none. **ROLLBACK:** n/a.
- **USER IMPACT:** none; must not break member lists/search/UI.
- **LEGAL/COUNSEL:** **[COUNSEL]** as personal data (a person's name/alias).

### FLD-5 — `profiles.monthlyIncome` (and `monthlyBudget`)
- **CURRENT:** `decimal(12,2)`, nullable, **plaintext** (Zone 2); production data exists.
- **TARGET:** **server-readable sensitive financial data** — plaintext-but-protected with **strict access control** and gated personalization use.
- **REASON:** required for FinMate financial calculations/personalization where the user enabled the relevant processing → server needs the value (PRIN-1 selects plaintext-but-protected, not E2EE; field-level at-rest encryption only if a concrete threat later justifies it — not required now).
- **ACCESS:** FINANCE domain service + owner; **strict access control**; DBA plaintext (OPS-1 residual). Personalization use gated by consent (CON-3).
- **ENCRYPTION:** none at field level (Zone 2). At-rest infra/storage encryption applies.
- **AI ACCESS:** **raw income never sent to external AI**; AI may receive only a **minimum-necessary derived projection** when permitted (AI-1/AI-2).
- **PRODUCTION DATA:** Yes → **no migration**.
- **MIGRATION:** none (access-tightening + consent-gating only). **ROLLBACK:** n/a.
- **USER IMPACT:** none.
- **LEGAL/COUNSEL:** **[COUNSEL]** financial personal data; legal basis for personalization use.

### FLD-6 — `attachments.originalName`
- **CURRENT:** `varchar(255)`, NOT NULL, **plaintext**, stored **alongside** `encryptedOriginalName` (SEC-W6c duplication); backend upload path is roadmap → likely no/low production data.
- **TARGET:** **minimize exposure**. New uploads reference the file by a **safe internal storage identifier** (`storageKey` already exists); a user-visible filename, if retained, is protected via the attachment content model (`encryptedOriginalName`, E2EE). **Deprecate/stop populating plaintext `originalName` for new uploads.** **Never log it.**
- **REASON:** plaintext filename can leak content; internal id + optional encrypted filename satisfies the requirement (PRIN-1 minimization + E2EE-where-unneeded-by-server).
- **ACCESS:** owner/authorized attachment context; server uses `storageKey`/`checksum` only.
- **ENCRYPTION:** E2EE for the user-visible name (`encryptedOriginalName`); plaintext copy removed for new uploads.
- **AI ACCESS:** none.
- **PRODUCTION DATA:** **[ENG-UNKNOWN]** existing rows (feature is roadmap); **existing attachments must remain readable**.
- **MIGRATION:** stop populating plaintext `originalName` for new uploads; keep/read existing plaintext during a transition; resolve the duplication (**SEC-W6c, P1**) before attachments GA. Non-destructive.
- **ROLLBACK:** re-enable plaintext population if needed.
- **USER IMPACT:** none visible (filename still displayed to the owner via the encrypted field).
- **LEGAL/COUNSEL:** minimal; **[COUNSEL]** only if filenames routinely carry personal data.

### FLD-7 — `group_invites.invitedEmail`
- **CURRENT:** `varchar(255)`, nullable, **plaintext**; production data exists.
- **TARGET:** **plaintext-but-protected personal data**, server-readable **only where required for invitation functionality**, with **strict access control** and **retention limits**.
- **REASON:** invite delivery/lookup needs the address server-side (PRIN-1 selects plaintext-but-protected).
- **ACCESS:** invitation flow + inviting user context; strict access control.
- **ENCRYPTION:** none at field level; authz + retention.
- **AI ACCESS:** **no AI / personalization / intelligence access**.
- **PRODUCTION DATA:** Yes → **no storage migration**; add retention purge.
- **MIGRATION:** add **retention limit** (e.g., purge on accepted/expired invite) — additive; must not break existing invitation flows. **ROLLBACK:** disable purge job.
- **USER IMPACT:** none.
- **LEGAL/COUNSEL:** **[COUNSEL]** personal data, possibly of non-users (ties to CNT-1).

---

## 6. Encryption matrix (CURRENT → TARGET)

| Data | CURRENT | TARGET | Ledger | Change? |
|---|---|---|---|---|
| expense/note/recurring title & description | E2EE (client) | **unchanged** | Z-3/K-3 | No |
| attachment file key & encryptedOriginalName | E2EE | unchanged | Z-3 | No |
| attachment `originalName` (plaintext dup) | plaintext | **drop plaintext or justify** | SEC-W6c | Yes (pre-GA) |
| group/expense/direct wrapped keys | E2EE (ZK) | unchanged | K-1/K-3 | No |
| amounts, splits, balances, dates, category, currency, contributions | plaintext-but-protected (Zone 2) | **unchanged** | Z-2 | No |
| 2FA secret, avatarUrl | server AES-256-GCM (global key) | unchanged (avatar: document the drift) | K-2/K-3 | No |
| passwordHash | argon2 | unchanged | — | No |
| **goal.title/free-text** | plaintext (empty) | **E2EE (born)** | B-1 | Yes (clean) |
| **direct_ledger.note** | plaintext (prod data) | **E2EE `direct_shared` + mixed-state** | B-2 | Yes (backfill) |
| **settlement.note** | plaintext (prod data) | **E2EE new + mixed-state** | **FLD-1** | Yes (backfill) |
| **group.description** | plaintext (prod data) | **E2EE new + mixed-state** | **FLD-2** | Yes (backfill) |
| **group.name** | plaintext (prod data) | **plaintext-but-protected** (functional identifier) | **FLD-3** | No |
| **group_member.nickname** | plaintext (prod data) | **plaintext-but-protected, group-scoped** | **FLD-4** | No |
| **profile.monthlyIncome/Budget** | plaintext (Zone 2) | **server-readable sensitive; plaintext-but-protected + strict access** | **FLD-5**/Z-2/OPS-1 | Access only |
| **invitedEmail** | plaintext (prod data) | **plaintext-but-protected + retention limit** | **FLD-7** | Retention only |
| contacts email/phone/displayName | plaintext | minimize + access-restrict (not E2EE) | CNT-1 | Governance |
| WELLBEING mood metrics (future) | n/a | **server-managed key (Class-2)** | K-2/A | New domain |
| journal / wardrobe photos (future) | n/a | **E2EE (Class-1)** | K-1 | New domain |

**[REQUIREMENT]** Do not encrypt Zone-2 numeric fields — computation depends on them (Z-2). Preserve all existing E2EE (K-3).

---

## 7. Access-control matrix (sensitive data)

Actors: Client (key-holder) · Backend service · DBA · Domain service · INTELLIGENCE · Analytics · External AI · Support/Admin.

| Data | Client | Backend | DBA | Domain svc | INTELLIGENCE | Analytics | Ext AI | Support/Admin |
|---|---|---|---|---|---|---|---|---|
| E2EE free-text (title/desc/notes/journal) | YES | **NO** | NO (ciphertext) | NO | NO | NO | NO | NO |
| Wrapped key material | YES (unwrap) | NO | NO (ciphertext) | NO | NO | NO | NO | NO |
| Amounts/splits/balances (Zone 2) | YES | YES | **YES (plaintext)** ⚠OPS-1 | YES (own domain) | CONDITIONAL (projection only) | CONDITIONAL (aggregates) | CONDITIONAL (numeric projection + consent) | CONDITIONAL (break-glass, ACC-1) |
| profile.income/budget | YES | YES | YES ⚠OPS-1 | FINANCE only | CONDITIONAL (projection) | NO | CONDITIONAL (projection+consent) | CONDITIONAL |
| 2FA secret / avatar (server-enc) | — | YES (decrypt) | NO (ciphertext) | AUTH only | NO | NO | NO | NO |
| passwordHash | — | YES (verify) | YES (hash only) | AUTH | NO | NO | NO | NO |
| Contacts PII (3rd-party) | YES (own) | YES | YES ⚠ | FINANCE/CONTACTS | **NO (CNT-1)** | NO | **NO (CNT-1)** | CONDITIONAL |
| WELLBEING mood (future, Class-2) | YES | CONDITIONAL (gated) | NO (encrypted) | WELLBEING only | CONDITIONAL (consent) | NO | NO (default) | CONDITIONAL |
| Derived/INTELLIGENCE (future) | YES (own) | CONDITIONAL | NO | NO cross-domain | YES (owner) | NO | CONDITIONAL (projection) | CONDITIONAL |

**CONDITIONAL gates:** projection/firewall (AI-1/AI-2), consent (CON-3/AI-5), DPIA flag (INT-3/DPIA-1), break-glass (ACC-1). **⚠OPS-1:** DBA/backend plaintext read of Zone-2 finance is the recorded residual insider exposure.

## 8. E2EE key-ownership matrix (Class-1, ledger K-1/K-3)

| Data | Key domain | Key holder | Who decrypts | Recovery | Shared users | Per-entry key? | Crypto-shred | Migration |
|---|---|---|---|---|---|---|---|---|
| Personal expense/note title/desc | personal (master, **CURRENT**) | user | owner only | recovery-wrapped priv key | no | no (master) | delete row + backup expiry (K-4) | none (K-3) |
| Group expense/note free-text | per-group data key (versioned) | members | active members | recovery via master-wrapped | yes | no (group key) | rotate/revoke (ROT-1) | none |
| Direct-shared expense free-text | per-expense content key | participants | participants | via master | yes | **per-entry** | drop wrapped keys | none |
| **goal free-text (TARGET)** | GOALS Class-1 key (random, wrapped master+recovery) | user | owner | recovery-wrapped | no | domain/per-entry | **yes** | none (clean) |
| **P2P note (TARGET B-2)** | per-entry `direct_shared` content key | both users | both registered users | via master+recovery | **yes** | **per-entry** | drop wrapped keys | **client backfill, mixed-state** |
| journal/wardrobe (future) | PRIVATE/WARDROBE Class-1 keys | user | owner | recovery-wrapped | no | domain/per-entry | yes | new |

**[REQUIREMENT]** Random keys wrapped under master **and** recovery (K-1); **no HKDF-derived keys** (would block crypto-shred). Recovery mandatory before storing Class-1 data (REC-1).

## 9. Server-managed encryption matrix (Class-2, ledger K-2)

| Data | Key | Scope | Access gate | Consent | Purpose | Services allowed | AI | Analytics | Deletion |
|---|---|---|---|---|---|---|---|---|---|
| 2FA secret (CURRENT) | global `ENCRYPTION_KEY` | app-wide | auth flow | n/a | MFA verify | AUTH only | NO | NO | delete row |
| avatarUrl (CURRENT drift) | global `ENCRYPTION_KEY` | app-wide | profile read | n/a | display | USERS | NO | NO | delete row |
| **WELLBEING mood metrics (TARGET)** | **per-user WELLBEING key (new store)** | per-user/domain | explicit gate | **explicit (Art. 9)** | wellbeing analysis | WELLBEING only | NO (default) | NO | **crypto-shred key** |
| **INTELLIGENCE derived (TARGET)** | per-user INTELLIGENCE key | per-user/domain | purpose gate | tiered (CON-3) | personalization | INTELLIGENCE | CONDITIONAL (projection) | NO | crypto-shred |

**[REQUIREMENT]** Class-2 uses a **new per-user key store**, not the global `EncryptionService` (K-2 — global key cannot per-user shred). **[REQUIREMENT]** Never classify server-readable wellbeing as E2EE.

## 10. Domain-isolation matrix (ledger ISO-1/2)

| Domain | Current location | Target location | DB principal | INTELLIGENCE FK allowed? |
|---|---|---|---|---|
| CORE (users/profiles/auth/keys) | `public` | **stays `public`** | existing | n/a |
| FINANCE (expenses/splits/payments/settlements/P2P/groups/contributions/invites/keys/contacts) | `public` | **stays `public`** | existing | **NO** |
| GOALS | `public` (empty table) | dedicated schema+role | new | NO |
| PRIVATE (journal) | none | dedicated schema+role | new | NO |
| WELLBEING | none | dedicated schema+role | new | NO |
| WARDROBE | none | dedicated schema + object bucket | new | NO |
| OPPORTUNITIES | none | separate low-trust service/store | new | one-way in |
| INTELLIGENCE | none | dedicated schema | new | **holds only signals + provenance (opaque IDs), no raw FKs** |

**[TARGET]** Existing CORE/FINANCE tables are **not moved** (ISO-1, backward compat). New domains get real DB principals; a single superuser ORM connection must not defeat isolation.

## 11. AI data-access matrix (ledger AI-1..5, INT, DER, VEN)

| Data | Internal AI use? | External AI use? | Consent | Minimization | Allowed projection | Raw prohibited? | Retention |
|---|---|---|---|---|---|---|---|
| Amounts/categories | CONDITIONAL | CONDITIONAL | external-AI consent (AI-5) | required | numeric + **controlled-enum category** (AI-4) | **YES** | none stored; ZDR (VEN-1) |
| Spending trends | via projection | via projection | consent | required | `SpendingTrendProjection` (numeric) | YES | ZDR |
| Expense/note/goal free-text | NO | **NO (V1)** | — | — | none (AI-2 numeric-only) | YES | — |
| Journal | NO | **NO** | — | — | none | YES | — |
| WELLBEING mood | CONDITIONAL (post-DPIA) | **NO (default)** | explicit | required | numeric score only, gated | YES | — |
| Contacts / non-users | **NO** | **NO** | — | — | none (CNT-1) | YES | — |
| Wardrobe image (future) | vision, on-demand | approved provider only | wardrobe-vision consent | face/bg minimized; approved-provider baseline (WARD-1) | image (minimized) | raw DB entities prohibited | ZDR |
| assistant_qa | — | question + fixed capped projection | external-AI consent | numeric projection | fixed projection + untrusted question | YES; **stateless** (AI-3/RGT-3) | no transcript |
| Derived/INTELLIGENCE | owner only | CONDITIONAL (projection) | tiered | required | provenance-free projection | YES | per policy |

**[REQUIREMENT]** All external AI egress passes the single firewall (AI-1); user question is untrusted and never overrides system rules (AI-3); no raw entities ever (INT-1/GV-5).

## 12. Data-flow diagrams (sensitive domains)

**Finance (existing):**
```
Client — encrypts title/desc (master/group key) → API → FINANCE svc → public DB (ciphertext title, plaintext amount)
Client ← decrypts title/desc (holds key) ← API ← DB
AI:  FINANCE svc → numeric SpendingTrendProjection → [FIREWALL] → external AI   (consent + ZDR)
MUST NOT: raw Expense[] → AI ;  amounts → analytics raw ;  title/desc plaintext → server
```
**P2P note (target B-2):**
```
Client — encrypts note (per-entry content key, wrapped for both users) → API → DB (ciphertext + marker=direct_shared)
Legacy rows: marker=legacy_plaintext → shown as-is; client backfill re-encrypts on next session
MUST NOT: server read note plaintext ; backfill server-side
```
**Wellbeing (target, Class-2):**
```
Client → API → WELLBEING svc → per-user WELLBEING key (server) → WELLBEING schema (encrypted-at-rest)
Analysis (consented, DPIA-on): WELLBEING svc → mark-stale/recompute → signal(+legal basis) → [OUTBOX] → INTELLIGENCE
MUST NOT: mood → external AI by default ; mood raw → INTELLIGENCE ; server read without consent gate
```
**Intelligence (target):**
```
Domains → small signals + provenance(domain+opaque IDs) → [OUTBOX/durable] → INTELLIGENCE (no raw FKs)
Correctness-critical (GOALS←FINANCE): synchronous projection-pull
MUST NOT: INTELLIGENCE hold raw copies / FKs into raw domain tables (ISO-2)
```

## 13. Production-data compatibility analysis

| Field | Prod data? | Can change enc? | Needs user keys? | Old clients read? | Mixed-state? | Opportunistic? | If user never returns | Rollback |
|---|---|---|---|---|---|---|---|---|
| goal.title | **No (empty)** | Yes | n/a | n/a | No | n/a | n/a | revert column type |
| direct_ledger.note | **Yes** | Yes (B-2) | Yes (both users) | Yes (marker) | **Yes** | Yes (client) | stays plaintext (marker) | readers keep plaintext path |
| settlement.note (FLD-1) | Yes | Yes (E2EE new) | Yes (backfill) | Yes (marker) | **Yes** | Yes (client) | stays plaintext | plaintext branch retained |
| group.description (FLD-2) | Yes | Yes (E2EE new) | Yes (backfill) | Yes (marker) | **Yes** | Yes (client) | stays plaintext | plaintext branch retained |
| group.name (FLD-3) | Yes | **No (stays plaintext)** | n/a | Yes | No | n/a | n/a | n/a |
| group_member.nickname (FLD-4) | Yes | **No (stays plaintext)** | n/a | Yes | No | n/a | n/a | n/a |
| profile.income/budget (FLD-5) | Yes | **No (access-tighten only)** | n/a | Yes | No | n/a | n/a | n/a |
| invitedEmail (FLD-7) | Yes | **No (retention purge only)** | n/a | Yes | No | n/a | n/a | disable purge |
| attachment.originalName | [ENG-UNKNOWN] | drop plaintext | no | n/a | n/a | n/a | n/a | re-add column |
| existing E2EE fields | Yes | **no change (K-3)** | — | Yes | — | — | — | — |
| refresh token transport (W3) | live sessions | via dual-emit | no | **breaks on hard cutover** | dual-emit window | n/a | — | re-enable body emit |

**[REQUIREMENT]** Never assume clean-slate; encrypting any prod-data field uses the B-2 additive-marker + client-backfill + permanent-mixed-state pattern. Encrypting `group.name` also **removes server-side name search/sort** — a functional cost to weigh (GOV-2).

## 14. Migration requirements (design-only)

1. **goal.title:** widen `varchar(160)→text`; born-encrypted (B-1). No data migration.
2. **direct_ledger.note:** additive nullable `encryption marker`; client backfill; mixed-state readers/export/deletion (B-2).
3. **attachment.originalName:** decide drop-plaintext vs justify (SEC-W6c) before attachments GA.
4. **auth W3/W7/W2:** dual-emit transport (AU-1/AU-4), stop logging tokens/email, drop email from audit metadata — additive/transitional.
5. **New domains (GOALS/PRIVATE/WELLBEING/WARDROBE/OPPORTUNITIES/INTELLIGENCE):** new schemas + DB roles + key stores (K-1/K-2, ISO-1) — additive, no touch to `public`.
6. **settlement.note (FLD-1) & group.description (FLD-2):** additive discriminator + client backfill + permanent mixed-state (B-2 pattern). **group.name (FLD-3), group_member.nickname (FLD-4), profile.income (FLD-5):** no data migration (stay plaintext-but-protected; access-tightening + consent-gating only). **invitedEmail (FLD-7):** additive retention purge. **attachment.originalName (FLD-6):** stop populating plaintext for new uploads; resolve SEC-W6c before attachments GA.

## 15. Retention/deletion implications

- **[REQUIREMENT]** Deletion cascade = mark-stale→recompute for aggregates (DER-1); durable outbox (OUT-1); tombstone replay after restore (DEL-2).
- **[CURRENT FACT]** Redis session/verify/reset keys are TTL'd (natural expiry); account deletion must also purge `refresh_token:{userId}:*` (existing `revokeAllSessions` covers logout/reset — deletion service must call it).
- **[REQUIREMENT]** Account deletion = personal-scope erase + anonymize-in-place for shared FINANCE/P2P/audit (DEL-1); existing NOT-NULL user FKs (`expenses.ownerUser`, `direct_ledger_entries.from/toUser`, `settlements`, `audit_logs.actorUser`) forbid row-DELETE.
- **[COUNSEL]** Departed-user personal content inside retained shared free-text (settlement/P2P notes) — DEL-3.
- **[REQUIREMENT]** Crypto-shred effective only after device-cache clear + backup rotation (K-4); erasure SLA parametric (RET-1).

## 16. Logging / cache / duplication findings

| Location | Sensitive data present? | Finding | Ref |
|---|---|---|---|
| App request logs (`logging.interceptor.ts`) | **Yes** — full `originalUrl` (query strings) + **raw IP** | reset/verify tokens (`?token=`) and `?email=` on GET routes land in logs; IP not hashed | SEC-W2 |
| Reverse-proxy access logs (`finmate-api`) | **Yes** — same GET query strings | proxy also captures tokens/email | SEC-W2 |
| `audit_logs.metadataJson` | **Yes** — plaintext `email` | on `auth.login_success` | SEC-W7 |
| Redis | refresh **argon2 hashes** (not raw), token→userId maps | acceptable; deletion must purge on account delete | — |
| Frontend IndexedDB (`ZkKeyVault`) | master key (non-extractable CryptoKey) | XSS can *use* but not *export*; cleared on logout | SEC-W5 (XSS) |
| Frontend memory | access token, session group keys | in-memory only; cleared on logout | — |
| Frontend localStorage | `finmate_ai_opt_in` (legacy), **refresh token (current, W3)** | refresh token exfiltratable via XSS | SEC-W3 |
| Service-worker/PWA cache | potentially finance API responses | must exclude sensitive endpoints | SEC-W5 |
| Object storage | none yet (attachments roadmap) | 4 encrypted blobs in **git history** | SEC-W1 |
| Notification payloads | none yet | target: content-free (NOT-1) | — |
| `trust proxy=true` unconditional | — | spoofable XFF weakens IP throttle/audit | SEC-W9 |
| Duplication | `attachment.originalName` plaintext **+** `encryptedOriginalName` | plaintext defeats encryption | SEC-W6c |

## 17. Known security gaps (cross-referenced)

SEC-W1 (git-history blobs) · SEC-W2 (tokens/email/IP in logs) · SEC-W3 (refresh token in body/localStorage) · SEC-W5 (Swagger/CSP/SW cache) · SEC-W6c (attachment name duplication) · SEC-W7 (audit email) · SEC-W9 (trust proxy) · SEC-KI1 (group-key `versionId` ignored → rotated-history undecryptable) · OPS-1 (DBA/backend plaintext read of Zone-2 finance).

## 18. P0/P1/P2 references

- **P0:** SEC-W1, SEC-W2, SEC-W3.
- **P1:** SEC-W6c, SEC-W7, OPS-1.
- **P2:** SEC-W5, SEC-W9, SEC-KI1.
(Definitions and full fields in the Decision Ledger §14.)

## 19. Unknowns requiring engineering verification [ENG-UNKNOWN]

1. Exact columns of `recurring_expense_splits` and all `*_versions` tables (assumed to mirror parents).
2. Whether `notes` is a shipped feature with production data.
3. Whether `recurring_expenses` / `attachments` have production rows.
4. Whether any `goals` rows were manually seeded (assumed none — no write path).
5. Exact `ngsw-config.json` data-caching groups (which API responses the SW currently caches).
6. Whether the deployed frontend stores the refresh token in `localStorage` vs memory today (W3 blast radius).
7. Production `CORS_ORIGINS` value vs `https://finmate.prvnsahni.com` (AU-2a verify).

## 20. Counsel-required questions [COUNSEL]

1. Legal basis for storing **non-user Contact PII** and the non-user rights process (CNT-1).
2. Retention basis for **anonymize-in-place** shared financial records on account deletion (DEL-1) and departed-user free-text in shared notes (DEL-3).
3. **[RESOLVED technically — legal open]** Technical protection for `settlement.note`/`group.description` (E2EE), `group.name`/`group_member.nickname`/`profile.monthlyIncome` (plaintext-but-protected), `attachment.originalName` (minimize), `invitedEmail` (plaintext-but-protected + retention) is now decided (FLD-1..FLD-7). The **GDPR classification** of each (personal vs sensitive; legal basis; whether any constitutes special-category in context) remains **[COUNSEL REQUIRED]**.
4. Special-category treatment of any inference derivable from finance free-text (pre-WELLBEING).
5. International-transfer basis for OpenAI/Resend (VEN-1) and any future OCR/vision vendor (CARD-1/WARD-1).

## 21. Summary

- **Entities inspected:** 27 (21 read field-by-field this task + earlier; 6 history/`recurring_split` tables classified by inheritance, exact columns [ENG-UNKNOWN]).
- **Relevant fields classified:** ~120 across all entities.
- **Encrypted fields (E2EE, existing):** expense.title/description, note.title/body, recurring.title/description, attachment.encryptedFileKey/encryptedOriginalName, and 4 wrapped-key entity blobs + user.encryptedPrivateWrappingKey/recoveryWrappedKey/publicWrappingKey.
- **E2EE content fields (current):** 6 free-text (+2 attachment). **E2EE key-material blobs:** 6 kinds.
- **Server-encrypted (global key):** 2 (2FA secret, avatarUrl).
- **Plaintext-sensitive (current):** all Zone-2 financial numerics + free-text/PII fields — now **all classified** via FLD-1..FLD-7: settlement.note→E2EE (FLD-1), group.description→E2EE (FLD-2), group.name→plaintext-protected (FLD-3), nickname→plaintext-protected (FLD-4), income→server-readable-protected (FLD-5), attachment.originalName→minimize (FLD-6), invitedEmail→plaintext-protected+retention (FLD-7); direct_ledger.note→E2EE (B-2); goal.title→E2EE (B-1, empty); contacts PII→minimize (CNT-1).
- **Special-category (current production):** **0** (health/mood/wardrobe not built).
- **Security-secret fields:** passwordHash, 2FA secret, publicWrappingKey, encryptedPrivateWrappingKey, recoveryWrappedKey, 4 wrapped-key tables, invite/group tokens.
- **Derived-data fields stored:** **0** (balances computed on the fly; INTELLIGENCE not built).
- **Production-data migration candidates (final):** direct_ledger.note (B-2) ; **settlement.note (FLD-1) ; group.description (FLD-2)** — all E2EE additive-marker + client-backfill mixed-state ; invitedEmail (FLD-7, retention purge) ; attachment.originalName (FLD-6/W6c) ; auth transport (W3). **No migration:** group.name (FLD-3), nickname (FLD-4), income (FLD-5) — stay readable, access-tighten only. goal.title = clean/empty.
- **P0 findings:** SEC-W1, W2, W3. **P1 findings:** SEC-W6c, W7, OPS-1. **P2:** W5, W9, KI1.
- **Unknowns:** 7 (§19). **Counsel-required:** 5 (§20).
- **Contradictions with the frozen ledger:** **NONE.** B-3 surfaced the free-text/PII coverage gaps exactly as the ledger's B-3 scope anticipated; they are now resolved as new LOCKED decisions **FLD-1..FLD-7 + PRIN-1**, none of which contradicts a locked ledger item. **Governance action pending:** back-port PRIN-1 + FLD-1..FLD-7 into the frozen ledger as new dated entries (the ledger was not modified in this task, per instruction).

---

### Reconciliation vs FINMATE_DECISION_LEDGER.md
- **Correctly reflected:** Z-2 (amounts plaintext), Z-3/K-3 (existing E2EE preserved), B-1 (goal empty→clean), B-2 (P2P note mixed-state), K-1/K-2 (two key classes), ISO-1/2 (public stays, INTELLIGENCE no raw FK), AI-1..5/INT/DER, CNT-1/2, DEL-1..3, all SEC/OPS items.
- **Cannot yet map to code (target only):** WELLBEING/PRIVATE/WARDROBE/OPPORTUNITIES/INTELLIGENCE domains, per-domain key stores, outbox, projection firewall — all correctly [TARGET], none implemented.
- **Actual implementation gaps found:** avatar server-encryption undocumented (drift, benign); attachment name duplication (W6c); audit email (W7); token/IP logging (W2); refresh-in-body (W3); group-key versionId bug (KI-1).
- **Unexpected sensitive/plaintext fields:** settlement.note, group.name, group.description, group_member.nickname, profile.monthlyIncome, invitedEmail — **now classified** (FLD-1..FLD-7); only their GDPR/legal classification remains [COUNSEL].
- **Unexpected data duplication:** attachment.originalName (plaintext + encrypted).
- **Unexpected AI access:** none (AI surface is the single opt-in proxy; no hidden egress).
- **Migration/compat risks:** P2P note backfill; auth transport transition (incl. old mobile); encrypting any group/settlement free-text would remove server-side search — a functional cost requiring a GOV-2 decision.

**No contradiction with the frozen ledger was found; therefore no STOP-and-report condition was triggered and the ledger was not modified.**

---

## DOCUMENT STATUS: **FROZEN** ✅

All relevant existing fields now carry a technical classification (FLD-1..FLD-7 close the gaps; PRIN-1 added). No contradiction with `FINMATE_DECISION_LEDGER.md`. Remaining items are **[ENG-UNKNOWN]** verifications (§19) and **[COUNSEL]** legal classifications (§20) — neither blocks freezing the *technical* classification matrix. One **governance action is pending**: back-port PRIN-1 + FLD-1..FLD-7 into the frozen Decision Ledger as new dated entries before Document #3 relies on them.

*End of Document #2 (FROZEN). STOP — not proceeding to Document #3 (Security & Privacy Architecture).*
