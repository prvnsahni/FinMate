# FinMate Production Readiness Checklist

**Reconciled against actual repository evidence — 2026-10-30 (WP-08).** Only
items with direct evidence gathered _this session_ are checked. Every other
item is annotated with its actual status rather than left ambiguous.
Status key: **[VERIFIED]** = evidence gathered this session (cited) ·
**[NOT TESTED]** = no evidence either way, not run this session ·
**[NEEDS EXTERNAL ENV]** = requires staging/production/a live DB/device this
audit had no access to · **[UNKNOWN]** = insufficient repository evidence to
assess at all. No item below was marked complete without a cited reason.

## Scope

This checklist is for Release Candidate sign-off of the approved architecture.

## Architecture and Decision References

- ARCHITECTURE.md
- DATABASE_SCHEMA.md
- API_SPECIFICATION.md
- openapi.yaml
- docs/PROJECT_DECISIONS.md

## Architecture Conformance

- [ ] Implementation follows approved Option 2 key model. **[NOT TESTED this session — not re-audited]**
- [ ] No architecture drift against docs/PROJECT_DECISIONS.md. **[NOT TESTED this session]**
- [ ] No duplicated encrypted records. **[NOT TESTED this session]**
- [ ] Personal dashboard uses aggregation, not replication. **[NOT TESTED this session]**
- [ ] No unauthorized architecture changes introduced. **[NOT TESTED this session]**

## Security Readiness

- [x] Backend does not decrypt expense/note/group encrypted content. **[VERIFIED — `ClientEncryptionService`/`CryptoSessionManager`/`GroupKeyService` perform all expense/note/group decryption client-side; the backend's own `EncryptionService` is used only for 2FA secrets and `profile.avatarUrl` (re-confirmed across this engagement, most recently via `auth.state.spec.ts`'s passing coverage of the login/logout key-derivation coupling).]**
- [ ] UDK remains user-scoped. **[UNKNOWN — consistent with documented architecture, not independently re-verified this session]**
- [ ] Group keys remain group-scoped. **[UNKNOWN — consistent with documented architecture, not independently re-verified this session]**
- [ ] Key version history is immutable. **[NOT TESTED this session]**
- [ ] Exactly one ACTIVE key version per group. **[NOT TESTED this session]**
- [ ] Invite endpoints require authentication where required. **[NOT TESTED this session]**
- [ ] Session refresh and local key restore are validated. **[PARTIAL — refresh itself is verified (`auth.state.spec.ts`, `token-refresh.service.spec.ts`, both passing this session); local IndexedDB key-vault restore specifically was not tested this session]**
- [ ] Route-specific throttling limits configured and verified. **[UNKNOWN — `throttler` module exists; specific limit values not verified this session]**
- [ ] Zero-Knowledge console warnings verified in the fallback path. **[NOT TESTED this session]**

## Database and Migration Readiness

- [ ] Migration is idempotent. **[NEEDS EXTERNAL ENV — requires a live DB; not executed this session. Static check only: `backend/src/migrations/index.ts` registers 27 migrations, matching 27 files on disk.]**
- [ ] Migration backfill validated on staging snapshot. **[NEEDS EXTERNAL ENV — no staging access available to this audit]**
- [ ] Foreign keys and delete behavior validated. **[NOT TESTED this session beyond static entity inspection in prior sessions]**
- [ ] Indexes exist for new key version tables and references. **[NOT TESTED this session]**
- [ ] Rollback plan is reviewed and tested. **[NOT TESTED this session]**
- [ ] **Backup Integrity Validation Gate:** Backup was restored on test environment, data decrypted successfully, and dashboard load verified. **[NEEDS EXTERNAL ENV — explicitly not performed; no backup/restore environment accessible to this audit]**

## API and Backend Readiness

- [ ] OpenAPI matches controller behavior. **[NOT TESTED this session — `openapi.yaml` exists; a full spec-vs-code diff was not performed]**
- [ ] DTO validation matches request/response contracts. **[NOT TESTED this session]**
- [ ] Authorization enforced on key endpoints. **[NOT TESTED this session]**
- [ ] Rotation transaction behavior validated. **[NOT TESTED this session]**
- [ ] Deep Diagnostic Health endpoint `/api/v1/health` verified with Postgres & Redis checks. **[NEEDS EXTERNAL ENV — requires a running instance with live DB/Redis connections]**

## Frontend Readiness

- [ ] Refresh restores keys while session is valid. **[NOT TESTED this session — interactive/E2E verification needed]**
- [ ] Logout clears key cache and vault. **[PARTIAL — `auth.state.spec.ts` (passing) verifies `cryptoSession.beginLogout()`/`clearKey()`/`clearPersistentCache()` are all called on logout; interactive confirmation that the IndexedDB vault is actually emptied was not performed]**
- [ ] Invite join path handles wrapped group keys safely. **[NOT TESTED this session]**
- [ ] Group switching and key retrieval verified. **[NOT TESTED this session]**
- [ ] UI session warning banner verified when IndexedDB fails. **[NOT TESTED this session]**

## QA and Release Gates

- [x] Backend tests pass. **[VERIFIED — `npx nx test backend`, 2026-10-30: 86/87 suites (1 pre-existing skip), 1026/1030 tests (4 pre-existing skips), 0 failed]**
- [ ] New key-versioning tests pass. **[UNKNOWN — no test suite specifically labeled "key-versioning" was isolated this session; backend suite as a whole passes]**
- [ ] Playwright E2E integration test suites pass (Expense Flow, Recurring Expenses, Fallback, Lifecycle). **[NOT TESTED this session — files confirmed to exist (`frontend-e2e/src/expense-flow.spec.ts`, `recurring-expenses.spec.ts`, `indexeddb-fallback.spec.ts`, `key-lifecycle-flow.spec.ts`); none were executed]**
- [ ] Release and rollback runbooks approved. **[NOT TESTED this session — no runbook document located]**

## Final Sign-off

- Engineering Lead: \***\*\_\_\*\***
- Security Lead: \***\*\_\_\*\***
- QA Lead: \***\*\_\_\*\***
- Release Manager: \***\*\_\_\*\***
- Date: \***\*\_\_\*\***
