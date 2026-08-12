# FinMate — Architecture Decision Records (ADR) Index

**Location:** `docs/architecture/adr/` · **Status:** all Accepted (each reflects an already-frozen decision — no ADR invents a decision) · **Date:** 2026-08-12
**Governing rule:** every ADR traces to a frozen source (Decision Ledger item / SRS requirement / Threat Model ID / architecture document). Where a value is undecided it is marked `[OPEN]` / `[PRODUCT DECISION REQUIRED]` / `[ENGINEERING PARAMETER]` / `[COUNSEL REQUIRED]`, never silently decided.

## FinMate ADRs in 5 Minutes

An **ADR** is a short note that records *why* an important decision was made — so future engineers don't accidentally undo it. FinMate wrote ADRs only for the big, hard-to-reverse choices: how data is locked, who holds the keys, how the AI is kept away from your private data, how logging-in works on web vs phone, how deletion really works, and — most importantly — how to add all of this **without breaking the money app people already use**. Each ADR is written twice: a simple explanation anyone can read, then the technical detail. The single most important idea across all of them: *secure and improve the existing product without unnecessarily breaking it.*

## Index

| ADR | Title | Status | Decision summary | Affected modules | Security | Compat |
|---|---|---|---|---|---|---|
| [001](adr/ADR-001-protect-existing-functionality.md) | Protect existing functionality | Accepted | Existing product is a protected baseline; additive-only | All | High | **Critical** |
| [002](adr/ADR-002-data-protection-zones.md) | Data protection zones | Accepted | Zones 1a/1b/2/3; least-protective mechanism | All data | High | Low |
| [003](adr/ADR-003-classA-e2ee-classB-server-managed.md) | Class-A E2EE vs Class-B server-managed | Accepted | Two encryption classes | Encryption, wellbeing, intelligence | High | Low |
| [004](adr/ADR-004-random-per-domain-keys-no-hkdf.md) | Random per-domain keys (no HKDF) | Accepted | Random wrapped keys enable crypto-shred | Key mgmt | High | Low |
| [005](adr/ADR-005-recovery-key-architecture.md) | Recovery-key architecture | Accepted | User-held recovery wraps master; mandatory pre-E2EE | Auth, key mgmt | High | Med |
| [006](adr/ADR-006-crypto-shred-backup-limits.md) | Crypto-shred + backup limits | Accepted | Destroy key; not instant while backups exist | Deletion, backups | High | Low |
| [007](adr/ADR-007-per-domain-db-principals.md) | Per-domain DB principals | Accepted | Real per-domain roles; new domains only | DB, all new domains | High | Med |
| [008](adr/ADR-008-intelligence-signals-not-raw.md) | INTELLIGENCE = signals, not raw | Accepted | Signals + provenance; no raw FKs/keys | Intelligence | High | Low |
| [009](adr/ADR-009-single-ai-egress-firewall.md) | Single AI egress firewall | Accepted | One audited AI chokepoint; server-owned prompts | AI | High | Med |
| [010](adr/ADR-010-numeric-enum-ai-projection.md) | Numeric/enum-only AI projection | Accepted | Fixed enum; no free-text egress | AI | High | Med |
| [011](adr/ADR-011-external-ai-consent-separate.md) | External-AI consent separate | Accepted | Distinct AI consent; withdrawal invalidates cache | AI, consent | High | Low |
| [012](adr/ADR-012-wardrobe-approved-provider-failclosed.md) | Wardrobe approved-provider + fail-closed | Accepted | Approved provider baseline; fail-closed | Wardrobe (future) | High | Low |
| [013](adr/ADR-013-dual-transport-auth.md) | Dual-transport auth | Accepted | Web cookie / native secure-storage | Auth, mobile | High | **High** |
| [014](adr/ADR-014-samesite-lax-cookie-csrf-cors.md) | SameSite=Lax cookie + CSRF + CORS | Accepted | Same-site topology cookie config | Auth, web | High | High |
| [015](adr/ADR-015-backward-compatible-auth-transition.md) | Backward-compatible auth transition | Accepted | Dual-emit until 5-condition sunset | Auth, mobile | High | **High** |
| [016](adr/ADR-016-mixed-state-encryption-migration.md) | Mixed-state encryption migration | Accepted | Marker + client backfill; actor/key defined | P2P, settlements, groups | High | **Med/High** |
| [017](adr/ADR-017-financial-parity-golden-fixtures.md) | Financial parity / golden fixtures | Accepted | Prove parity before any calc change | Finance | Med | **Critical** |
| [018](adr/ADR-018-withdrawal-suppression-override-states.md) | Withdrawal/suppression/override states | Accepted | Three distinct states; no resurrection | Intelligence, privacy | High | Low |
| [019](adr/ADR-019-deletion-cascade-tombstones.md) | Deletion cascade + tombstones | Accepted | Personal erase + shared tombstone + replay | Deletion, all | High | Med |
| [020](adr/ADR-020-v1-helpful-proactive-personalized-v2.md) | V1 Helpful+Proactive; Personalized V2 | Accepted | Personalized deferred to V2 | UX, intelligence | Med | Low |
| [021](adr/ADR-021-v1-inapp-notifications-push-deferred.md) | V1 in-app notifications; push deferred | Accepted | In-app ranked V1; OS push TARGET | Notifications, mobile | Med | Low |
| [022](adr/ADR-022-privacy-first-ai-dev-context.md) | Privacy-first AI dev context | Accepted | Least-knowledge agents; secretless env | Dev/IP | High | Low |
| [023](adr/ADR-023-no-user-data-training-v1.md) | No user-data training in V1 | Accepted | No training; verified no-train providers | AI, vendors | High | Low |
| [024](adr/ADR-024-finance-data-protected-though-server-readable.md) | Finance data protected though server-readable | Accepted | Zone-2 plaintext-but-protected | Finance | High | Low |

