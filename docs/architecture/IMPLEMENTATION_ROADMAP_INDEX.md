# FinMate — Implementation Roadmap Index

**Companion to** [FINMATE_IMPLEMENTATION_ROADMAP.md](FINMATE_IMPLEMENTATION_ROADMAP.md) (Document #18). **Documentation only — no code, migration, or production change; no tickets.** One line per workstream/unit; section refs point into the main roadmap.

---

## FinMate Implementation Roadmap in 5 Minutes

We are making an app that **already works** safer and a little smarter — **without breaking anyone's money records or logging anyone out.** We fix the **security floor first** (stop leaking secrets into logs, protect the login token), then build **compatibility plumbing** (feature flags + dashboards), then **gently convert** a few plaintext fields to locked ones on your own device (old and new live side by side), then give **new features their own private rooms**, add **V1 product** (faster capture, goals, quiet notifications), a **guarded AI door** that only sends tiny number summaries, **native phone hardening**, and finally a **V2 "tips brain"** and future rooms. **Golden rule:** security/legal first, then keep existing money features working, then backward compatibility, then new architecture, then convenience — and **no change may alter anyone's balance.** SEC-KI1 is already fixed — **no key rewrite, no re-encryption.**

---

## Workstreams

| ID      | Workstream                            | Phase      | Priority | Risk               | Compat                 | SRS                  | ADR             | Status     |
| ------- | ------------------------------------- | ---------- | -------- | ------------------ | ---------------------- | -------------------- | --------------- | ---------- |
| WS-SEC  | Security foundation                   | 0          | **P0**   | Med                | additive               | SEC-001/002/007/008  | —               | TARGET     |
| WS-PLAT | Platform (flags, observability)       | 0–1        | P0/P1    | Low                | additive               | —                    | —               | TARGET     |
| WS-AUTH | Auth transport transition             | 1          | P1       | Med                | dual-emit sunset       | AUTH-002/003/004/005 | 013/014/015     | TRANSITION |
| WS-ENC  | E2EE data migrations                  | 2          | P1       | Med                | permanent mixed-state  | MIG-001/002/003/008  | 016             | TRANSITION |
| WS-ISO  | DB domain isolation (new domains)     | 3          | P2       | Med                | CORE/FINANCE untouched | SEC-ISO-001/002      | 007             | TARGET     |
| WS-FIN  | Finance core protection (parity gate) | guards all | **P1**   | High if mishandled | must stay identical    | FIN-002/007/013/014  | 017/024         | CURRENT    |
| WS-GOAL | Goals-v2                              | 4          | P2       | Low                | additive               | FUT-001              | 003             | TARGET     |
| WS-NOT  | In-app notifications                  | 4          | P3       | Low                | additive               | NOT-001..007         | 021             | TARGET     |
| WS-AI   | AI firewall                           | 5          | P3       | Med                | flag; proxy retained   | AI-001..009          | 009/010/011/023 | TRANSITION |
| WS-MOB  | Native mobile hardening               | 6          | P3       | Med                | old apps work          | AUTH-002/004         | 013/015         | TARGET     |
| WS-INT  | V2 intelligence                       | 7          | P4       | Med                | additive               | INT-001..005         | 008/018         | TARGET     |
| WS-DOM  | Future domains                        | 8          | P4+      | Low–High           | additive               | FUT-002              | 012             | TARGET     |

## Implementation units (by phase)

| Phase | Units                                                                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0** | W-SEC-01 secret scan/purge · W-SEC-02 log redaction · W-SEC-03 audit email drop · W-SEC-04 Swagger/CSP/SW · W-SEC-05 trust-proxy · W-PLAT-01 flags · W-PLAT-02 dashboards                                            |
| **1** | W-AUTH-01 dual-emit · W-AUTH-02 cookie+CORS · W-AUTH-03 CSRF/transport · W-AUTH-04 min-version/telemetry                                                                                                             |
| **2** | W-ENC-01 marker · W-ENC-02 dual-read · W-ENC-03 P2P backfill · W-ENC-04 settlement backfill · W-ENC-05 group-desc backfill · W-ENC-06 parity · W-ENC-07 attachment plaintext stop · W-ENC-08 invited-email retention |
| **3** | W-ISO-01 schemas · W-ISO-02 principals · W-ISO-03 contract layer · W-ISO-04 isolation tests                                                                                                                          |
| **4** | W-FIN-01 low-friction capture · W-FIN-02 parity harness · W-GOAL-01/02/03 · W-NOT-01                                                                                                                                 |
| **5** | W-AI-01 projections · W-AI-02 firewall · W-AI-03 consent · W-AI-04 ZDR · W-AI-05 assistant_qa · W-AI-06 validation/throttle/logging · W-AI-07 retire proxy                                                           |
| **6** | W-MOB-01 secure storage · W-MOB-02 push · W-MOB-03 deep links · W-MOB-04 snapshot/min-version                                                                                                                        |
| **7** | W-INT-01 signals · W-INT-02 outbox · W-INT-03 three-state · W-INT-04 structured memory                                                                                                                               |
| **8** | W-DOM-01 private · W-DOM-02 wellbeing (DPIA-gated) · W-DOM-03 wardrobe · W-DOM-04 opportunities                                                                                                                      |

## Releases (no dates)

R0 security · R1 compat infra · R2 data-safety migrations · R3 V1 UX/product · R4 AI foundation · R5 native mobile · R6 V2 intelligence · R7 future domains.

## Stop conditions (must HALT)

Financial-parity failure · E2EE plaintext exposure/decryption regression · old-mobile break · IDOR/authz failure · cross-domain raw read · AI-firewall bypass · consent bypass · unexpected prod data mutation · migration mismatch · backup-restore resurrection.

## SEC-KI1 (explicit)

**MITIGATED/VERIFIED** · **M-KEYVER = COMPLETE / VERIFY-ONLY** · **NO migration, NO re-encryption.** Separate: GRP-007 (display-only, ENG), GRP-005 (PRODUCT/SEC), legacy NULL-`versionId` (VERIFICATION), REVOKED semantics (PRODUCT/SEC).

## Unresolved (carried; tags)

RET-1 (ENG/COUNSEL) · AUTH-005 sunset (ENG) · OQ-11 pre-join (ENG) · CNT-1 (COUNSEL) · DEL-3 (COUNSEL) · VEN-1 (COUNSEL) · DPIA-1 (COUNSEL/PRODUCT) · AI-memory retention (PRODUCT/ENG) · investment-AI (PRODUCT) · perf baselines (ENG) · SCA tooling (ENG) · legacy NULL-versionId (VERIFICATION) · REVOKED (PRODUCT/SEC) · GRP-005 (PRODUCT/SEC) · GRP-007 (ENG) · bank aggregation (PRODUCT).

---

_Index for Document #18. No code changed. STOP — no implementation, no migrations, no tickets, no production change._
