# Implementation Plan — P2P / Direct-Ledger Contact Support

> Plan-of-record. Backend-first, four sequential batches (P2P-1 … P2P-4), each independently
> testable and gated by the FIN-002 golden suite. The technical design below is unchanged; only the
> status block is maintained as batches land.

## Current status (updated 2026-09-07)

| Batch | State | Evidence |
|---|---|---|
| **P2P-1** — DirectLedgerEntry `User XOR Contact` + migration + ledger assembly | ✅ **COMPLETE** | commit `9e93920` (local, unpushed); backend 942 tests green incl FIN-002 |
| **P2P-2** — read-time Contact claim + merge resolution | ✅ **COMPLETE** | commit `937b38b` (local, unpushed); backend 954 tests green incl FIN-002 |
| **Governance package** — ADR-025 + Decision Ledger P2P-CNT-1..4 + Matrix §5.7 | ✅ **COMPLETE** | commit `a3c1ea2` (local, unpushed); governance docs only |
| **P2P-3** — Contact P2P API / DTO / authorization | ⛔ **GOVERNANCE-BLOCKED — not started** | see blockers below |
| **P2P-4** — frontend P2P Contact UX | ⛔ **NOT STARTED** (depends on P2P-3) | — |

**P2P-3 is blocked** (do not implement) until BOTH are recorded as actually granted — neither is
satisfied by the completed engineering work or the governance package:

- **P2P-CNT-3** — `[COUNSEL REQUIRED]` lawful basis for exposing non-user Contact PII via the P2P API
  + the non-user rights process; **and** `[GOVERNANCE-OWNER APPROVAL REQUIRED]` for the API
  privacy/authorization boundary.
- **P2P-CNT-4** — `[COUNSEL REQUIRED]` retention basis (inherited from DEL-1).

Nothing has been pushed. Engineering design completeness is **not** governance approval (GOV-4).

## Locked decisions

- **Claim (Contact→User):** read-time resolve-through — leave ledger rows Contact-backed; fold
  claimed Contacts to `user:<id>` during ledger assembly. No history rewrite; idempotent; respects
  `DirectLedgerEntry` immutability. Post-claim, new entries are naturally User-backed.
- **API addressing:** separate contact routes (`/people/contacts/:contactId/...` + `POST
  /people/contacts`); existing `/people/:userId` routes untouched (backward compatible).

## Frozen FIN-002 finding (must not change)

`calculateDeterministicSplits` and `simplifyLedgerDebts` operate on **opaque identity keys**
(`simplifyLedgerDebts` is already fed GroupMember-id keys, proving agnosticism). The User-only
restriction is caller-side in `PersonLedgerService` (`!info.userId` guard; `fromGroupMember?.user?.id`
guard). Therefore Contact P2P support **must not modify** `simplifyLedgerDebts`,
`calculateDeterministicSplits`, the golden fixtures, or calculator semantics. Run
`nx test backend --testPathPattern=finance-golden` as the parity/regression gate after each batch.

## 1. Architecture summary
Add non-member Contact counterparties to the group-less People/direct-ledger feature, reusing the
frozen `Contact` identity and frozen calculators. `DirectLedgerEntry` becomes `User XOR Contact` per
side (additive). `PersonLedgerService` keys the ledger by opaque `user:<id>` / `contact:<id>`.

## 2. Current P2P data flow (verified)
`people-dashboard/person-detail` → `PeopleService` (`/people`, `/people/:userId`,
`/people/:userId/transactions|settlements`, `/people/transactions/:id`) → `PeopleController`
(`:userId` = `ParseUUIDPipe`) → `PersonLedgerService` (`resolvePair` via `userRepository`;
`buildLedger` keys by `counterpartyUserId`; direct entries netted with `round2`; group edges via
`simplifyLedgerDebts` on GroupMember-id keys then mapped to userIds, dropped when `!info.userId` —
the "(V1)" guard) → `DirectLedgerEntry` (User-only) → DTOs expose `counterpartyUserId` + `email`.

