# FinMate — SEC-KI1 Discrepancy Verification (read-only findings)

**Date:** 2026-08-13 · **Nature:** read-only repository verification. **No code, entity, database, migration, production, frontend, encryption, or frozen architecture document was modified.** This document is **additive** — it does **not** edit any frozen doc; it _recommends_ an additive dated correction (§8).

**Trigger:** Document #17 (§8) surfaced a contradiction — frozen docs describe **SEC-KI1** ("group-key `versionId` is ignored → rotated historical group data may become undecryptable") as OPEN, while the repository appears to honor `versionId`. This task verifies, without assuming either side is correct.

---

## 1. Status (one answer)

**B — PARTIALLY VALID, with the dangerous interpretation RESOLVED.**

- The **literal SEC-KI1 claim** ("versionId ignored → rotated historical _expense data_ undecryptable") is **OBSOLETE for the primary path.** `versionId` is honored **end-to-end**; normal rotation does **not** make historical expense data undecryptable. **Fixed 2026-07-17** (branch `Expense-module0a`; `gap-tracker.md` ENC-002/EXP-002/EXP-003 = **Done**).
- A **narrow, low-severity residual remains (GRP-007, Pending):** the **group history log** renders ciphertext titles from **`audit_logs.metadataJson`**, which are stored **without a key-version stamp**, so post-rotation history entries fall back to the ACTIVE key and show a **placeholder**. **Display-only — the canonical expense stays decryptable.**
- A **related but distinct pending item (GRP-005):** a leaver retains their **cached wrapped key** (no revoke/rotate on leave) — a key-lifecycle concern, **not** SEC-KI1.

**Net:** the frozen SEC-KI1 text is **outdated**. The primary path is fixed; only a low-severity, display-only residual on the audit-metadata surface remains.

---

## 2. Evidence (actual code path, with references)

### Group key creation

- `groups.service.ts:123 ensureActiveGroupKeyVersion` / `expenses.service.ts:233 getOrCreateActiveGroupKeyVersion` — create/return `GroupKeyVersion { version:1, status:'ACTIVE' }` per group.

### Group key rotation

- `groups.service.ts:1518 rotateGroupKey` — in one transaction: sets the current ACTIVE version `status = 'SUPERSEDED'` (**line 1551**, _not_ REVOKED), creates the next version `status:'ACTIVE'` (1564), and **inserts new `MemberWrappedGroupKey` rows for the new version only** (1587–1594). **Old-version wrapped keys are preserved (never deleted).**

### Group key version storage

- Entity `group-key-version.entity.ts:28` → `status: 'ACTIVE' | 'SUPERSEDED' | 'REVOKED'`; `@Unique(['group','version'])`.

### Expense encryption + `groupKeyVersionId` storage (write-side defense)

- `expenses.service.ts:260 resolveDeclaredGroupKeyVersion` — stamps **the version the client declares it encrypted with**, validating it belongs to the group and is not REVOKED (268). Comment (256–258): _"The stamp must record the version actually used — not whatever is ACTIVE at write time — or a rotation racing a write leaves the ciphertext undecryptable."_
- Frontend `group-key.service.ts:174 getGroupKeyForEncryption` returns a consistent `(key, versionId)` pair (even if since SUPERSEDED) so the stamp stays correct.

### API request → `getMyGroupKey(versionId)`

- `groups.controller.ts:393 GET :id/keys/me` accepts `@Query('versionId', ParseUUIDPipe optional)` (397).
- `groups.service.ts:1439 getMyGroupKey` — if `versionId` given, loads **that** version scoped to the group; rejects only if missing **or `status === 'REVOKED'`** (1447) → **SUPERSEDED is served**; returns the **caller's own** wrapped key: `where: { groupKeyVersion:{id}, user:{ id: userId } }` (**1465–1470**, `userId` = authenticated caller).

### Client key cache → expense decryption

