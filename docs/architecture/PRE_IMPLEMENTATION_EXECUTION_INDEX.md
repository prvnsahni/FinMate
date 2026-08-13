# FinMate — Pre-Implementation Execution Index

**Companion to** [FINMATE_PRE_IMPLEMENTATION_EXECUTION_PLAN.md](FINMATE_PRE_IMPLEMENTATION_EXECUTION_PLAN.md) (Document #19). **Read-only planning — no code, DB, migration, production change; no tickets/commits/pushes.** Section refs point into the main plan.

---

## FinMate Pre-Implementation Plan in 5 Minutes

Before writing any new code, we **looked at the real app** and checked what each planned job touches, then sorted the work into **16 small batches** behind **11 red-light gates** (money, locks, logins, AI, migrations). What we found in the actual code: the known security leaks (logs, Swagger, trust-proxy, tokens in browser storage) are **still there** — only the group-key version bug is already fixed. There's **no "same-answer-before-and-after" money safety net yet**, so that must be built **before** touching any money code. The phone app has **no native powers yet**. We changed **nothing** — this is the pre-flight checklist.

> **SEC-KI1 = MITIGATED/VERIFIED · M-KEYVER = COMPLETE/VERIFY-ONLY — no migration, no re-encryption.** GRP-007/GRP-005/NULL-versionId/REVOKED stay separate.

---

## Work-item readiness (repository-verified)

| Area | Status | Evidence |
|---|---|---|
| SEC-W1 secret scan | READY | `ci.yml` no scanning; root blobs ×4 |
| SEC-W2 log redaction | READY | `logging.interceptor.ts:39-44` full URL + raw IP |
| SEC-W7 audit email | READY-WITH-VERIFICATION | `auth.service.ts:82` `metadataJson: meta` |
| SEC-W5 Swagger/CSP | READY | `main.ts:22-28` `unsafe-inline`; `:74` Swagger ungated |
| SEC-W9 trust proxy | READY | `main.ts:46` unconditional |
| SEC-W3 refresh storage | BLOCKED-on-auth | `auth.state.ts:57` refresh in localStorage |
| SEC-W6c attachment name | DEFERRED | upload path unbuilt |
| OPS-1 isolation | BLOCKED-on-ISO | single datasource |
| **SEC-KI1** | **ALREADY-IMPLEMENTED** | `groups.service.ts:1439` honors versionId |
| Auth transport | READY-WITH-VERIFICATION | body tokens; CORS `credentials:true`; no CSRF |
| E2EE migrations | BLOCKED | no marker columns; needs parity+REC-1+prod-rows |
| Finance parity harness | READY (PREREQUISITE) | unit tests exist; no golden-fixture suite |
| DB isolation | BLOCKED | single datasource; needs infra |
| AI firewall | BLOCKED | thin proxy; no projections/consent-ledger/ZDR |
| Mobile native | BLOCKED | only `@capacitor/core`+`cli` |
| Goals/Notifications | READY (greenfield) | no controllers (PLACEHOLDER) |

## Batches

| Batch | Work items | Status | Gates |
|---|---|---|---|
| BATCH-01 | W-SEC-02/03 log+audit redaction | READY | GATE-SEC |
| BATCH-02 | W-SEC-01 secret scan/purge | READY | GATE-SEC/PROD |
| BATCH-03 | W-SEC-04/05 Swagger/CSP/proxy | READY | GATE-SEC |
| BATCH-04 | W-PLAT-01/02 flags/observability | READY | GATE-SEC |
| **BATCH-05** | **W-FIN-02 finance parity harness** | **READY — PREREQUISITE** | GATE-FIN |
| BATCH-06 | W-AUTH-01..04 dual-emit auth | READY-WITH-VERIFICATION | GATE-AUTH/SEC |
| BATCH-07 | W-ENC-01/02 marker + dual-read | BLOCKED-on-05 | GATE-E2EE/MIG/FIN |
| BATCH-08 | W-ENC-03..06 backfill + parity | BLOCKED-on-07 | GATE-E2EE/MIG |
| BATCH-09 | W-ENC-07/08 attachment/invited-email | PARTIAL | GATE-MIG/DEL |
| BATCH-10 | W-ISO-01..04 isolation | BLOCKED (infra) | GATE-PROD/FIN |
| BATCH-11 | W-GOAL-01..03 goals-v2 | READY (greenfield) | GATE-E2EE/FIN |
| BATCH-12 | W-NOT-01 notifications | READY (greenfield) | GATE-SEC |
| BATCH-13 | W-AI-01..07 firewall | BLOCKED | GATE-AI/SEC |
| BATCH-14 | W-MOB-01..04 mobile | BLOCKED (native) | GATE-MOBILE/AUTH |
| BATCH-15 | W-INT-01..04 intelligence | BLOCKED (V2) | GATE-AI/SEC |
| BATCH-16 | W-DOM-01..04 future domains | BLOCKED (future) | GATE-SEC/AI |

## Hard gates

GATE-FIN (parity) · GATE-SEC · GATE-E2EE · GATE-AUTH · GATE-AUTHZ (IDOR) · GATE-AI · GATE-MIG · GATE-DEL · GATE-MOBILE · GATE-PROD. **No batch bypasses an applicable gate.**

## Order note (roadmap vs repo)

**Parity harness (BATCH-05) must run before any finance-touching batch** — earlier than Roadmap #18's Phase 4. Reported §13; roadmap not modified.

## Production unknowns (verify before dependent batches)

prod CORS · deployed refresh storage · attachment/notes/recurring row counts · legacy NULL-versionId · SW cache groups · IDOR coverage · prod config · perf baselines.

## Stop conditions

financial parity change · E2EE undecryptable · old-mobile break · token/secret leak · cross-domain raw read · AI-firewall bypass · consent bypass · unexpected row mutation · rollback failure · unexpected prod data change.

---

*Index for Document #19. **NO CODE / DB / MIGRATION / PRODUCTION change; NO packages / tickets / commits / pushes.** STOP.*