## 3. Proposed `DirectLedgerEntry` schema (additive; mirrors ExpenseSplit/ExpensePayment)
| Column | Change |
|---|---|
| `from_user_id` | NOT NULL → NULL |
| `to_user_id` | NOT NULL → NULL |
| `from_contact_id` | new nullable FK → `contacts(id)` |
| `to_contact_id` | new nullable FK → `contacts(id)` |
| `created_by_user_id` | unchanged, NOT NULL User |

CHECKs: `num_nonnulls(from_user_id, from_contact_id) = 1`;
`num_nonnulls(to_user_id, to_contact_id) = 1`; replace `fromUserId<>toUserId` with a same-kind
self-ref guard `(from_user_id IS NULL OR to_user_id IS NULL OR from_user_id<>to_user_id) AND
(from_contact_id IS NULL OR to_contact_id IS NULL OR from_contact_id<>to_contact_id)`; keep
`amount>0`. FK `ON DELETE RESTRICT` (Contacts archived, never hard-deleted). Add indexes on
`from_contact_id`, `to_contact_id`. Immutability preserved (soft-delete only).

## 4. Migration design (additive, non-destructive)
1) drop NOT NULL on `from_user_id`/`to_user_id`; 2) add nullable `from_contact_id`/`to_contact_id`
FKs; 3) drop old `<>` check, add the three new CHECKs; 4) add the two indexes. Existing rows keep
both user FKs and satisfy `num_nonnulls=1`. Deploy DB → app (nullable ⇒ forward/backward
compatible). Down migration provided; re-adding NOT NULL is safe **only before any contact-backed
rows exist** (documented). No backfill, no destructive statements.

## 5. `PersonLedgerService` changes (input assembly only)
Add key helpers (`keyForUser`/`keyForContact`/`parseKey`); `resolvePair` → `resolveCounterparty`
returning `{kind,user?,contact?}`; direct writes set `fromUser|fromContact` / `toUser|toContact`;
`buildLedger`/`getOverview`/`getPersonDetail` key `CounterpartyLedger` by composite key and carry
`counterpartyKind`+`counterpartyId`. The group-side V1 guards are **out of scope** (deferred, left
as-is). `round2`/bucketing/direction/ordering unchanged for User↔User.

## 6. Identity-key strategy
Keys created only in `PersonLedgerService`; opaque to the calculator; deterministic sort preserved.
Existing User↔User keys become `user:<id>` (pure key rename; emitted nets identical — golden gate +
parity test prove it).

## 7. Claim behavior (read-time resolve-through)
In `buildLedger`, fold a `contact:<id>` whose Contact is `claimed` to `user:<claimedByUserId>`. No
row rewrite; idempotent; new post-claim entries are User-backed automatically (resolveOrCreateIdentity
returns the User). `claimContactsForUser` unchanged.

## 8. Merge/redirect behavior
Resolve every `contact:<id>` through existing `resolveMergeRedirect` to its terminal Contact, then
apply the claim fold (A→B→claimed-User ⇒ `user:<U>`). Direct-ledger rows are **not** repointed
(immutability); GroupMembers continue to be repointed by `mergeContacts` as today. No history loss;
redirect chains cycle-guarded.

## 9. API/DTO (separate contact routes)
Keep `/people/:userId*` untouched. Add: `GET /people/contacts/:contactId`,
`POST /people/contacts/:contactId/transactions`, `POST /people/contacts/:contactId/settlements`,
`POST /people/contacts` (`{identifier,displayName}` → `resolveOrCreateIdentity`, createdByUser =
caller). `PATCH/DELETE /people/transactions/:id` unchanged (entry-id; `loadCallerEntry` accepts the
User side of a contact entry). DTOs: add `counterpartyKind:'user'|'contact'` + `counterpartyId`
(keep `counterpartyUserId` for users only, nullable). No global search endpoint.