- `group-key.service.ts:121 resolveGroupKey` caches per `groupId:versionId` (buildVersionedKey:63), dedups in-flight requests; `fetchAndCacheGroupKey:885` sends `?versionId=${groupKeyVersionId}` (**904–906**).
- `expense-decryption.service.ts:205 resolveKey` — for `scope==='group'` passes `expense.groupKeyVersionId` to `ensureGroupKey` (**215**); for `scope==='direct_shared'` uses per-entry wrapped keys filtered by the caller's own `userId` (223–224).

### Cross-corroboration

- `gap-tracker.md` **ENC-002 (=KI-1)**: _"…ignores `?versionId=`…; **2026-07-17: implemented on `Expense-module0a` — endpoint honors `?versionId=` (scoped, REVOKED rejected)**"_ — **Done**.
- **EXP-003**: _"client declares `groupKeyVersionId` on create/update; backend validates and stamps exactly that version (create had the same mismatch via rotation races)"_ — **Done**.

---

## 3. Case analysis (A–L)

| Case | Scenario                                                       | CURRENT behaviour                                                                              | Verdict                                                 |
| ---- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| A    | expense encrypted with V1                                      | stamped `groupKeyVersionId = V1`                                                               | ✅ correct                                              |
| B    | group rotated to V2                                            | V1→SUPERSEDED, V2→ACTIVE; V1 wrapped keys retained                                             | ✅ correct                                              |
| C    | open V1 expense **after** rotation                             | client requests V1; `getMyGroupKey(V1)` serves SUPERSEDED V1 + caller's V1 wrapped key         | ✅ **decryptable** (tested, see §4)                     |
| D    | open V2 expense                                                | requests V2 (ACTIVE)                                                                           | ✅ correct                                              |
| E    | request V1 explicitly                                          | served (SUPERSEDED allowed)                                                                    | ✅                                                      |
| F    | request V2 explicitly                                          | served (ACTIVE)                                                                                | ✅                                                      |
| G    | request nonexistent version                                    | `NotFound` (1447–1449)                                                                         | ✅ correct                                              |
| H    | request **REVOKED** version                                    | `NotFound` — but **no code sets REVOKED** (see §5); dormant guard                              | ✅ safe / dormant                                       |
| I    | user has no wrapped key for requested version                  | `wrappedKey: null`, `hasActiveKeys` reflects count                                             | ✅ no cross-user leak                                   |
| J    | multiple devices                                               | each fetches per-version key from backend; caches per `groupId:versionId`                      | ✅ (per-device cache)                                   |
| K    | cached V1 + current V2                                         | cache keyed per version; both coexist                                                          | ✅                                                      |
| L    | old expense with **NULL** `groupKeyVersionId` (pre-versioning) | client requests **ACTIVE** version → may mismatch pre-versioning ciphertext if such rows exist | **UNKNOWN** — distinct legacy-data question (see §6/§9) |

---

## 4. Test coverage

