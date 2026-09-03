# FinMate — Migration Plan Index

**Companion to** [FINMATE_BACKWARD_COMPATIBILITY_MIGRATION_PLAN.md](FINMATE_BACKWARD_COMPATIBILITY_MIGRATION_PLAN.md) (Document #17). **Documentation only — no code, schema, migration, or production change.** One line per migration. Section refs point into the main plan.

---

## FinMate Migration Plan in 5 Minutes

**Migration** = changing how FinMate stores or protects data **without breaking the live app.** Real people already have real money records, so we never "start fresh." We **add** the new ability first, let old and new records live side by side ("mixed state"), convert old data **on the user's own device** (the server never reads your locked words), check every balance still matches, and only much later remove the old path — after old apps have updated. Some steps have an **undo** (flag off); a few (destroying a key, deleting an account) are **one-way**, and we say so. **Rule of rules:** security/legal first, then keep existing money features working, then backward compatibility, then new architecture, then convenience — and **no migration may change anyone's balance.**

> ✅ **SEC-KI1 discrepancy RESOLVED 2026-08-13:** the code **honors** the group-key `versionId` end-to-end (verified; fixed 2026-07-17). The frozen docs' prior "versionId ignored" status was back-ported to **MITIGATED/VERIFIED** (additive dated corrections; historical statements preserved). **M-KEYVER = VERIFY-ONLY, no migration; do not re-encrypt history.** Residual GRP-007 (display-only); open: GRP-005, legacy NULL-`versionId`, REVOKED semantics.

---

## Migration index

| ID             | Area                                     | Current → Target                                    | Risk | Compat                              | Rollback             | SRS              | ADR             | Status                                            | Ref    |
| -------------- | ---------------------------------------- | --------------------------------------------------- | ---- | ----------------------------------- | -------------------- | ---------------- | --------------- | ------------------------------------------------- | ------ |
| **M-AUTH**     | Auth transport                           | body token → cookie(web)/header(native)+CSRF        | Med  | dual-emit until sunset              | **Safe**             | AUTH-002/004/005 | 013/014/015     | TRANSITION                                        | §7     |
| **M-NOTE-P2P** | `direct_ledger.note`                     | plaintext → E2EE `direct_shared`                    | Med  | mixed-state (permanent)             | **Safe**             | MIG-003          | 016             | TRANSITION                                        | §6     |
| **M-NOTE-SET** | `settlement.note`                        | plaintext → E2EE (group key)                        | Med  | mixed-state                         | **Safe**             | MIG-001          | 016             | TRANSITION                                        | §6     |
| **M-DESC-GRP** | `group.description`                      | plaintext → E2EE (group key)                        | Med  | mixed-state; pre-join [ENG-UNKNOWN] | **Safe**             | MIG-002          | 016             | TRANSITION                                        | §6     |
| **M-ATTACH**   | `attachment.originalName`                | plaintext+enc dup → drop plaintext (new)            | Low  | existing rows readable              | **Safe**             | MIG-008          | 016             | TARGET                                            | §9     |
| **M-INVEMAIL** | `invitedEmail`                           | plaintext → +retention purge                        | Low  | none (active never purged)          | **Safe** (pre-purge) | —                | 019             | TARGET                                            | §10    |
| **M-KEYVER**   | Group-key version                        | **repo honors versionId** (verified vs SEC-KI1)     | Low  | none                                | n/a (verify-only)    | KEY-005/SEC-009  | 004             | **VERIFIED 2026-08-13 · COMPLETE / NO MIGRATION** | §8     |
| **M-DBISO**    | DB isolation                             | single schema → per-domain principals (new domains) | Med  | CORE/FINANCE stay in public         | **Safe**             | SEC-ISO-001/002  | 007             | TARGET                                            | §11    |
| **M-AI**       | AI proxy → firewall                      | thin proxy → intent+projection+consent              | Med  | flaggable off                       | **Safe**             | AI-001..009      | 009/010/011/023 | TRANSITION                                        | §12    |
| **M-GOALS**    | Goals                                    | empty table → born-E2EE                             | Low  | none (empty)                        | drop                 | FUT-001          | 003             | TARGET                                            | §2     |
| **M-NOTIF**    | Notifications                            | none → in-app ranked (V1)                           | Low  | additive                            | disable              | NOT-001..007     | 021             | TARGET                                            | §2     |
| **M-MOBILE**   | Native capabilities                      | wrap → secure storage/push/deep-link/offline        | Med  | old apps keep working               | **Safe**             | AUTH-002/004     | 013             | TARGET                                            | §14    |
| **M-IMPEXP**   | Import/export format                     | xlsx V1 → optional versioned                        | Low  | round-trip preserved                | **Safe** (read V1)   | DEL-004          | 019             | CURRENT/TARGET                                    | §13    |
| **M-INTEL**    | Intelligence                             | none → signals+provenance (no raw FK)               | Low  | additive                            | drop                 | INT-001..005     | 008/018         | TARGET                                            | §2/§11 |
| **M-DOMAINS**  | PRIVATE/WELLBEING/WARDROBE/OPPORTUNITIES | none → isolated schemas+keys                        | Low  | additive                            | drop                 | FUT-002          | 012             | TARGET                                            | §2/§11 |

---

## Rollback classes

| Class                             | Migrations                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **SAFE ROLLBACK**                 | M-AUTH, M-NOTE-\* (write side), M-DESC-GRP, M-ATTACH, M-DBISO, M-AI, M-MOBILE, M-IMPEXP                      |
| **ROLL-FORWARD ONLY**             | already-encrypted rows in E2EE migrations; consent-withdrawal derived invalidation; post-purge invited-email |
| **IRREVERSIBLE AFTER CHECKPOINT** | account deletion, crypto-shred (K-4, DEL-1)                                                                  |

## Migration order (dependency-aware)

1. **P0 security:** SEC-W1, SEC-W2, SEC-W3 groundwork · 2. **Foundational:** SEC-KI1 verify (§8), log redaction, SEC-W7 · 3. **Compatibility:** M-AUTH, M-NOTE-\*, M-DESC-GRP · 4. **Isolation infra:** M-DBISO (greenfield) · 5. **V1:** M-GOALS, M-NOTIF, M-AI (flagged) · 6. **V2/future:** M-INTEL, M-DOMAINS.

## Open items

- **SEC-KI1 status: RESOLVED 2026-08-13** (M-KEYVER VERIFY-ONLY, complete — no migration). Still **[PRODUCT/SECURITY DECISION REQUIRED]**: REVOKED-version policy; GRP-005 leaver-key; and legacy NULL-`versionId` needs production verification (§8).
- **[ENGINEERING PARAMETER]** auth sunset date; marker column name; invited-email retention window; idempotency key/window; AI throttle; min-supported-version policy.
- **[ENG-UNKNOWN / VERIFY]** attachment/notes/recurring prod rows; deployed refresh storage; SW cache groups; prod CORS.
- **[COUNSEL]** FLD-1..7 GDPR classification; CNT-1; DEL-1/DEL-3; VEN-1.

---

_Index for Document #17. No code changed. STOP — no migrations created/executed, no schema/production change, no implementation tickets._