## 10. Authorization
Own ledger only. Address a Contact iff `Contact.createdByUser === caller` OR caller shares an active
group with it (reuse `listAddressBook` predicate) — the IDOR guard. Creating a new P2P Contact is
allowed for any authenticated caller (owns the Contact; no group gate). Claim/merge governed by
existing `ContactsService`. No group permissions ever granted to a Contact.

## 11. Settlements
Same `DirectLedgerEntry` model, `entryType:'settlement'`, `fromContact`/`toContact`; direction from
net; over-settlement guard unchanged. Contact can owe or be owed. No calculator/model change.

## 12. Privacy
Contact rows return `displayName` only — email/phone omitted/nulled in DTOs. Selection = User search
(unchanged) OR authorized Contacts (group-scoped) OR exact-identifier create. No global directory, no
name search across private Contacts, no partial phone/email search, no Contact-ID leakage.

## 13. Frontend (P2P-4)
`person-search-modal`/add-transaction: three sources (User / authorized Contact / add-new Contact via
`POST /people/contacts`); route+POST by `{kind,id}`; new lazy route `/people/contact/:contactId`;
render `Priya · Contact`; never show phone/email. No dashboard/group/recurring redesign. Files:
`people.service.ts`, `person-search-modal`, `add-transaction-modal`, `return-modal`, `person-detail`,
`people.routes.ts` (+specs).

## 14. Test plan
Data model (User↔User valid; User↔Contact; Contact↔User; invalid/null XOR rejected). Reuse (same
Contact ×3 → one identity/balance; no duplicate). Direction (both). Balance (pos/neg/zero, multi-
currency, rounding, simplify — parity vs current for users). Claim (fold; history preserved;
idempotent). Merge (A→B; A→B→claimed chain; no loss). Security (IDOR; no leakage; no email/phone; no
global name search). FIN-002 (full golden suite green + user-parity test).

## 15. FIN-002 regression strategy
Calculators + fixtures frozen. After each batch: `nx test backend --testPathPattern=finance-golden`
and full `nx test backend` must be green (CURRENT→TARGET parity). Any golden failure ⇒ stop.

## 16. Files expected to change (by batch)
- P2P-1: `direct-ledger-entry.entity.ts`; new migration; `person-ledger.service.ts` (+spec); key helper.
- P2P-2: `person-ledger.service.ts` (fold/redirect) (+spec); `contacts.service.spec.ts`.
- P2P-3: `people.controller.ts` (+spec), `dto/direct-transaction.dto.ts`, `api-responses.ts`,
  `person-ledger.service.ts` (contact resolution/authz).
- P2P-4: `people.service.ts`, `person-search-modal`, `add-transaction-modal`, `return-modal`,
  `person-detail`, `people.routes.ts` (+specs).

## 17. Migration name proposal
`backend/src/migrations/1720400000000-AddDirectLedgerContactIdentity.ts` (+ `migrations/index.ts`).
Not created by this plan.

## 18. Commit/batch boundaries
Four commits, one per batch, backend-first, each green + golden gate. No push.

## 19. Risks
DTO email scrub must not regress user rows (tested). Read-time resolve adds contact lookups → batch-
load by id. Route addressing ambiguity → separate routes. New P2P contact authz scope → mandatory
IDOR tests. Deferred group-side V1 guard remains a known, documented gap.

## 20. Rollback
Per-batch git revert (no push until approved). DB rollback = down migration, safe only before contact
rows exist (documented). App forward/backward compatible across nullable change ⇒ app-only rollback
safe.

## 21. Required approvals
ADR + Decision Ledger entry (P2P counterparty = User XOR Contact; claim/merge resolved at read time;
DTOs never expose Contact email/phone) — **needed**. Data Classification Matrix — none (Contact PII
already classified). Crypto/key-management/counsel — none (reuses resolveOrCreateIdentity + existing
discovery; E2EE untouched).

## Stop-condition check
All clear — Contact representable additively; migration non-destructive & preserves User↔User rows;
claim/merge via read-time resolution (no rewrite); settlements need no calculator change; no global
directory; no E2EE change; authorization cleanly scopable.