| Behaviour                                                                     | Coverage                                                                                                           | Evidence                                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Serve requested version when `versionId` provided (**SUPERSEDED** historical) | **TEST EXISTS**                                                                                                    | `groups.service.spec.ts:1289` (status `SUPERSEDED`, asserts `wrappedKey === 'ciphertext-v1'`) |
| Serve ACTIVE when no `versionId`                                              | **TEST EXISTS**                                                                                                    | `:1317`                                                                                       |
| Reject `versionId` not in group (cross-group)                                 | **TEST EXISTS**                                                                                                    | `:1335`                                                                                       |
| Reject **REVOKED** version                                                    | **TEST EXISTS**                                                                                                    | `:1344`                                                                                       |
| Rotation supersedes active + creates next                                     | **TEST EXISTS**                                                                                                    | `:1210`                                                                                       |
| Provisioning doesn't overwrite existing wrapped key                           | **TEST EXISTS**                                                                                                    | `:1087`                                                                                       |
| Member replaces own wrapped key (legacy→RSA)                                  | **TEST EXISTS**                                                                                                    | `:1148`                                                                                       |
| Listing exposes no `wrappedKey`                                               | **TEST EXISTS**                                                                                                    | `:1404`                                                                                       |
| **Cross-USER** isolation (A can't get B's key via versionId)                  | **PARTIAL** — code-enforced (`user:{id:userId}` @1468); cross-_group_ tested, explicit cross-_user_ test not found | —                                                                                             |
| Frontend per-version caching / stamping                                       | **TEST EXISTS (files)**                                                                                            | `group-key.service.spec.ts`, `crypto-session-manager.service.spec.ts`                         |
| End-to-end historical decrypt after rotation (integration)                    | **NO TEST / UNKNOWN**                                                                                              | unit-level only                                                                               |
| Legacy NULL-versionId (case L)                                                | **NO TEST**                                                                                                        | —                                                                                             |
| GRP-007 history-log placeholder                                               | **NO TEST** (Pending item)                                                                                         | `gap-tracker.md`                                                                              |

**Note:** "code appears correct" is corroborated by targeted unit tests for the core path; full integration and the legacy edge are not unit-proven.

---

## 5. REVOKED interpretation (do not classify as a bug)

- **`REVOKED` is never assigned by any code path.** Grep across `backend/src`: the only `= 'REVOKED'`/`'SUPERSEDED'` assignment is rotation → `SUPERSEDED` (`groups.service.ts:1551`). `'REVOKED'` appears **only in rejection guards** (`getMyGroupKey:1447`, `expenses.service.ts:268`, `recurring-expenses.service.ts:252`). It is a **dormant defensive state**, reachable only by manual DB edit.
- **Distinctions:**
  - **KEY ROTATION** → `SUPERSEDED`: normal; old versions **retained and served**; history preserved. _(implemented)_
  - **KEY REVOCATION** → `REVOKED`: would deny access to a version. _(no code sets it)_
  - **CRYPTO-SHRED (K-4):** destroy key material → data intentionally unreadable. REVOKED would be its mechanism if ever built.
- **NotFound-on-REVOKED is consistent with intentional crypto-shred/revocation** (K-4/ROT-1), **not** an accidental rotation bug. Whether to ever use REVOKED, and its exact semantics (e.g. on member leave — see GRP-005), is **[PRODUCT/SECURITY DECISION REQUIRED]**. It does **not** affect current SEC-KI1 status because normal rotation never produces REVOKED.

---

## 6. Historical-data safety

**The critical invariant — _normal key rotation MUST NOT make previously encrypted data undecryptable_ — is SATISFIED for canonical expense data.**

- Write path stamps the **actual** version used (defends rotation-racing-write); read path requests that version; rotation **preserves** old wrapped keys and only marks old versions `SUPERSEDED` (still served).
- **Where it does NOT hold (narrow, display-only):** the **group history log** (`groups.service.ts:1024 getGroupHistory`) returns `log.metadataJson` (1080) verbatim; ciphertext titles snapshotted into audit metadata carry **no version stamp**, so the client cannot request the right version and renders a **placeholder** for post-rotation entries (**GRP-007**, Pending; matrix §5.19 KI-1 caveat). **The underlying expense remains decryptable** on the main expense surfaces — this is **not data loss**.

---

## 7. Migration consequence

- **M-KEYVER → VERIFY-ONLY, and verification is now complete for the primary path.** **No historical re-encryption. No destructive migration.** The primary SEC-KI1 fix already shipped (2026-07-17).
- **Track separately (pre-existing, not data-loss):**
  - **GRP-007** (Low): give audit-metadata history titles a version stamp (or stop storing titles in audit metadata — the agreed end-state). Additive.
  - **GRP-005** (Medium): define leaver wrapped-key revocation/rotation semantics — **[PRODUCT/SECURITY DECISION REQUIRED]** (ties to REVOKED semantics).
  - **Case L** (UNKNOWN): confirm whether any pre-versioning group expenses with NULL `groupKeyVersionId` exist in production and whether they decrypt post-rotation. **REQUIRES PRODUCTION VERIFICATION.**

