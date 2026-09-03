# FinMate — API Contract Index

**Companion to** [FINMATE_API_DATA_CONTRACTS.md](FINMATE_API_DATA_CONTRACTS.md) (Document #16). **Documentation only — no code changed.** One line per contract. Full detail lives in the main document (section refs in the last column).

**Legend:** Status = CURRENT / PARTIAL / PLACEHOLDER / TRANSITION / TARGET. Compat = backward-compatibility sensitivity (Low/Med/High/**Critical**). Sec = security sensitivity.

---

## FinMate API Contracts in 5 Minutes

An **API contract** is a written promise: _send exactly this, get exactly that back._ FinMate needs them because real people already use the app, some fields are **locked with your key** (the server must never read them), and money maths must always be identical. New locks and fields are **added** so old apps keep working; every request is checked for **who you are**, **what you may touch**, and — for AI — **what tiny summary may leave**. This index lists every contract; open the main document for the exact shapes, the CURRENT→TARGET migration path, and the adversarial review.

---

## Cross-cutting contracts

| ID          | Contract                                       | Status                         | Compat | Sec      | SRS                  | ADR         | Ref |
| ----------- | ---------------------------------------------- | ------------------------------ | ------ | -------- | -------------------- | ----------- | --- |
| CT-X-ERR    | Error envelope + code catalogue                | CURRENT                        | Med    | High     | cross                | —           | §7  |
| CT-X-AUTHZ  | Server-enforced authorization / IDOR           | CURRENT (tests [ENG-UNKNOWN])  | Med    | **High** | SEC-ISO-001/002      | 007         | §8  |
| CT-X-E2EE   | E2EE-field opacity (ciphertext passthrough)    | CURRENT                        | High   | **High** | ENC-001, KEY-001/002 | 002/003/004 | §5  |
| CT-X-MIN    | Sensitive response minimization (DTO boundary) | CURRENT                        | Med    | High     | —                    | 024         | §16 |
| CT-X-PAGE   | Pagination / filtering / sorting               | CURRENT (defaults [ENG-PARAM]) | Low    | Low      | —                    | —           | §12 |
| CT-X-IDEM   | Idempotency on financial creates               | **TARGET**                     | Med    | High     | FIN-002              | 017         | §13 |
| CT-X-RATE   | Rate-limit profiles + 429 contract             | CURRENT (limits [ENG-PARAM])   | Med    | High     | —                    | —           | §14 |
| CT-X-VER    | `/api/v1` versioning policy                    | CURRENT                        | High   | Low      | —                    | 001         | §15 |
| CT-X-MOBILE | Web/iOS/Android identical logical contract     | CURRENT/TARGET                 | High   | High     | AUTH-002/004         | 013         | §17 |

## Auth (`/auth`)

| ID         | Endpoint(s)                        | Status         | Compat   | Sec      | SRS              | ADR         | Ref   |
| ---------- | ---------------------------------- | -------------- | -------- | -------- | ---------------- | ----------- | ----- |
| CT-AUTH-01 | register / login / logout          | CURRENT        | Med      | High     | AUTH-001         | 001         | §2/§3 |
| CT-AUTH-02 | refresh (token transport)          | CURRENT→TARGET | **High** | **High** | AUTH-002/004/005 | 013/014/015 | §6    |
| CT-AUTH-03 | password reset (ZK) / verify-email | CURRENT        | Med      | High     | AUTH-003         | 005         | §3    |
| CT-AUTH-04 | 2FA enable/verify/disable          | CURRENT        | Low      | High     | AUTH-001         | —           | §2    |

## Users / Keys (`/users`)

| ID         | Endpoint(s)                     | Status  | Compat | Sec      | SRS          | ADR     | Ref |
| ---------- | ------------------------------- | ------- | ------ | -------- | ------------ | ------- | --- |
| CT-USER-01 | me GET/PATCH/DELETE             | CURRENT | Med    | High     | DEL-001      | 019     | §8  |
| CT-USER-02 | lookup, {id}/public-key         | CURRENT | Med    | High     | —            | —       | §2  |
| CT-USER-03 | me/keys GET/POST (wrapped keys) | CURRENT | High   | **High** | KEY-001..004 | 004/005 | §5  |

## Contacts (`/contacts`)

| ID        | Endpoint(s)                             | Status  | Compat | Sec  | SRS      | ADR | Ref |
| --------- | --------------------------------------- | ------- | ------ | ---- | -------- | --- | --- |
| CT-CNT-01 | list/create/claim/merge (3rd-party PII) | CURRENT | Med    | High | PRIV-004 | 011 | §8  |

## Expenses (`/expenses`, `/recurring-expenses`)

| ID        | Endpoint(s)                            | Status         | Compat       | Sec  | SRS         | ADR | Ref   |
| --------- | -------------------------------------- | -------------- | ------------ | ---- | ----------- | --- | ----- |
| CT-EXP-01 | create (multi-payer, refund, splits)   | CURRENT        | **Critical** | High | FIN-002/007 | 017 | §4    |
| CT-EXP-02 | update / delete (soft, 7-day restore)  | CURRENT        | **Critical** | High | FIN-013/014 | 017 | §3/§4 |
| CT-EXP-03 | list/get (pagination, filters)         | CURRENT        | Med          | High | —           | —   | §12   |
| CT-EXP-04 | recurring create/list/get/patch/delete | CURRENT (beta) | Med          | Med  | FIN-002     | 017 | §3    |

## Groups / Members / Invites / Keys (`/groups`)

| ID        | Endpoint(s)                                                                         | Status     | Compat        | Sec      | SRS             | ADR | Ref    |
| --------- | ----------------------------------------------------------------------------------- | ---------- | ------------- | -------- | --------------- | --- | ------ |
| CT-GRP-01 | create/list/get/patch                                                               | CURRENT    | High          | High     | FIN-002         | 001 | §3     |
| CT-GRP-02 | description E2EE (FLD-2)                                                            | TRANSITION | Med           | High     | MIG-002         | 016 | §5/§18 |
| CT-GRP-03 | members create/list/patch/delete (roles)                                            | CURRENT    | High          | High     | SEC-ISO-001     | 007 | §8     |
| CT-GRP-04 | invites (TIK/RSA), join, invite-links                                               | CURRENT    | High          | **High** | KEY-001         | 004 | §2     |
| CT-GRP-05 | keys (POST/me/missing/rotate) — versionId **honored (SEC-KI1 VERIFIED 2026-08-13)** | CURRENT    | Low (was Med) | **High** | KEY-005/SEC-009 | 004 | §3/§18 |
| CT-GRP-06 | contributions, close-month, carry-forward                                           | CURRENT    | **Critical**  | High     | FIN-002         | 017 | §4     |

## Settlements (`/groups/{groupId}/settlements`, `/friends`)

| ID        | Endpoint(s)                          | Status     | Compat       | Sec  | SRS     | ADR | Ref    |
| --------- | ------------------------------------ | ---------- | ------------ | ---- | ------- | --- | ------ |
| CT-SET-01 | create/list/balances/patch (derived) | CURRENT    | **Critical** | High | FIN-002 | 017 | §4     |
| CT-SET-02 | settlement `note` E2EE (FLD-1)       | TRANSITION | Med          | High | MIG-001 | 016 | §5/§18 |
| CT-SET-03 | friends (group-derived balances)     | CURRENT    | Med          | High | FIN-002 | 017 | §2     |

## People / P2P (`/people`)

| ID        | Endpoint(s)                                | Status     | Compat       | Sec  | SRS     | ADR | Ref    |
| --------- | ------------------------------------------ | ---------- | ------------ | ---- | ------- | --- | ------ |
| CT-P2P-01 | list / get {userId} (signed balances)      | CURRENT    | **Critical** | High | FIN-002 | 017 | §2/§4  |
| CT-P2P-02 | transactions (lend/borrow) / settlements   | CURRENT    | **Critical** | High | FIN-002 | 017 | §4     |
| CT-P2P-03 | transactions/{id} patch/delete (immutable) | CURRENT    | High         | High | FIN-002 | 017 | §8     |
| CT-P2P-04 | P2P `note` E2EE `direct_shared` (B-2)      | TRANSITION | Med          | High | MIG-003 | 016 | §5/§18 |

## Import / Export

| ID            | Endpoint(s)                                       | Status          | Compat | Sec  | SRS     | ADR | Ref |
| ------------- | ------------------------------------------------- | --------------- | ------ | ---- | ------- | --- | --- |
| CT-IMP-01     | POST /import/expenses (validate, E2EE round-trip) | CURRENT/Partial | High   | High | FIN-002 | 017 | §11 |
| CT-EXP-EXPORT | GET /export/expenses (ciphertext, refund-net)     | CURRENT/Partial | High   | High | DEL-004 | 019 | §11 |

## AI / Intelligence

| ID        | Endpoint(s)                               | Status  | Compat | Sec      | SRS             | ADR     | Ref |
| --------- | ----------------------------------------- | ------- | ------ | -------- | --------------- | ------- | --- |
| CT-AI-01  | `/ai/proxy` (thin, opt-in)                | PARTIAL | Med    | **High** | AI-001          | 009     | §9  |
| CT-AI-02  | AI firewall (intent + projection)         | TARGET  | Med    | **High** | AI-001..004     | 009/010 | §9  |
| CT-AI-03  | assistant_qa (stateless)                  | TARGET  | Low    | **High** | AI-003          | 009     | §9  |
| CT-AI-04  | external-AI consent gate                  | TARGET  | Low    | High     | AI-005/PRIV-004 | 011/023 | §9  |
| CT-INT-01 | domain → INTELLIGENCE signals (no raw FK) | TARGET  | Low    | **High** | INT-001..005    | 008/018 | §10 |

## Future domains (TARGET only — not built)

| ID          | Domain / base                                                                                                                                                     | Status      | Compat | Sec      | SRS                             | ADR     | Ref  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | -------- | ------------------------------- | ------- | ---- |
| CT-GOAL-01  | GOALS `/goals` (+`/{id}`, `/{id}/projection`) — **BATCH-11: born-E2EE, owner-scoped, flag-gated (`feature.goals`), REC-1 on create; deterministic GoalEngine V1** | CURRENT     | Low    | High     | FUT-001, B-1                    | 003     | §19  |
| CT-PRIV-01  | PRIVATE / journal                                                                                                                                                 | TARGET      | Low    | **High** | —                               | 002/003 | §19  |
| CT-WELL-01  | WELLBEING `/wellbeing`                                                                                                                                            | TARGET      | Low    | **High** | —                               | 003     | §19  |
| CT-WARD-01  | WARDROBE `/wardrobe`                                                                                                                                              | TARGET      | Low    | High     | FUT-002                         | 012     | §19  |
| CT-OPP-01   | OPPORTUNITIES `/opportunities`                                                                                                                                    | TARGET      | Low    | Med      | —                               | —       | §19  |
| CT-NOT-01   | NOTIFICATIONS `/notifications` (in-app ranked V1) — **BATCH-12: computed, read-only, flag-gated (`notifications.inApp`)**                                         | CURRENT     | Low    | Med      | NOT-001/003/004/006/007, UX-007 | 021     | §19  |
| CT-NOTES-01 | NOTES `/notes` (openapi PLACEHOLDER, no controller)                                                                                                               | PLACEHOLDER | Low    | High     | —                               | 002/003 | §2.4 |

---

## Spec-vs-code drift (tracked, not resolved)

| #   | Drift                                                         | Reality                                                                                                    | Ref     |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------- |
| D-1 | openapi has `/notes` CRUD                                     | no controller/service → PLACEHOLDER (`/goals` **resolved** — implemented + openapi reconciled in BATCH-11) | §2.4    |
| D-2 | openapi `POST /expenses` lacks `payments[]`/`transactionType` | code DTO has both                                                                                          | §2.4    |
| D-3 | `/friends` missing from openapi                               | controller exists                                                                                          | §2.4    |
| D-4 | openapi error schema lacks `{success,data}` envelope          | filter adds them (+`errorId` on 500)                                                                       | §2.4/§7 |

_These are documentation-hygiene items; the code is authoritative. Regenerate `openapi.yaml` from code before any GA._

---

_Index for Document #16. No code changed. STOP — no migrations, no implementation, no tickets._