### Related SRS requirements (per ADR)
001→GOV/COMP/FIN · 002→DATA/FLD · 003→ENC-001/KEY-001-002/FUT-001 · 004→KEY-001/003 · 005→KEY-004 · 006→KEY-006/DEL-002-003 · 007→SEC-ISO-001-002/INT-001 · 008→INT-001-005 · 009→AI-001/003/009 · 010→AI-002/004 · 011→AI-005/013/PRIV-004-006 · 012→FUT-002 · 013→AUTH-002/004 · 014→AUTH-003 · 015→AUTH-005/SEC-003 · 016→MIG-001-003/008 · 017→FIN-002/007/013/014 · 018→PRIV-002-004/INT-004 · 019→DEL-001-006/DER-1 · 020→UX-005/005b · 021→NOT-001-007 · 022→SEC-001/IP · 023→AI-008/FUT-004 · 024→FIN-003/DATA-003/FLD-5.

## Classification summary
- **Security-critical ADRs:** 002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 018, 019, 022, 023, 024.
- **Compatibility-sensitive ADRs:** **001 (Critical), 017 (Critical), 013/015/016 (High), 014, 007, 019, 005**.
- **Migration-sensitive ADRs:** 015 (auth transition), 016 (note-encryption backfill), 019 (deletion), 007 (isolation), 006 (backups).
- **Deferred/scope ADRs:** 020 (Personalized→V2), 021 (OS push→TARGET), 012 (wardrobe future).

## Open items intentionally NOT decided in ADRs (carried, not resolved)
- AUTH-005 sunset date — `[ENGINEERING PARAMETER]` (ADR-015, OQ-17).
- Retention/erasure SLA (RET-1) — `[ENGINEERING PARAMETER / COUNSEL]` (ADR-006).
- group.description pre-join display — `[ENG-UNKNOWN]` gating ADR-016 (OQ-11).
- Legal bases, Art. 9 wellbeing, vendor transfers, contacts non-user rights, departed-user shared free-text — `[COUNSEL REQUIRED]` (ADR-011/019/023, DEL-3).
- Investment-AI projection policy — `[PRODUCT DECISION REQUIRED]`.

*ADRs record why; the SRS records what; the architecture documents record how; the current baseline records what must not be broken.*