---

## 8. Documents requiring an additive dated status correction (NOT edited here)

Recommended additive note (verbatim suggestion): _"2026-08-13 — Repository verification supersedes the previous SEC-KI1 status: the primary group-key `versionId` path was fixed 2026-07-17 (endpoint honors versionId; write stamps the declared version; SUPERSEDED served; unit-tested). A narrow low-severity residual remains on the audit-metadata history-log surface (GRP-007, display-only) and a distinct leaver-key item (GRP-005)."_

| Document                                                                       | Location to correct                                         |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `FINMATE_DECISION_LEDGER.md`                                                   | SEC-KI1 entry (§14 P2 list)                                 |
| `FINMATE_DATA_CLASSIFICATION_ENCRYPTION_MATRIX.md`                             | §17/§18 SEC-KI1; §5.19 KI-1 caveat                          |
| `FINMATE_SECURITY_PRIVACY_ARCHITECTURE.md`                                     | §18 logging/cache table (SEC-KI1 row); §20                  |
| `FINMATE_CURRENT_SYSTEM_FUNCTIONALITY_BASELINE.md`                             | §11 (known gap), §18, §25                                   |
| `FINMATE_KEY_MANAGEMENT_ARCHITECTURE.md`                                       | any SEC-KI1/rotation "must fix first" note                  |
| `FINMATE_THREAT_MODEL.md`                                                      | any SEC-KI1 reference                                       |
| `FINMATE_PROCESSING_ACTIVITIES_REGISTER.md`                                    | any SEC-KI1 reference                                       |
| `FINMATE_SRS.md`                                                               | KEY-005 if it encodes the bug as open                       |
| `FINMATE_MODULE_DATA_OWNERSHIP_MAP.md`                                         | RF-3 (SEC-KI1) — reclassify as fixed + GRP-007 residual     |
| `FINMATE_API_DATA_CONTRACTS.md`                                                | CT-GRP-05 note                                              |
| `FINMATE_BACKWARD_COMPATIBILITY_MIGRATION_PLAN.md` / `MIGRATION_PLAN_INDEX.md` | §8 / M-KEYVER (already flagged; update to "verified fixed") |

**Preserve historical statements** — corrections are additive dated notes, never silent edits.

---

## 9. Remaining risks & contradictions

- **GRP-007** (Low, display-only): post-rotation history-log entries show placeholder.
- **GRP-005** (Medium): leaver retains cached wrapped key; revocation semantics undefined.
- **Case L** (UNKNOWN): legacy NULL-versionId group expenses — REQUIRES PRODUCTION VERIFICATION.
- **REVOKED semantics** undefined — **[PRODUCT/SECURITY DECISION REQUIRED]** (dormant today).
- **Contradiction:** frozen docs (SEC-KI1 OPEN) vs repository (primary path fixed 2026-07-17). **Surfaced; frozen docs NOT modified.** Resolution = additive dated correction (§8) — a governance action, not a code change.

---

## 10. Should implementation stop?

- **For SEC-KI1 specifically:** the core fix is **already implemented and unit-tested** — **no code change and no data-loss migration are warranted** from this verification.
- **No STOP for uncertainty:** the core question is answered with evidence. The remaining items (GRP-007, GRP-005, Case L, REVOKED policy) are **distinct, pre-existing, lower-severity** and tracked separately.
- **Governance action needed:** additive status correction to the frozen docs (§8) before they are relied on for planning.

**Confirmation:** **NO CODE was changed.** Read-only verification only — no source, entity, database, migration, production, frontend, encryption, or frozen architecture document was modified.

_End of SEC-KI1 verification._
