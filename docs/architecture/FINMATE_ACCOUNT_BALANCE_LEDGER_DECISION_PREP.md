# FinMate - Account / Balance Ledger — Decision Preparation

**Status:** Decision-preparation document only. **Not an ADR, not a Decision
Ledger entry, not an approval.** Per `ADR_INDEX.md` ("all Accepted — no ADR
invents a decision") and `FINMATE_DECISION_LEDGER.md` ("authorises no code,
schema, migration, API, encryption, or production change"), this document
follows the same constraint: it prepares options and evidence for a
product-owner decision, it does not make one.

**Relationship to prior work:** this document continues
[`FINMATE_ACCOUNT_BALANCE_LEDGER_FUTURE.md`](./FINMATE_ACCOUNT_BALANCE_LEDGER_FUTURE.md),
which already recommended "Option A" (a new parallel Account/Transfer ledger,
scoped to manual entry first) over "Option B" (tagging `Expense` directly) and
"Option C" (defer). This document takes that recommendation one level deeper:
derived-vs-explicit ledger mechanics, worked accounting scenarios, encryption
zone questions, deletion questions, and a concrete decision register. It does
not re-litigate Option A vs. B vs. C.

**No code, schema, migration, API, OpenAPI, encryption, or Decision Ledger
change is made by this document.** Where a decision below is marked
**Approved (product owner)**, that reflects a decision made in conversation
with the product owner, recorded here for traceability only — it is still not
a Decision Ledger LOCKED entry or an accepted ADR until those artifacts are
separately drafted (see Deliverable 6).

---

## Decision Status (updated — 2026-10-29)

The product owner approved the following directions in conversation. **This
record is made in this preparatory document only.** It is not a Decision
Ledger entry and not an ADR — those remain future governance artifacts per
Deliverable 6, not yet drafted.

| ID | Decision | Status |
|---|---|---|
| ACC-7 | Build the scoped Account/Transfer slice (not defer) | **Approved (product owner)** |
| ACC-1 | Hybrid architecture — explicit `Account`/`Transfer` records; balances always computed at read time, never cached | **Approved (product owner)** |
| ACC-8 | Account linking on `Expense` is optional; existing expense workflows and semantics are unchanged | **Approved (product owner)** |
| ACC-2 | Recording a P2P loan is one combined user action that coordinates the `Transfer` and the existing `DirectLedgerEntry` | **Approved (product owner)** — see Deliverable 5b: transactional consistency, failure handling, and duplicate-creation risk are unresolved design requirements this approval does not satisfy |
| ACC-3 | Refund-related account crediting is a separate manual entry in v1; the existing `Expense` refund semantics (`transactionType: 'refund'`, `refund-parity.spec.ts`) are preserved unchanged | **Approved (product owner)** |
| ACC-9 | Duplicate-entry protection is out of scope for v1 | **Approved (product owner)** — recorded as a known limitation, not a solved problem; future imports must not be assumed protected against duplicates |
| ACC-4 | Encryption zone for `Account.displayName` | **Product direction selected: Zone 2** — not final; this row's own approval type is "Product + Security" and the security review has not occurred. Review brief prepared — see Deliverable 9. |
| ACC-5 | Encryption zone for `Account.openingBalance`/balance fields | **Product direction selected: Zone 2** — same open security-review condition as ACC-4. Review brief prepared — see Deliverable 9. |
| ACC-6 | Deletion/anonymization extension to `Account`/`Transfer` | **UNCHANGED — blocked on counsel.** No position is inferred or assumed here. Counsel brief prepared — see Deliverable 8. |

**What this does not do:** approving ACC-7/1/8/2/3/9 and selecting a
direction for ACC-4/5 does not clear this feature for implementation
planning. Per the precedent already set by `P2P-3` (`ADR-025`) — where
engineering readiness was explicitly distinguished from governance approval —
**migration design (Deliverable 6 item 5) and any ADR/Decision Ledger
drafting remain blocked** while ACC-6 is open, because `DEL-1`'s existing
pattern (NOT-NULL user FKs make row-DELETE impossible) is itself a
schema-shape property, and the new `Account`/`Transfer` tables' FK
nullability/cascade behavior depends on how ACC-6 resolves. The security
review for ACC-4/ACC-5 is likewise outstanding before either zone can be
stated as LOCKED in an ADR.

---

## Deliverable 1 — Repository Evidence

Everything below was read directly from the repository during this session.
Nothing is inferred from the external brainstorming brief.

| Claim | Evidence (path) |
|---|---|
| No `Account`/`BankAccount`/`CashAccount`/`CreditCard` entity exists | `find shared/data-models/src/lib -iname "*.entity.ts"` — 28 entity files, none named Account/Bank/Cash/CreditCard |
| `Expense` has no account reference; already has `transactionType: 'expense' \| 'refund'` with inverted-sign refund semantics | [`shared/data-models/src/lib/expense.entity.ts`](../../shared/data-models/src/lib/expense.entity.ts) lines 56–65 |
| `ExpensePayment` is the authoritative multi-payer record, one row per payer, amounts sum to `Expense.amountTotal` | [`shared/data-models/src/lib/expense-payment.entity.ts`](../../shared/data-models/src/lib/expense-payment.entity.ts) lines 17–31 |
| `ExpenseSplit` holds each participant's `amountOwed`/`isSettled` | [`shared/data-models/src/lib/expense-split.entity.ts`](../../shared/data-models/src/lib/expense-split.entity.ts) |
| `Settlement` is group-scoped (`fromUser`/`fromGroupMember` XOR), has `status: proposed\|confirmed\|cancelled` | [`shared/data-models/src/lib/settlement.entity.ts`](../../shared/data-models/src/lib/settlement.entity.ts) |
| `DirectLedgerEntry` is the existing P2P mechanism: `User` XOR `Contact` per side, `entryType: 'lend'\|'borrow'\|'settlement'`, immutable, `amount > 0` enforced by DB `CHECK` | [`shared/data-models/src/lib/direct-ledger-entry.entity.ts`](../../shared/data-models/src/lib/direct-ledger-entry.entity.ts) |
| Group balances are **always computed, never stored** (`BalancesService` docstring) | [`backend/src/app/settlements/balances.service.ts`](../../backend/src/app/settlements/balances.service.ts) lines 10–17 |
| `computeBalancesCore` folds `Expense` + `ExpenseSplit` + `ExpensePayment` (+ `Settlement` for the all-time view) per group, per currency, querying fresh each time — no cached/derived balance column | [`backend/src/app/settlements/settlements.service.ts`](../../backend/src/app/settlements/settlements.service.ts) lines 526–620+ |
| P2P balances are likewise computed on read (`buildLedger`), never stored as an aggregate | [`backend/src/app/people/person-ledger.service.ts`](../../backend/src/app/people/person-ledger.service.ts) lines 480–507; entity docstring lines 35–39 |
| Financial-calculation changes require the golden-fixture parity suite (FIN-002/ADR-017) before shipping | [`docs/architecture/adr/ADR-017-financial-parity-golden-fixtures.md`](./adr/ADR-017-financial-parity-golden-fixtures.md); actual suite at `backend/src/app/expenses/finance-golden/` (`golden-fixtures.ts`, `refund-parity.spec.ts`, `settlement-parity.spec.ts`, `split-parity.spec.ts`, `month-lock-parity.spec.ts`, `spectator-invariant.spec.ts`) |
| GOV-1 (additive baseline, backward compatibility is mandatory) | [`docs/architecture/FINMATE_DECISION_LEDGER.md`](./FINMATE_DECISION_LEDGER.md) lines 32–39; [`ADR-001`](./adr/ADR-001-protect-existing-functionality.md) |
| DEL-1 (deletion = personal erase + shared-record anonymize-in-place; row-DELETE is impossible today because of NOT-NULL user FKs on `direct_ledger_entries`/`expenses`/`settlements`/`audit_logs`) | `FINMATE_DECISION_LEDGER.md` lines 209–212; [`ADR-019`](./adr/ADR-019-deletion-cascade-tombstones.md) |
| Encryption zones: 1a (opaque E2EE), 1b (server-readable sensitive), 2 (protected plaintext for computation), 3 (isolated module); `amountTotal`/`category`/`expenseDate` are Zone 2, `title`/`description` are Zone 1a | [`FINMATE_DATA_CLASSIFICATION_ENCRYPTION_MATRIX.md`](./FINMATE_DATA_CLASSIFICATION_ENCRYPTION_MATRIX.md) line 40, lines 108–119 |
| PRIN-1 — use the least protective mechanism that satisfies the actual requirement (do not encrypt everything by default) | same file, lines 42–50 |
| Feature-flag registry exists with all-OFF-by-default convention; no `accounts.*` flag exists today | [`backend/src/app/platform/feature-flags.constants.ts`](../../backend/src/app/platform/feature-flags.constants.ts) |
| No deduplication/idempotency mechanism exists for imported financial events today — `import.service.ts` only has a same-request validation error ("Duplicate split entry for email…"), not cross-source event matching | `grep -n "duplicate\|dedup\|idempot" backend/src/app/import/import.service.ts` → single unrelated hit |
| `document-intelligence/engine` already has an extraction engine, a rule-based classification engine, adapters, and a `reconciliation.ts` (receipt-scoped) | `backend/src/app/document-intelligence/engine/` directory listing |
| `openapi.yaml` exists at repo root; no `accounts`/`transfers` path exists in it | `find . -iname openapi.yaml`; not re-opened in full for this document — **unverified in detail**, flagged below |

**Unavailable / not verified in this pass:**
- The full contents of `openapi.yaml` were not re-read in this session beyond confirming the file exists and that the prior `FUTURE.md` document already asserted no `accounts`/`transfers` path exists. If that assertion is load-bearing for a later approval, it should be re-checked before an ADR is written.
- `contacts.service.ts` (`resolveOrCreateIdentity`, `resolveMergeRedirect`) was not re-read line-by-line in this pass; its behavior is taken from `ADR-025`'s description, which was read directly. **Update (ACC-2 follow-up session):** `resolveOrCreateIdentity` — including its `dataSource.transaction`, optional-`manager`, advisory-lock, and unique-violation (`23505`) catch patterns — was subsequently read directly and verified; see Deliverable 10. `resolveMergeRedirect` itself remains not re-read line-by-line; its behavior is still taken from `ADR-025`'s description only.
- No frontend code was inspected for this document (the question set is backend/data-model-first; frontend account UX is out of scope for a schema decision).

---

## Deliverable 2 — Architecture Comparison (A1 derived vs. A2 dedicated ledger vs. hybrid)

| Dimension | A1 — Derived balances | A2 — Dedicated movement ledger | Hybrid (recommended) |
|---|---|---|---|
| Correctness for transfers/withdrawals | Requires a `Transfer`-like record to exist as the thing being derived *from* — "derived" only works if there's still an explicit event row per account-affecting action. Pure derivation from `Expense` alone cannot represent a transfer (no `Expense` is created for a transfer today, and shouldn't be, per the `FUTURE.md` Option A design). | Native — a `Transfer` row is exactly a movement. | Same as A2 for movements; "derived" applies only to the *displayed balance number*, not to whether an event exists. |
| Credit-card purchase vs. payment | Same problem as above: a "purchase" is already an `Expense`; a "payment" has no natural home unless it's an explicit movement. | Native — purchase increases liability via the `Expense.liabilityAccountId` link (read, not write), payment is an explicit `Transfer`. | Same as A2. |
| Historical balance reconstruction ("what was my balance on date X") | Requires summing all movements up to X each time, or snapshotting — expensive without stored checkpoints as data grows, but **this is exactly the pattern `computeBalancesCore` already uses for group balances** (always recompute, never store an aggregate) — proven to scale at FinMate's current size. | Same recomputation, but the movement rows are the authoritative source instead of a mix of `Expense`+inferred events — slightly simpler query (one table, not several joined). | A2's ledger as source of truth; balance-as-of-date is a read-time fold, matching the existing `BalancesService`/`PersonLedgerService` precedent of "always computed, never stored." |
| Duplicate-expense risk | High if "derive from Expense" is taken literally — a withdrawal or transfer would need to *not* be an `Expense` at all, which A1 as stated doesn't cleanly support without still introducing a `Transfer` entity (i.e., A1 collapses into A2 once transfers are handled correctly). | Low — `Transfer` and `Expense` are disjoint by construction; nothing sums both as spend. | Low, same as A2. |
| Future import/reconciliation (statements, messages) | Would need a staging layer regardless of A1/A2 — not differentiating. | Same. | Same — out of scope for this decision (see §9 of the `FUTURE.md`: message capture is explicitly deferred). |
| Schema/migration complexity | Lower on paper, but only because it under-specifies how transfers are represented — once that gap is closed it is not actually smaller than A2. | One new table (`transfers`) + two new nullable FKs on `Expense` (`sourceAccountId`, `liabilityAccountId`) — matches the `FUTURE.md` §5 sketch. | Same as A2. |
| Compatibility with existing `Expense`/`Settlement`/FIN-002 | Neutral if done right, **risky if "derive" is interpreted as adding a `transactionType: 'transfer'` value to `Expense`** — that would require every existing sum-over-`Expense` call site (dashboard, exports, goals, group balances) to add an exclusion filter, which is precisely the Option-B risk the `FUTURE.md` already rejected. | None of `Expense`'s existing summation call sites need to change — `Transfer` is a separate table nothing currently queries. | None of `Expense`'s existing summation call sites change. |
| Auditability | Weaker — "derived" implies the balance is a side effect, harder to point to "the record that caused this number." | Strong — every balance-affecting action has exactly one row explaining it, matching the audit expectations already established for `DirectLedgerEntry` ("immutable history... never mutated into a smaller amount"). | Strong, same as A2. |

**Recommendation:** reject pure A1 as specified — in this codebase, "derive balances from existing records" cannot correctly represent a transfer or a credit-card payment without first introducing an explicit movement record, at which point it is no longer meaningfully different from A2. The **hybrid** is in practice A2's schema (`Account` + `Transfer`, `Expense.liabilityAccountId`) with A1's *read discipline* (balances are always computed from the movement rows at read time, following the same "never store an aggregate" rule already proven by `BalancesService` and `PersonLedgerService` — no `Account.currentBalance` cached column). This is consistent with, not a new deviation from, existing FinMate practice.

---

## Deliverable 3 — Accounting Scenario Matrix

Each scenario states the effect using the **hybrid architecture** above
(`Account`, `Transfer`, `Expense.liabilityAccountId`/`sourceAccountId` as
*proposed, unauthorized* fields). Where a scenario depends on an unresolved
product decision, it is marked **[OPEN]**.

### Scenario A — Ordinary bank expense (₹500 from a bank account)

- **Expense reporting:** One `Expense` row, `amountTotal = 500`, `sourceAccountId = <bank>`. No change to existing spend totals (they don't filter by account today, and don't need to).
- **Cash/bank balance:** Bank `Account` balance (computed) decreases by 500 — a read-time fold over `Transfer`s *and* `sourceAccountId`-linked `Expense`s against that account.
- **Card liability:** Unaffected.
- **Group/settlement:** Unaffected — identical to today's behavior if this is a group expense.
- **P2P:** Unaffected.
- **History:** One row, same as today.

### Scenario B — Cash withdrawal (₹2,000 bank → cash)

- **Expense reporting:** **No `Expense` row is created.** This is the core correctness requirement — a withdrawal must not inflate spend totals.
- **Bank/cash balance:** One `Transfer` row (`transferType: 'withdrawal'`, `fromAccount: bank`, `toAccount: cash`, `amount: 2000`). Bank −2,000, Cash +2,000.
- **Card liability / Group / P2P / History:** Unaffected.

### Scenario C — Credit-card purchase (₹2,000)

- **Expense reporting:** One `Expense` row as today, `amountTotal = 2000`, plus `liabilityAccountId = <card>`. Spend totals are unaffected (the `Expense` already exists in every total it exists in today).
- **Card liability:** Increases by 2,000 — read as `sum(Expenses where liabilityAccountId = this card) − sum(Transfers of type credit_card_payment into this card)`.
- **Bank balance:** Unchanged at purchase time.
- **Group/P2P:** Unaffected unless this is also a group expense (orthogonal — `liabilityAccountId` and `group` are independent fields).

### Scenario D — Credit-card bill payment (₹2,000 bank → card)

- **Expense reporting:** **No second `Expense` row.** This is the scenario the brief's §10.2 explicitly warns about, and the one that most directly justifies rejecting Option B (a `transactionType` tag on `Expense` makes it tempting to create a second "expense" here, which would double-count).
- **Bank balance:** One `Transfer` (`transferType: 'credit_card_payment'`, `fromAccount: bank`, `toAccount: card`, `amount: 2000`). Bank −2,000.
- **Card liability:** Decreases by 2,000 (per the formula in Scenario C, this `Transfer` is the subtracted term).
- **Group/P2P/History:** Unaffected.

### Scenario E — Shared expense (₹2,400 meal, user's share ₹800)

- **Expense reporting:** **Unchanged from today.** This is already correctly handled by the existing `Expense` + `ExpenseSplit` + `ExpensePayment` model: one `Expense` (`amountTotal = 2400`), one `ExpensePayment` row (the user paid 2400), three `ExpenseSplit` rows (`amountOwed`: 800/800/800). `computeBalancesCore` already nets this correctly — the other two members' `amountOwed` becomes what they owe the group, settled via `Settlement`.
- **Account balance:** The user's funding account (`sourceAccountId`) decreases by the **full 2,400 they actually paid**, not their 800 share — the account reflects real cash movement, the `Expense`/`Settlement` layer reflects who-owes-whom. These are two independent reads over the same underlying payment fact, exactly as `FUTURE.md` §5 specifies ("a second, independent read, never fed back into `SettlementsService`/FIN-002").
- **Group balances/settlements:** **Unchanged — must not be modified.** This was an explicit constraint in the task (`ADR-017`/FIN-002 parity).
- **P2P:** Not involved unless this is a group-less direct split, which the existing group-expense model already covers.

### Scenario F — P2P lending (₹1,000 cash to a non-FinMate person)

- **Account balance:** One `Transfer`-shaped cash outflow is needed, but a plain `Transfer` has no counterparty-person concept — **[OPEN]**: does recording this lending create (a) a `Transfer` from the cash `Account` to a new pseudo-account representing "money out, owed back" that the Account model invents, or (b) a `Transfer` out of cash *plus* a `DirectLedgerEntry` (`entryType: 'lend'`, `fromUser: self`, `toContact: <person>`) via the **existing, unmodified** P2P mechanism? Reusing (b) avoids inventing a second receivables concept.
- **DirectLedgerEntry (existing, unmodified):** records the ₹1,000 receivable from the Contact, exactly as it does today for a lending event with no account layer at all.
- **Expense reporting:** No `Expense` is created — lending is not consumption, matching the brief's §10.3 and the existing `DirectLedgerEntry.entryType` semantics.
- **[RESOLVED — Decision Status, ACC-2]:** approved as one combined user action that writes both the cash `Transfer` and the `DirectLedgerEntry`. **Not yet designed:** the combined action does not exist in the codebase today — `Transfer` doesn't exist and no service method coordinates it with `DirectLedgerEntry` creation. See Deliverable 5b for the transactional-consistency, failure-handling, and duplicate-creation-risk requirements that must be answered before this is implementable.

### Scenario G — Repayment (₹400 of the ₹1,000 loan)

- **Account balance:** `Transfer` in: cash `Account` +400 (money received), or bank +400 if repaid electronically.
- **DirectLedgerEntry (existing, unmodified):** a new `entryType: 'settlement'` row reduces the outstanding receivable from 1,000 to 600, exactly as the existing P2P repayment mechanism already does with no account layer involved.
- **Expense reporting:** Not treated as income — no `Expense` row, matching the brief's §10.5 and existing `entryType` semantics (a repayment is not a second financial event, it's the same obligation netting down).
- **[RESOLVED — ACC-2]:** the same combined-action approval from Scenario F applies to repayment; the same unresolved design requirements (Deliverable 5b) also apply.

### Scenario H — Refund (₹300 on a previously recorded expense)

- **Expense reporting:** **Already solved, unrelated to the Account model.** `Expense.transactionType: 'refund'` already exists today (`expense.entity.ts` lines 56–65) and is covered by the existing `refund-parity.spec.ts` golden-fixture test — a refund is modeled as an inverted-sign `Expense`, not a mutation of the original row. This document does not need to design refund semantics; they predate this proposal.
- **Account balance — the genuinely new question:** **[RESOLVED — ACC-3, approved]:** crediting an `Account` for a refund is always a separate, explicit manual entry — never automatic and never inferred from the refund `Expense`. The existing refund `Expense` mechanism (`transactionType: 'refund'`, `refund-parity.spec.ts`) is preserved exactly as it is today; this decision only concerns the new Account layer, which has no write coupling to `Expense` creation.
- **History:** Both the original `Expense` and the refund `Expense` remain, linked by existing means (not re-specified here) — no row is rewritten.

### Scenario I — Duplicate event (same transaction entered twice / appearing from two sources)

- **Current reality:** **No deduplication or idempotency mechanism exists anywhere in the codebase today** for cross-source financial events (confirmed by inspection — see Deliverable 1). `import.service.ts`'s only "duplicate" handling is an in-request validation error for a same-email split conflict, unrelated to this concern.
- **Implication for the Account model:** if a withdrawal or transfer is ever producible from more than one source in the future (manual entry today; message capture is explicitly out of scope per `FUTURE.md` §9), duplicate `Transfer` rows are not currently prevented by any mechanism and none should be assumed. For the manual-entry-only first slice, this risk is **structurally limited** (a human re-entering the same withdrawal twice is a user error, not a multi-source collision) but is **not solved** — it should be explicitly listed as **out of scope** for the first release rather than silently assumed safe.
- **[RESOLVED — ACC-9, approved]:** out of scope for v1. This remains a known, explicitly documented limitation — it must not be represented, implied, or relied upon as "duplicates are prevented" in any later design or user-facing copy, including once message capture is eventually built.

---

## Deliverable 4 — Recommended Architecture

**Recommendation:** the hybrid described in Deliverable 2 — an explicit,
immutable `Transfer`/movement ledger (A2's schema) read with the same
"always-computed, never-stored-aggregate" discipline FinMate already applies
to group balances (`BalancesService`) and P2P balances (`PersonLedgerService`)
(A1's read pattern, applied correctly). This is not a new architectural style
for FinMate — it is the same pattern used twice already, applied to a third
domain.

**Minimum conceptual model** (proposed, not authorized — same sketch as
`FUTURE.md` §5, repeated here for scenario traceability only):

```
Account       — id, ownerUser, type (cash|bank|credit_card), displayName,
                openingBalance, currency, isArchived, version
Transfer      — id, fromAccount, toAccount, amount, currency, occurredAt,
                transferType (withdrawal|deposit|manual_transfer|credit_card_payment),
                createdByUser, version
Expense       — + sourceAccountId (nullable FK -> Account)
              — + liabilityAccountId (nullable FK -> Account, credit-card purchases only)
```

**Invariants that must hold** (derived from the scenarios above and from
existing FinMate precedent — `ADR-017`/FIN-002, `DirectLedgerEntry`
immutability):

1. A `Transfer` never creates, modifies, or is summed into an `Expense`, and vice versa — the two tables are disjoint inputs to two independent balance reads (mirrors Scenario E's "two independent reads" rule, already stated in `FUTURE.md`).
2. `Account` balance is **always computed** at read time from `Transfer` + `sourceAccountId`/`liabilityAccountId`-linked `Expense` rows; no cached balance column (matches existing `BalancesService`/`PersonLedgerService` pattern).
3. Existing group-settlement balance calculations (`computeBalancesCore`, `simplifyLedgerDebts`) and the FIN-002 golden-fixture suite remain byte-for-byte unchanged — nothing in this model feeds back into them.
4. Existing `DirectLedgerEntry` P2P semantics remain unchanged — lending/borrowing/repayment continue to be represented there; the Account model supplies the *funding-side* cash movement only (Scenario F/G), never a second receivables mechanism.
5. `Transfer` and `Account` rows are never hard-deleted once they have affected a balance another calculation has read, **pending counsel's determination of the applicable rule** — see Deliverable 8, which also notes `Account`/`Transfer` are single-owner (unlike the shared records `DEL-1` was written to protect), so whether `DEL-1`'s anonymize-in-place rule or a simpler hard-delete applies is not yet settled.

---

## Deliverable 5 — Product Decision Register

No official Decision-Ledger IDs exist yet for this domain (it is unbuilt); the
`ACC-*` labels below are **proposed for this document's internal
cross-referencing only** — they are not Decision Ledger entries and must not
be treated as such until someone actually authors them there.

| ID (proposed, not official) | Question | Options | Recommended | Consequences | Owner | Approval needed | Status |
|---|---|---|---|---|---|---|---|
| ACC-1 | Derived vs. dedicated ledger (Deliverable 2) | A1 / A2 / Hybrid | Hybrid | Determines whether a `Transfer` table exists at all | Product + Engineering | Product decision | **Approved (product owner) — Hybrid** |
| ACC-2 | Does lending (Scenario F) write `Transfer` + `DirectLedgerEntry` together or as two user steps? | Combined action / Two separate actions | Combined | UX friction vs. risk of an inconsistent half-recorded loan | Product | Product decision | **Approved (product owner) — combined action**; transactional consistency/failure handling/duplicate-creation risk remain open design requirements (Deliverable 5b) |
| ACC-3 | Does a refund `Expense` (Scenario H) auto-credit an `Account`, or is crediting always a separate explicit entry? | Automatic / Manual | Manual (first slice) | Automatic is convenient but introduces a new `Expense`→`Account` write coupling that doesn't exist anywhere today | Product | Product decision | **Approved (product owner) — manual, separate entry** |
| ACC-4 | Encryption zone for `Account.displayName` | Zone 1a (E2EE) / Zone 2 (plaintext-but-protected) | Zone 2, per PRIN-1 (server needs it to compute/display balances; low sensitivity relative to `title`/`description`) | Zone 1a would block server-side balance display entirely without client-side decryption plumbing that doesn't exist for this domain yet | Product + Security | Product decision, informed by `FINMATE_DATA_CLASSIFICATION_ENCRYPTION_MATRIX.md` | **Product direction selected: Zone 2 — security review still required (approval type is Product + Security; only the Product half is done)** |
| ACC-5 | Encryption zone for `Account.openingBalance`/running balance | Zone 2 (plaintext-but-protected, consistent with `amountTotal`) | Zone 2 | Matches existing precedent for all other computed financial amounts | Product + Security | Product decision | **Product direction selected: Zone 2 — same open security-review condition as ACC-4** |
| ACC-6 | Deletion/anonymization extension to `Account`/`Transfer` (Deliverable 7) | Extend DEL-1's anonymize-in-place rule / invent a new rule | Extend DEL-1 | A new rule risks contradicting the frozen DEL-1 decision; extension is additive | Counsel + Engineering | **[COUNSEL REQUIRED]**, same gate as DEL-1 itself | **UNCHANGED — unresolved, blocked on counsel, same as DEL-1. No position inferred.** |
| ACC-7 | Build now (Option A, scoped) vs. defer (Option C) — from `FUTURE.md` | Build scoped slice / Defer | Build scoped slice (manual entry only) | Defer leaves brief §6/§10 permanently unaddressed | Product | Product decision | **Approved (product owner) — build scoped slice** |
| ACC-8 | Mandatory vs. optional account linking on `Expense` | Optional / Mandatory / Gradual | Optional (see analysis below) | Mandatory breaks every existing expense-creation flow for all current users — a GOV-1 violation unless migrated carefully | Product | Product decision | **Approved (product owner) — optional; existing `Expense` workflows/semantics unchanged** |
| ACC-9 | Duplicate-entry protection scope for manual entry (Scenario I) | In scope for v1 / Out of scope for v1 | Out of scope for v1 | No existing dedup mechanism anywhere to extend; building one is a separate, larger workstream (relevant once message capture exists) | Product + Engineering | Product decision | **Approved (product owner) — out of scope for v1; documented as a known limitation, not a solved problem** |

### Deliverable 5a — Account-linking optionality (§5 of the brief task)

- **Option A — Optional:** existing `Expense` creation is untouched; `sourceAccountId` is a nullable add-on. **No migration risk, no onboarding friction, no existing-user impact.** Balance history is necessarily incomplete for any expense created before the user starts linking accounts (and for any user who never links one) — this is expected and acceptable, not a defect, because Account balances are an opt-in secondary view, not the primary ledger.
- **Option B — Mandatory:** every new `Expense` must carry an account. This **directly violates GOV-1** ("existing functionality is a protected baseline... never assume clean-slate") for every current user who creates expenses today without ever having heard of an "account" — it would force a UI/flow change on day one for 100% of existing usage. **Not recommended.**
- **Option C — Gradual:** optional now, with a possible future prompt/nudge once accounts exist. Reasonable **long-term** direction but is a UX decision layered on top of Option A's schema, not a different schema — effectively "Option A now, revisit the nudge later."
- **Recommendation: Option A**, with C as a legitimate later UX refinement, not a different decision today.
- **Approved — see Decision Status above:** Option A (optional) is the product owner's selection, recorded 2026-10-29. Existing expense workflows and semantics are unchanged by this decision.

### Deliverable 5b — ACC-2 design requirements (combined lending action)

Approving "one combined action" (ACC-2) is a product decision, not a design.
Before this can move into an implementation plan, the following must be
specified — these are requirements to carry forward, not answers this
document provides:

1. **Transactional consistency.** The combined action writes two rows in two
   different tables (`Transfer`, which does not exist yet, and
   `DirectLedgerEntry`, which exists and is immutable today). The design must
   state whether both writes happen inside a single database transaction (so
   a failure after the `Transfer` insert but before the `DirectLedgerEntry`
   insert rolls back cleanly). **Correction (verified in the ACC-2 follow-up
   session — see Deliverable 10):** the original note here claimed this was
   "consistent with how `DirectLedgerEntry` itself is already written inside
   the caller's transaction in `PersonLedgerService` today." **That claim was
   inaccurate and is withdrawn.** `createDirectTransaction`/
   `createDirectSettlement` today are each a single `repository.save(entry)`
   call with no `dataSource.transaction()` wrapper. Deliverable 10 identifies
   the actual existing convention (`settlements.service.ts`,
   `contacts.service.ts`) and a corrected recommendation.
2. **Failure handling.** If the combined action partially succeeds (e.g. the
   `Transfer` is recorded but the `DirectLedgerEntry` write fails after
   commit, or vice versa, in any design that does not use a single
   transaction), the design must state the recovery path — retry,
   compensating entry, or a surfaced error — before implementation. Silent
   partial failure is not an acceptable default given `DirectLedgerEntry`'s
   immutability guarantee.
3. **Duplicate-creation risk.** A combined action that can be resubmitted
   (double-click, retry after a timeout) must not create two `Transfer` rows
   or two `DirectLedgerEntry` rows for the same loan. No idempotency
   mechanism for this exists anywhere in the codebase today (see
   ACC-9/Scenario I). The combined action's own idempotency is a **separate,
   narrower requirement from ACC-9's general duplicate-entry decision** and
   must be designed explicitly — it is not resolved by ACC-9 being out of
   scope, since ACC-9 concerns cross-source duplicates, not a single action's
   own retry safety.

None of these three requirements is resolved by approving the "combined
action" direction itself. They must be addressed in the eventual
implementation plan for ACC-2.

---

## Deliverable 6 — Next Governance Artifacts (ACC-1/ACC-7 are now approved; the sequence below is still blocked by ACC-6 and the ACC-4/ACC-5 security review — see Deliverable 12)

In the order the existing P2P work (`ADR-025`, P2P-1..4) established as
precedent:

1. **Decision Ledger addendum** — new dated entries (`ACC-1` through whichever of the above are approved) added to `FINMATE_DECISION_LEDGER.md`, following the exact per-entry format already used there (Decision · Status · Type · Reason · Security/Privacy impact · Existing-fn · Prod-data · Migration · Rollback · Platform · Dependencies).
2. **A real ADR** (next number after `ADR-025`) recording the *already-approved* decision — per this repo's own rule, written only after the Decision Ledger entries exist, not before.
3. **Update to `ADR_INDEX.md`** adding the new ADR's row.
4. **Requirements/SRS entries** (if this repo's SRS numbering scheme, e.g. `FIN-0xx`, is extended to cover Account/Transfer — not inspected in this pass).
5. **Migration design doc** — additive migration adding `accounts`/`transfers` tables and the two nullable `Expense` FKs, following the non-destructive, guarded-`down()` pattern already used in `1720400000000-AddDirectLedgerContactIdentity` (P2P-1's migration).
6. **Test/parity plan** — a new, *separate* golden-fixture-style suite for Account/Transfer balance correctness (its own invariant set, distinct from and never merged into FIN-002's finance-golden suite), covering Deliverable 3's scenarios A–I as concrete fixtures.
7. **Feature flag registration** — a new `accounts.*` entry in `feature-flags.constants.ts`, default OFF, following the existing registry's convention exactly.
8. **Update to `architecture-inventory.md`/`FINMATE_MODULE_DATA_OWNERSHIP_MAP.md`** (existence confirmed, contents not re-verified in this pass) to add the new module's ownership boundary.

**Not written in this document:** any of the above. This document stops at
the decision register.

---

## Deliverable 7 — Explicit Approval Gate (updated — 2026-10-29)

Items 1–5 below are now **approved**, per the Decision Status block at the
top of this document. They are retained here, marked accordingly, so this
gate stays a complete record rather than being deleted once satisfied.

**Mandatory product decisions:**

1. **ACC-7 / ACC-1** — ~~build vs. defer~~ **APPROVED: build, Hybrid architecture.**
2. **ACC-8** — ~~optional vs. mandatory~~ **APPROVED: optional; existing `Expense` workflows and semantics unchanged.**
3. **ACC-2** — ~~combined vs. two steps~~ **APPROVED: combined action** — but Deliverable 5b's transactional-consistency, failure-handling, and duplicate-creation-risk requirements remain unresolved design questions, not satisfied by this approval.
4. **ACC-3** — ~~automatic vs. manual~~ **APPROVED: manual, separate entry; existing refund `Expense` semantics unchanged.**
5. **ACC-9** — ~~in scope vs. out of scope~~ **APPROVED: out of scope for v1** — documented as a known limitation, not a solved problem.

**Still requires counsel, not satisfied by product sign-off:**

6. **ACC-6** — **UNCHANGED, still blocked.** The deletion/anonymization extension to `Account`/`Transfer` remains `[COUNSEL REQUIRED]`, the same open gate `DEL-1` itself carries. No position is inferred here, and none of the approvals above resolve it.

**Still requires a security review, not satisfied by product direction alone:**

6b. **ACC-4 / ACC-5** — the product owner has selected **Zone 2** as the direction for `Account.displayName` and `Account.openingBalance`/balance fields, but this row's own approval type is "Product **+ Security**" — a security review of that selection has not occurred and is not implied by this update.

**Net effect on implementation-planning readiness:** approving gate items
1–5 above resolves **six of the nine** `ACC-*` decisions (`ACC-1`, `ACC-2`,
`ACC-3`, `ACC-7`, `ACC-8`, `ACC-9` — item 1 bundles two IDs, `ACC-7`/`ACC-1`).
**Three remain open: `ACC-4`/`ACC-5` (security review pending) and `ACC-6`
(counsel-blocked).** Per the `ADR-025`/P2P-3 precedent — where
engineering readiness was explicitly distinguished from governance approval —
**migration design (Deliverable 6 item 5) and any ADR/Decision Ledger
drafting remain blocked** until ACC-6 clears counsel and the ACC-4/ACC-5
security review completes, because the migration must define the new
tables' FK nullability/cascade behavior, which depends on how ACC-6
resolves.

**Can remain engineering parameters (unchanged):**

- Exact migration file naming/ordering.
- Exact feature-flag env-var name.
- Exact test-fixture file names/locations within the new Account test suite.
- `Account.type` enum value spelling (`credit_card` vs `creditCard`, etc. — internal consistency only).

---

## Deliverable 8 — ACC-6 Counsel Brief

**Not a legal determination. Does not mark ACC-6 approved. No position of
counsel is inferred or assumed anywhere below.**

### Evidence summary (verified this session)

| Fact | Source |
|---|---|
| DEL-1: account deletion = personal erase + **anonymize-in-place** for shared financial records; status **LOCKED (arch); COUNSEL REQUIRED (retention basis)**. Reason given: `direct_ledger_entries`/`expenses`/`settlements`/`audit_logs` have **existing NOT-NULL user FKs that make row-DELETE impossible without corrupting other users' ledgers**. | `FINMATE_DECISION_LEDGER.md` lines 209–212 |
| DEL-1's own migration note: **"New deletion service (no current delete feature)."** | same, line 212 |
| ADR-019 (deletion cascade + tombstones): **Implementation state: TARGET** — i.e., not built. Decision = personal-scope erase + crypto-shred + shared anonymize/tombstone + mark-stale→recompute via durable outbox + tombstone replay after restore. | `docs/architecture/adr/ADR-019-deletion-cascade-tombstones.md` |
| DEL-2: backup-restore tombstone replay — **LOCKED (ENGINEERING REQUIRED)**. | `FINMATE_DECISION_LEDGER.md` line 214–217 |
| DEL-3: departed-user personal content retained in shared free-text — **COUNSEL REQUIRED**, unresolved (adversarial-review finding N4). | `FINMATE_DECISION_LEDGER.md` line 219–222 |
| **Correction (ACC-4/5/6 review-package session, superseding the claim below): `DELETE /users/me` IS implemented and tested.** `UsersController.deleteMe` (`users.controller.ts` lines 89–92) calls `UsersService.deleteAccount` (`users.service.ts` lines 236–287), with dedicated test coverage (`users.service.spec.ts`, `describe('deleteAccount', ...)`, lines 340–398+). It anonymizes `User` PII in place inside `this.dataSource.transaction(...)` (email → `deleted-<uuid>@deleted.finmate`, username/phone/displayName cleared, password hash replaced, 2FA/encryption key material cleared, status → `disabled`) and nulls `Profile.avatarUrl` — but **never deletes the `User` row or its `id`**, and **does not touch `profile.monthlyIncome`/`monthlyBudget`**, which remain on the (now-anonymized) Profile row. The docstring states the policy directly: *"anonymizes personal data... while preserving all financial history (expenses, splits, settlements, versions, audit logs) for ledger integrity. Irreversible."* | `backend/src/app/users/users.controller.ts` lines 89–92; `backend/src/app/users/users.service.ts` lines 236–287; `backend/src/app/users/users.service.spec.ts` lines 340–398 |
| ~~Original (stale) claim: account deletion is entirely unimplemented today~~ — this was based on `docs/architecture/gap-tracker.md` line 33 / `docs/architecture/adr-map.md` line 22, which are themselves now stale relative to the current code. **Do not rely on those two lines without re-verifying the actual source.** | superseded by the row above |
| Proposed `Account`/`Transfer` schema (Deliverable 4, **not authorized**) carries the same NOT-NULL-FK shape DEL-1 already relies on: `Account.ownerUser`, `Transfer.createdByUser` (both proposed NOT NULL → `User`). | This document, Deliverable 4 |

### What is genuinely new about Account/Transfer vs. DEL-1's existing scope

DEL-1's "anonymize-in-place" compromise exists specifically because `expenses`
(group-shared) and `direct_ledger_entries` (shared between two Users) are
**shared financial records** — deleting the row would corrupt *another
user's* ledger. Per the **approved** ACC-7/ACC-1/ACC-8 scope, `Account` and
`Transfer` are **single-owner only** — no group accounts, no shared accounts
were proposed or approved anywhere in this document. This is a factual
distinction, not a legal one: it means the specific justification DEL-1 gives
for *why* anonymize-in-place (rather than hard delete) is necessary may not
transfer directly to `Account`/`Transfer`, because there is no second user's
ledger to protect. Whether that factual difference changes the legally
correct answer is exactly what counsel needs to determine — this document
does not assume it does.

**One exception:** if ACC-2's approved "combined action" links a `Transfer`
to an existing `DirectLedgerEntry` (which *is* shared with a Contact/other
User), the `DirectLedgerEntry` side remains governed by DEL-1 exactly as it
is today, unaffected by anything here. Only the `Transfer` row itself is the
new, single-owner case.

### Question list for counsel

1. Given `Account`/`Transfer` are single-owner (not shared between Users, unlike `direct_ledger_entries` or a group `expense`), does DEL-1's anonymize-in-place compromise still need to apply, or can personal `Account`/`Transfer` rows be hard-deleted on account deletion — true Art. 17 erasure — without the shared-ledger-corruption concern that originally justified DEL-1 for the other tables?
2. If hard-delete is permitted for `Account`/`Transfer`, does that create any inconsistency with DEL-2's backup-restore tombstone-replay requirement — would deleted Account/Transfer data need a tombstone to survive a restore the same way other deletions do, or does a genuinely single-owner hard-delete avoid needing one?
3. Does `Account.displayName` (a user-chosen label, e.g. a bank or card name) raise the same "departed-user personal content in retained shared free-text" concern DEL-3 flags for other free-text fields — or does DEL-3 not apply at all once Account/Transfer are confirmed single-owner-only?
4. **(Corrected — see Deliverable 15 §A for the verified current behavior.)** `DELETE /users/me` **is** implemented today as in-place anonymization of `User`/`Profile` identity fields, never a row-delete, with all financial history (including the `User.id` itself) left untouched. Should `Account`/`Transfer` simply extend this *already-shipped* pattern (anonymize the owning `User`'s identity fields; leave `Account`/`Transfer` rows and their `ownerUser`/`createdByUser` FK untouched, exactly as `Expense`/`DirectLedgerEntry` already are today), or does `Account`/`Transfer`'s single-owner nature (vs. `Expense`'s group-shared, multi-party nature) call for different treatment?
5. Does retaining historical `Transfer`/`Account` records for a departed user raise a different retention-basis question than `expenses`/`direct_ledger_entries` already do, given `Account.displayName` could name a specific financial institution alongside a balance amount?

---

## Deliverable 9 — ACC-4/ACC-5 Security-Review Brief

**Not a security approval. Does not weaken or alter any existing encryption.
Zone 2 remains a product-selected direction only.**

### Encryption architecture inspected (verified facts)

| Fact | Source |
|---|---|
| Two encryption systems exist: (a) client-side E2EE (Web Crypto, PBKDF2 master key + per-group AES-256-GCM, RSA-OAEP wrapping) for expense/note/recurring free-text + attachment keys; (b) server-side `EncryptionService` (AES-256-GCM, key = SHA-256(`ENCRYPTION_KEY`)) used **only** for 2FA secrets and `profile.avatarUrl` today. | `FINMATE_DATA_CLASSIFICATION_ENCRYPTION_MATRIX.md` §4 |
| Zone model: 1a (opaque E2EE), 1b (server-readable sensitive), 2 (protected plaintext for computation), 3 (isolated module). | same, line 40 |
| PRIN-1: use the **least protective mechanism** that satisfies the actual requirement — do not encrypt everything by default. | same, lines 42–50 |
| **FLD-3** (`group.name`) / **FLD-4** (`group_member.nickname`): functional display identifiers that the server must read for UI/navigation/search → **Zone 2, not E2EE** — "forcing E2EE would redesign ... functionality (GOV-1/GOV-2)." | same, lines 309–341 |
| **FLD-5** (`profiles.monthlyIncome`/`monthlyBudget`): sensitive financial **amount** → **Zone 2, plaintext-but-protected, with strict access control + consent-gated personalization use** — explicitly **not** E2EE. Finding: "Legitimately server-readable for budgeting math, but income is high-sensitivity — flag for access-tightening, not encryption." | same, lines 343–354 |
| OPS-1: all Zone 2 plaintext fields carry a documented, already-accepted residual risk that a DBA with direct DB access can read them in plaintext. | same, lines 322, 348, 420–421 |

### Data flow — `Account.displayName`

Client submits plaintext over TLS → stored plaintext → server must read it
every time it renders an account list/dropdown or computes a balance (the
read-time fold is server-side per the approved ACC-1 Hybrid architecture,
Deliverable 4). Zone 1a (E2EE) would block that server-side read entirely
without new client-decryption plumbing that no FinMate feature currently
builds for this domain. **Closest precedent: FLD-3/FLD-4** — same
"functional identifier the server must read" rationale.

**Privacy implication:** `Account.displayName` can name a specific financial
institution or card (e.g., "HDFC Savings", "Chase ending 4321" if the user
types that) — comparable sensitivity to `group.name`/`group_member.nickname`
(already Zone 2), arguably somewhat higher since it can identify a specific
bank relationship.

### Data flow — `Account.openingBalance` / computed balance

Client submits a plaintext decimal amount, stored and read exactly like
`expense.amountTotal`/`profile.monthlyIncome` today. Server-side computation
is required because the approved ACC-1 architecture (Deliverable 4) mandates
a read-time balance fold across `Transfer`/`Expense` rows — E2EE would make
that server-side computation impossible without client-side aggregation,
which no existing Zone 2 financial field in this codebase uses.

**Privacy implication:** a running account balance is comparable in
sensitivity to `profile.monthlyIncome` — both reveal financial standing.
**FLD-5 is the most directly transferable precedent found**: its resolution
(Zone 2 + *strict* access control + consent-gated personalization use, not
encryption) is a better fit than treating `Account.openingBalance` like an
ordinary Zone 2 field (e.g. `expense.category`), which carries no such
access-tightening qualifier.

### Security risks flagged (not resolved here)

1. **OPS-1 residual** (DBA plaintext access) — inherited from every existing Zone 2 field, not new.
2. **Combined sensitivity:** an `Account.displayName` + balance pair names an institution *and* an amount together — a more complete financial profile than either `expense.amountTotal` or `profile.monthlyIncome` alone. Whether this combination warrants FLD-5's "strict access control" qualifier, or something stricter, is the open security-review question this brief surfaces but does not answer.
3. **AI access:** FLD-5 explicitly requires "raw income never sent to external AI; only a minimum-necessary derived projection when permitted." No equivalent restriction has been decided for Account data. If any future AI feature references Account balances, the same restriction should at minimum be considered — flagged, not resolved.

### Reviewer / approval mechanism found in the repository

**No distinct "security reviewer" role or formal security-review process
document was found** (searched `FINMATE_SECURITY_PRIVACY_ARCHITECTURE.md`,
`FINMATE_KEY_MANAGEMENT_ARCHITECTURE.md`, `FINMATE_DECISION_LEDGER.md`; no
hits for a defined reviewer role or review procedure specific to encryption
zone assignment).

The only comparable documented approval mechanism in this repository is the
**governance-owner (project owner) sign-off** used for `P2P-CNT-3`:
*"APPROVED by the FinMate governance owner (project owner) on 2026-09-10 ...
This authorizes the engineering/security boundary ... — it is not a legal
determination."* (`FINMATE_DECISION_LEDGER.md` line 570). Whether that same
mechanism is intended to satisfy ACC-4/ACC-5's "Product + Security" approval
type is **not decided here** — this brief only reports that no *other*
mechanism is documented in the repository.

Separately, `FLD-1`–`FLD-7` (including the directly-precedential FLD-5) were
themselves decided **inside** `FINMATE_DATA_CLASSIFICATION_ENCRYPTION_MATRIX.md`,
with an explicit note that they are "new LOCKED product/architecture
decisions made in this review" pending back-port into the Decision Ledger —
i.e., this repository already has a precedent for deciding a zone assignment
in a preparatory document first and back-porting it later, which is the same
workflow this ACC-* document follows. That precedent supports *how* ACC-4/5
could eventually be finalized once an actual reviewer signs off — it does
not substitute for that sign-off.

---

## Deliverable 10 — ACC-2 Consistency & Failure-Handling Design Analysis

### Correction to this document's prior claim

Deliverable 5b previously asserted the proposed transactional design was
"consistent with how `DirectLedgerEntry` itself is already written inside
the caller's transaction in `PersonLedgerService` today." **That claim has
been verified false and withdrawn** (see the inline correction in
Deliverable 5b). `PersonLedgerService.createDirectTransaction`/
`createDirectSettlement` each call a single `this.directLedgerRepository.save(entry)`
— one row, no `dataSource.transaction()` wrapper. This section replaces that
claim with verified evidence.

### Verified persistence/transaction conventions

| Pattern | Where verified | Shape |
|---|---|---|
| Multi-row atomic write via `dataSource.transaction` | `backend/src/app/settlements/settlements.service.ts` — `recordPayment` (lines 1043–1059), `proposeSettlement` (~885), `updateSettlement` (~1136) | `await this.dataSource.transaction(async (manager) => { ...manager.create/save... })`; e.g. `recordPayment` creates `Settlement` **and** calls `recordSettlementVersion(manager, ...)` inside one transaction, then fires `void this.writeAuditLog(...)` **after** commit (non-blocking, outside the transaction). |
| Same pattern + optional shared-transaction join | `backend/src/app/contacts/contacts.service.ts` — `resolveOrCreateIdentity` (lines 165–266) | Accepts an **optional `manager?: EntityManager`** parameter; if the caller already has an open transaction, the method joins it (`manager.getRepository(...)`) instead of opening a second, independently-committing one. Explicit comment: "a Contact created here must live or die with the same transaction as the GroupMember it backs." |
| Concurrency serialization | `contacts.service.ts` — `withIdentityLock` | Postgres **advisory transaction lock** (`pg_advisory_xact_lock`), keyed by a normalized identifier, held only for the enclosing transaction's duration. |
| Defense-in-depth against a duplicate **identity** row | `contacts.service.ts` `resolveOrCreateIdentity`, lines ~230–249 | Catches Postgres unique-violation (`error code 23505`) on insert, re-fetches, and returns the existing winning row instead of surfacing a 500 — backstops the advisory lock. |
| **No transaction wrapper at all** | `backend/src/app/people/person-ledger.service.ts` — `createDirectTransaction` (lines 294–320), `createDirectSettlement` (327–379) | Each is a single `repository.save(entry)` call. Atomic only because it is one row — no multi-statement transaction exists here today. |
| **No idempotency-key / double-submission guard anywhere** | Repository-wide search (`idempotency`, `idempotent`, `requestKey`, `clientRequestId`, `dedupeKey`) | All hits are comments describing other operations' *read-side* idempotency (e.g., marking a notification seen, restoring an already-active tag, revoking an already-revoked share) — none concern preventing a duplicate **create** from a resubmitted write. `recordPayment` itself — the closest existing one-step financial-recording action — has no such guard either. |

### Analysis of the three Deliverable 5b requirements

1. **Transactional consistency — recommendation:** wrap the combined action in `this.dataSource.transaction(async (manager) => {...})`, following `recordPayment`'s exact shape — create the `Transfer` row and write the `DirectLedgerEntry` using the **same `manager`**, so both commit or roll back together. This requires extending `PersonLedgerService.createDirectTransaction`/`createDirectSettlement` to accept an **optional `manager: EntityManager` parameter**, exactly the convention `contacts.service.ts.resolveOrCreateIdentity` already established for joining an open transaction instead of starting a second one. **This is a proposed, scoped code change — not made, not authorized by this document.**
2. **Failure handling — resolved by construction, if (1) is implemented correctly.** A single Postgres transaction is all-or-nothing; there is no partial-success state to design a compensating-transaction or retry path for, provided both writes genuinely share one `manager`. The remaining risk is purely implementation correctness (did the code actually pass the shared `manager` through), not a design gap.
3. **Duplicate-creation risk from resubmission — not resolved, and the nearest existing pattern does not transfer cleanly.** `contacts.service.ts`'s unique-constraint + advisory-lock + 23505-catch pattern works *because* Contact identity has a natural uniqueness key (normalized email/phone). A combined lending action has no such key — two genuine ₹1,000 loans to the same person on the same day are legitimate and must not collide on any uniqueness constraint. No client-supplied idempotency-key mechanism exists anywhere in this codebase to reach for instead, and `recordPayment` — the closest existing precedent — has the identical gap. **This is an existing, repo-wide limitation that Account/Transfer would inherit, not a new gap this feature introduces.** Recommendation: treat single-action double-submission risk for the combined lending action as covered by the already-approved ACC-9 scope exclusion (out of scope for v1), rather than inventing a new idempotency mechanism unprecedented anywhere else in the codebase. **This is a recommendation for product-owner confirmation (tracked as ACC-2a below), not a decision made here.**

### Three distinct concerns for ACC-2a — do not conflate

The out-of-scope status of general duplicate-entry protection (ACC-9) must
not be read as permission to accept partial or inconsistent financial
records. Three separate concerns are in play, with three separate answers:

1. **Transactional atomicity** (preventing an inconsistent half-recorded
   loan — one row written, the other missing). **Solved by design**, not by
   scope exclusion: wrapping both writes in one `dataSource.transaction` (the
   recommendation above) makes this structurally impossible regardless of
   how ACC-2a or ACC-9 resolve. This is not negotiable and is not an
   out-of-scope item.
2. **Duplicate-submission/idempotency** (the same user action resubmitted —
   double-click, retry after a timeout — creating two complete, otherwise-
   identical `Transfer`+`DirectLedgerEntry` pairs). **Not solved.** This is
   what ACC-2a's recommendation (fold into ACC-9's scope exclusion) actually
   covers — and only this.
3. **Never merging two legitimately distinct loans.** The combined action
   must **never** use a uniqueness constraint (e.g. on caller+counterparty+
   amount+date) to detect or prevent "duplicates," because two real ₹1,000
   loans to the same person on the same day are legitimate and must both be
   recorded. No existing pattern in this codebase (including the
   `contacts.service.ts` 23505-catch, which relies on a *true* identity key)
   should be copied here for this reason. This is an **invariant for any
   future implementation**, not a scope decision — it does not get resolved
   by ACC-2a either way.

Folding concern (2) into ACC-9's scope exclusion — if the product owner
confirms ACC-2a — says nothing about concerns (1) or (3). Concern (1) is
already structurally guaranteed by the transaction design; concern (3) must
be guaranteed by *not* building a naive uniqueness check, regardless of how
ACC-2a resolves.

### Verified vs. proposed — explicit distinction

- **Verified (exists in the codebase today):** the `dataSource.transaction` pattern, the optional-`manager` join pattern, the advisory-lock pattern, the 23505 defense-in-depth catch (all in `settlements.service.ts`/`contacts.service.ts`); and the *absence* of any transaction wrapper or idempotency-key mechanism in `person-ledger.service.ts` or anywhere else in the backend.
- **Proposed, not built:** the `Transfer` entity/table; extending `createDirectTransaction`/`createDirectSettlement` to accept an optional `manager`; any new orchestration service/endpoint implementing the "combined action" itself.

---

## Deliverable 11 — Updated Blocker Register

| ID | Decision/requirement | Status after this round | Depends on | Owner |
|---|---|---|---|---|
| ACC-7, ACC-1, ACC-8, ACC-3, ACC-9 | Build/Hybrid/Optional-linking/Manual-refund/Out-of-scope-dedup | **Approved (product owner)** — unchanged | — | Product |
| ACC-2 | Combined lending action | **Approved (product owner)** — design requirements now concretely answered (Deliverable 10), except ACC-2a below | ACC-1 | Product |
| **ACC-2a** (new, proposed label) | Single-action double-submission/duplicate-creation risk for the combined action | **Recommendation offered (treat as covered by ACC-9), not yet confirmed by product owner** | ACC-2, ACC-9 | Product |
| **ACC-2b** (new, proposed label) | Extend `createDirectTransaction`/`createDirectSettlement` to accept an optional `manager` | **Identified engineering requirement, not yet built or authorized** | ACC-2 | Engineering |
| ACC-4, ACC-5 | Encryption zone for `Account.displayName`/balance fields | **Product direction (Zone 2) selected; security review brief prepared (Deliverable 9); review itself not performed; reviewer/approval mechanism not formally designated** | FLD-5 precedent; no blocking dependency on ACC-6 | Product + Security (role undesignated) |
| ACC-6 | Deletion/anonymization extension to `Account`/`Transfer` | **UNCHANGED — blocked on counsel; counsel brief prepared (Deliverable 8) with a question list; no position inferred** | DEL-1, DEL-2, DEL-3, PF-001 (no existing deletion feature to extend) | Counsel |

---

## Deliverable 12 — What Remains Before Governance Formalization and Implementation Planning

1. **Counsel must answer the Deliverable 8 question list for ACC-6.** Until then, no migration can safely fix `Account`/`Transfer` FK nullability/cascade behavior, and no Decision Ledger entry or ADR for ACC-6 can be written.
2. **A security reviewer must be designated and must review Deliverable 9 for ACC-4/ACC-5.** No such role is currently documented in this repository; the only comparable precedent is the governance-owner sign-off used for `P2P-CNT-3`, and whether that applies here is itself undecided.
3. **The product owner must confirm ACC-2a** (that single-action double-submission risk is covered by ACC-9's existing scope exclusion) before Deliverable 10's recommendation can be treated as settled.
4. **ACC-2b (the optional-`manager` extension to `PersonLedgerService`) must be scoped into the eventual implementation plan** — it is a concrete, identified code change, not yet made and not authorized by this document.
5. Only after 1–4 are resolved should the Deliverable 6 governance sequence (Decision Ledger addendum → ADR → migration design doc → separate Account test/parity plan → feature-flag registration) begin. **None of that sequence has started.**

**No code, schema, migration, API, OpenAPI, ADR, or Decision Ledger change
has been made in this round.** All additions in this update are confined to
this preparatory document.

---

## Deliverable 13 — Decision-Ledger Entry Timing (re-evaluated; not acted on)

**Superseded analysis (2026-10-29, second pass):** the original version of
this section argued that `DEL-1`/`P2P-CNT-3`'s *mixed locked/open-gate
entry shape* precedented a partial Account/Transfer entry. That observation
is correct but incomplete — it looked only at entry *shape*, not at the
written change-control rule or at *when* in each precedent's lifecycle the
entry was actually written. Re-examined against both, below.

### The written rule

`FINMATE_DECISION_LEDGER.md` line 9: *"Do not silently change a LOCKED
decision. Any change requires a new dated entry and an ADR."* `ADR_INDEX.md`
lines 3–4 states the reciprocal constraint: ADRs are "all Accepted (each
reflects an already-frozen decision — no ADR invents a decision)" and
"every ADR traces to a frozen source." Read together, a new governed
decision and its ADR are meant to exist as a pair.

### How that pairing actually happened in this repository's history

| Entries | Source cited | New ADR? | What stage was the work at when written? |
|---|---|---|---|
| `P2P-CNT-1`, `P2P-CNT-2`, `P2P-CNT-4` (lines 549, 554, 564) | `ADR-025` | **Yes — a brand-new ADR**, created in the same governance-package commit (`a3c1ea2`, 2026-09-08) | **After** the underlying code (`9e93920`, `937b38b`, both 2026-09-07/08) was already implemented and tests were green. |
| `P2P-CNT-3` (line 559) | `ADR-025` | Same new ADR, plus an explicit, separately **dated** `[GOVERNANCE-OWNER APPROVAL REQUIRED]`/`APPROVED ... on 2026-09-10` marker for the one sub-part crossing a PII/API boundary | Boundary approved; the counsel sub-part (`P2P-CNT-3.A`) stayed open and **the entry says so explicitly** rather than omitting it. |
| `CLAIM-1`..`CLAIM-4`, `MERGE-1` (lines 584–604) | `impl df01c11` / `impl a973eae` — **no ADR cited at all** | No | **After** the fixes were already coded and merged; these are narrow, interim tightenings *within* the already-accepted `ADR-025`/Contact domain, not a new domain. |

**The pattern that actually holds, without exception, across every
precedent found:** a new Decision Ledger entry is written either (a) as
part of the original frozen baseline itself, or (b) **after** the
underlying engineering work it describes already exists — ratifying
completed or boundary-approved work, never pre-committing a not-yet-built
feature's direction. The one case resembling a wholly new domain
(`P2P-CNT-1/2`, comparable in scope to the proposed Account/Transfer domain)
is also the one case that paired a **new** ADR with the entry. The one case
that skipped a new ADR (`CLAIM-1..4`) did so only because it was a narrow
fix inside an already-ADR'd domain, not a new one.

### Why ACC-1..9 does not fit either path

`ACC-1` (the Hybrid Account/Transfer architecture) is a **new domain** —
there is no existing accepted ADR for it to tighten under, so it is not
analogous to `CLAIM-1..4`. It is analogous to `P2P-CNT-1/2` in scope — but
unlike every entry in the table above, **no code implementing any of
ACC-1..9 exists yet** (confirmed throughout Deliverables 1–12: "not yet
designed," "proposed, not authorized," "not built"). There is no precedent
anywhere in this repository for writing a Decision Ledger entry that
pre-authorizes a product direction for a feature that has not been built,
while the same feature still has an open counsel gate (`ACC-6`) and an open
security review (`ACC-4`/`ACC-5`).

### Conclusion

Writing the six approved `ACC-*` decisions into `FINMATE_DECISION_LEDGER.md`
now would require either (a) a new, paired ADR — which this task does not
authorize and no prior governance-owner approval to create one exists for —
or (b) treating Account/Transfer as a narrow tightening of an existing
domain, which it plainly is not. **Neither condition the repository's own
precedent establishes is satisfied. The rule and the precedent are not in
conflict with each other, but they are both unsatisfied by the current
state of this feature — so, per the governing instruction to not infer
permission from shape-level precedent alone, the Decision Ledger is left
unmodified.**

The next legitimate opportunity to revisit this is **after** `ACC-6`
clears counsel and the `ACC-4`/`ACC-5` security review completes — at that
point this would resemble the `P2P-CNT-1/2` pattern (new domain, gates
closed, pair a new ADR with the Decision Ledger entry in one governance
commit) rather than an unprecedented early commitment.

---

## Deliverable 14 — ACC-4/ACC-5 Security Review Package

**Status labels used below:** **[VERIFIED]** = confirmed by reading the
actual source this session · **[APPROVED]** = product-owner decision
already on record (Decision Status, top of document) · **[PROPOSED]** =
part of the unauthorized Account/Transfer design sketch (Deliverable 4),
not implemented · **[QUESTION]** = for the reviewer to answer ·
**[RECOMMENDATION]** = this document's suggestion, not a decision ·
**[BLOCKER]** = unresolved, blocking.

### A. Review objective

The reviewer must determine, for `Account.displayName` and
`Account.openingBalance`/computed-balance fields specifically (not for the
Account/Transfer feature as a whole):

1. Whether Zone 2 (plaintext-but-protected, server-readable) is the correct
   classification, or whether Zone 1a (E2EE) or a stricter Zone-2 variant
   (comparable to `FLD-5`'s "strict access control") is required.
2. Whether the **[APPROVED]** product direction (Zone 2) can be authorized
   as-is, authorized with additional conditions, or rejected.
3. Which, if any, additional controls (access tightening, logging
   exclusions, export/serialization restrictions) must be satisfied **before**
   schema or API work begins.

This review does **not** cover `ACC-6` (deletion/retention — Deliverable 15)
or the architectural choice of `Account`/`Transfer` itself (`ACC-1`,
already **[APPROVED]** and out of scope for a security reviewer to
re-open here).

### B. Data inventory

| Field / group | Classification | Status | Business purpose | Provenance | Expected readers/writers | Exposure paths | Evidence gap |
|---|---|---|---|---|---|---|---|
| `Account.displayName` | Zone 2 proposed | **[PROPOSED]** — no entity exists | User-chosen label (e.g. "HDFC Savings") | User-provided, free text | Owning user (read/write) + server (balance computation, list rendering) — per the **[PROPOSED]** design in Deliverable 4/9 | API response (proposed, no endpoint shape decided), logs (see C below), exports (none proposed yet) | No endpoint, DTO, or serialization design exists to review directly — the reviewer is evaluating a classification choice for a field that doesn't exist in code yet, using the `profile.monthlyIncome`/`group.name` precedents below as the only concrete analogues. |
| `Account.openingBalance` / computed balance | Zone 2 proposed | **[PROPOSED]** — no entity exists | Starting/running balance amount | User-provided (opening balance) or server-computed (running balance, per **[APPROVED]** `ACC-1` read-time-fold design) | Owning user (read) + server (compute) | Same as above — none built | Same as above. Additionally: whether the *computed* running balance needs a classification distinct from the *stored* `openingBalance` is itself one of the open questions (C.3 below) — not resolved by this inventory. |
| `profile.monthlyIncome` / `monthlyBudget` (precedent, not an ACC-4/5 subject itself) | Zone 2, `FLD-5` | **[VERIFIED]** — `shared/data-models/src/lib/profile.entity.ts` lines 33–37: plain nullable `decimal(12,2)` columns, no field-level encryption annotation | Budgeting/personalization | User-provided | `UsersService.findProfileByUserId`/`updateProfile` (`users.service.ts` lines 72–133); `decryptProfile` (lines 135–144) touches **only** `avatarUrl` — `monthlyIncome`/`monthlyBudget` pass through as plaintext, unmodified | `GET /users/me`/`PATCH /users/me` (`users.controller.ts` lines 55–83), both gated by class-level `@UseGuards(JwtAuthGuard)` (line 24) and hardcoded to `req.user.id` — **[VERIFIED]** no `:userId` route parameter exists for profile, so there is no cross-user profile lookup surface | None — this is current, shipped behavior, fully traceable. |
| `Settlement.amount` (precedent for financial amounts in audit logs) | Zone 2 | **[VERIFIED]** | Settlement amount | Server-computed/user-entered | `SettlementsService.recordPayment` | Written into `audit_logs.metadataJson` **in plaintext** today (`settlements.service.ts`, the `writeAuditLog` call after `recordPayment`'s transaction: `amount: Number(saved.amount), currency: saved.currency`) | None — confirms financial amounts already cross the audit-log boundary in plaintext; relevant precedent for whether `Account`/`Transfer` amounts would introduce a *new* exposure category by doing the same. |

### C. Existing controls

All **[VERIFIED]** unless marked otherwise.

- **Authentication/authorization:** `UsersController` is class-level `@UseGuards(JwtAuthGuard)` (`users.controller.ts` line 24); the `/me` routes never accept a target-user parameter — they always resolve to `req.user.id`. There is no analogous `AccountsController` to inspect (**[PROPOSED]**, not built) — the reviewer should treat "self-only access, no `:accountId`-without-ownership-check route" as a **[RECOMMENDATION]** to carry into the eventual API design, not a verified existing control for Account.
- **Database/API access:** `Profile` has no `@Exclude()`/class-transformer annotations and no DTO redaction layer — `GET /users/me` returns the raw `Profile` entity (minus whatever the global response pipe does), including `monthlyIncome`/`monthlyBudget` verbatim. There is **no field-level access tightening beyond the route guard** for this precedent field today, despite `FLD-5`'s stated intent ("strict access control") — the matrix's "strict access control" qualifier for `profile.monthlyIncome` does **not** appear to be enforced by any additional code-level mechanism beyond the same JWT+self-only pattern every other field uses. **[QUESTION for the reviewer: is `FLD-5`'s "strict access control" actually implemented anywhere beyond ordinary auth, or is it an aspirational classification not yet backed by code? If the latter, Account fields inheriting the same "strict access control" label would carry the same gap.]**
- **Serialization/response filtering:** none found for `Profile`; not applicable to Account (**[PROPOSED]**, no controller/DTO exists).
- **Logging/observability:** `ObservabilityService.record()` (`observability.service.ts`) passes metadata through `redactSensitiveKeys` (`log-redaction.util.ts` lines 49–64), which redacts by **key name** only: `email, password, pwd, token, refreshtoken, accesstoken, secret, otp, mfacode, apikey, key, jwt, authorization, ip`. **This list does not include any financial-amount or display-name-style key** (no `amount`, `balance`, `displayName`, `income`, etc.). No current code path was found passing `monthlyIncome` or any `Expense`/`Settlement` amount through `ObservabilityService.record()` — but **the mechanism provides no protection if a future Account/Transfer code path does**, since it is name-list-based, not value-heuristic-based. **[VERIFIED code gap — not hypothetical; a concrete finding, not a speculative attack path.]**
- **Audit-log metadata:** `redactSensitiveKeys` is also used for `audit_logs.metadataJson` per its own docstring (SEC-W7). As shown in the data inventory, `Settlement.amount`/`currency` are **already** written into audit metadata in plaintext — establishing that Zone 2 financial amounts are already an accepted category of audit-log content in this codebase.
- **Concurrency control:** `Expense`, `Settlement`, `ExpenseSplit`, `ExpensePayment`, `Goal`, `Group`, `RecurringExpense`, `PublicShare`, `CustomTag`, `Note`, `DirectLedgerEntry` all carry `@VersionColumn` (optimistic locking) — confirmed by `grep -l VersionColumn shared/data-models/src/lib/*.entity.ts`. **`Profile` does not** (confirmed: no match in `profile.entity.ts`) — concurrent `monthlyIncome`/`monthlyBudget` updates can silently overwrite each other with no conflict detection. The **[PROPOSED]** `Account` sketch in Deliverable 4 includes `version` (optimistic locking), so if built as sketched, `Account` would actually have *stronger* concurrency protection than its own nearest precedent field.
- **Retention/deletion:** see Deliverable 15 (ACC-6) — `UsersService.deleteAccount` anonymizes `User` identity fields but **does not touch** `profile.monthlyIncome`/`monthlyBudget`, which is directly relevant to how long these Zone 2 financial values persist after account deletion.

### D. Threat and risk assessment

| # | Scenario | Potential impact | Existing mitigation (verified) | Remaining uncertainty | Question/recommendation |
|---|---|---|---|---|---|
| 1 | Cross-user disclosure of another user's account name/balance via an Account API endpoint | Financial-privacy breach (reveals bank relationships + amounts) | **[VERIFIED]** the only existing precedent (`profile.monthlyIncome`) is self-only, no `:userId` param, class-level JWT guard | No Account endpoint exists to verify directly | **[RECOMMENDATION]** any future Account endpoint must follow the same self-only pattern, never a bare `:accountId` lookup without an explicit ownership check (`WHERE ownerUser = caller`) |
| 2 | `Account.displayName`/balance reaching an unredacted log line | Financial data in log aggregation/observability tooling outside the authorized app boundary | **[VERIFIED gap]** `redactSensitiveKeys`'s key-list does not cover financial/display-name fields; no current code logs `monthlyIncome` this way, but nothing would stop a future Account code path from doing so | Whether any future logging call sites will pass these fields as metadata is unknown (nothing built yet) | **[QUESTION]** should the redaction key-list be extended before Account ships (e.g., add `displayName`, `balance`, `openingbalance`), or is exclusion-by-convention (callers simply never pass these fields) sufficient? **[RECOMMENDATION]** prefer the key-list extension — it fails closed, matching this file's own stated design principle ("name-based... has no false negatives for real secret parameters"). |
| 3 | Unauthorized modification of `Account.openingBalance` | Corrupted balance computation feeding the Deliverable 4 read-time fold | No Account write-path exists; nearest precedent (`updateProfile`) uses plain field assignment with **no** optimistic lock on `Profile` | The **[PROPOSED]** `Account` sketch already includes `version` (stronger than its own precedent) | No action needed beyond confirming the `version` column is retained when/if implementation proceeds — not a reviewer decision, flagged for completeness. |
| 4 | Combined sensitivity: institution name + balance together reveal more than either alone | A more complete financial profile than `expense.amountTotal` or `profile.monthlyIncome` individually expose | None specific — `FLD-5`'s "strict access control" is the closest comparable qualifier, but (per C above) its enforcement beyond ordinary auth is itself unverified | Whether this combination needs something *stricter* than plain Zone 2 | **[QUESTION — the central ACC-4/5 question]:** does this combination warrant `FLD-5`'s "strict access control" treatment, something stricter still, or is ordinary Zone 2 (matching `group.name`/`group_member.nickname`, `FLD-3`/`FLD-4`) sufficient? |
| 5 | Inconsistency between a stored `Account.openingBalance` and the read-time-computed running balance | Users/support staff could be shown two different "truths" | **[APPROVED]** `ACC-1` already mandates the balance is always computed at read time, never cached — this is an architecture answer, not a security control, but it structurally prevents a stored/computed drift bug | None beyond implementation correctness | Not a reviewer question — flagged for completeness only. |

No additional risks beyond those directly supported by the **[PROPOSED]** design or **[VERIFIED]** precedent fields were identified; this document does not speculate about attack paths with no grounding in the actual design.

### E. Explicit reviewer questions

1. Is Zone 2 appropriate for `Account.displayName`?
2. Is Zone 2 appropriate for `Account.openingBalance` and related balance fields?
3. Does the **computed** running balance (read-time fold, per `ACC-1`) require different handling from the **stored** `openingBalance` source value?
4. Are the existing controls identified in §C (JWT self-only access, no DTO redaction, name-based log redaction, `@VersionColumn` concurrency) adequate for these two fields, or do they require tightening beyond what `profile.monthlyIncome`/`FLD-5` currently has?
5. Do any of these fields need access tightening, encryption, redaction, or another safeguard — and specifically, should the `redactSensitiveKeys` key-list (§C, §D.2) be extended before Account ships?
6. Which security requirements, if any, must be satisfied **before** any schema or API implementation begins (vs. which can be addressed during implementation)?
7. **Which role or person is authorized to approve these classifications under this repository's governance process?** Per Deliverable 9/11, no such role is currently documented anywhere in this repository (`FINMATE_SECURITY_PRIVACY_ARCHITECTURE.md`, `FINMATE_KEY_MANAGEMENT_ARCHITECTURE.md`, `FINMATE_DECISION_LEDGER.md` all searched, no hits); the only comparable precedent is the dated "governance owner (project owner)" sign-off used for `P2P-CNT-3`. **This question is itself unanswered — see Deliverable 16.**

Encryption, access-tightening, and any other control are treated above as **open questions for the reviewer**, not pre-approved implementation requirements.

### F. Decision record (blank — for the reviewer to complete)

| Field | Value |
|---|---|
| ACC-4 outcome | _pending_ |
| ACC-5 outcome | _pending_ |
| Required mitigations | _pending_ |
| Reviewer identity/role | _pending — no authorized role currently designated (see §E.7, Deliverable 16)_ |
| Evidence reviewed | _this Deliverable 14, plus Deliverables 1, 4, 9 of this document_ |
| Approval date | _pending_ |
| Outstanding conditions | _pending_ |

**No security reviewer is named or assumed here. No review has occurred. Zone 2 remains a product-selected direction only, not an approved classification.**

---

## Deliverable 15 — ACC-6 Counsel Review Package

**Status labels:** same convention as Deliverable 14.

### A. Current state and proposed scope

**Verified facts:**

- `Account`/`Transfer` entities **[VERIFIED do not exist]** anywhere in `shared/data-models/src/lib/` (Deliverable 1).
- `Account`/`Transfer` are **[PROPOSED]** as single-owner only (no group/shared accounts) — Deliverable 4/8. No code implements any part of this proposal.
- **Corrected finding (supersedes Deliverable 8's earlier claim):** account deletion **is** implemented and tested today — `UsersController.deleteMe` → `UsersService.deleteAccount` (`users.controller.ts` lines 89–92; `users.service.ts` lines 236–287; tests in `users.service.spec.ts` lines 340–398). It:
  - Runs inside one `dataSource.transaction`.
  - Anonymizes `User` identity/auth/key fields in place (email, username, phone, displayName, password hash, 2FA secret, encryption key material, `aiOptIn`, `status`) — **[VERIFIED]** the `User` row and its `id` are **never deleted**.
  - Nulls `Profile.avatarUrl` only — **[VERIFIED]** `profile.monthlyIncome`/`monthlyBudget` are **left untouched**, still attached to the (now-anonymized) `Profile` row.
  - Removes active Redis sessions (best-effort).
  - Its own docstring states the policy: preserve all financial history (expenses, splits, settlements, versions, audit logs) for ledger integrity.
- `DEL-1` (Decision Ledger lines 209–212) is the written policy this implementation follows: personal erase + anonymize-in-place for shared financial records, justified by "existing NOT-NULL user FKs... make row-DELETE impossible without corrupting other users' ledgers."
- **[VERIFIED, refines DEL-1's own stated mechanism]:** checking the actual entity decorators, the controlling mechanism is not literally "NOT NULL" in every case (e.g. `audit_logs.actorUser` is `nullable: true` per `audit-log.entity.ts` line 16–17) — the real mechanism is that **no `onDelete` action is specified** on the primary financial-party FKs (`Expense.ownerUser`, `Settlement.fromUser`/`toUser`, `DirectLedgerEntry.fromUser`/`toUser`/`fromContact`/`toContact`), which defaults to `RESTRICT` in Postgres/TypeORM regardless of nullability. In practice this is moot for the *shipped* `deleteAccount`, because it **never attempts a `User` row delete at all** — it only mutates fields on the existing row. `DEL-1`'s "row-DELETE impossible" framing describes a constraint that the actual implementation doesn't even need to rely on, since it was never designed to delete the row in the first place.
- By contrast, **history/version/actor tables use `onDelete: 'SET NULL'`** on their `User` "who did this" FK (e.g. `ExpenseVersion.user`, `SettlementVersion.user`, `GroupKeyVersion.user` — all `nullable: true, onDelete: 'SET NULL'`), a different, softer pattern than the RESTRICT-by-default used for primary financial-party FKs.
- `RET-1` (Decision Ledger line 315–318): an **already-open, already-flagged** retention-period question — "~30 days as a working figure," explicitly **not** hard-coded pending infrastructure mapping, status `OPEN VALUE (LOCKED as parametric) · Engineering + Counsel`. This is the existing retention question Account/Transfer would inherit, not a new one.
- `DEL-2` (backup-restore tombstone replay, lines 214–217) and `DEL-3` (departed-user content in retained shared free-text, lines 219–222) remain as previously reported, unresolved for `DEL-3` specifically.

**What is only proposed, not built:** every `Account`/`Transfer` schema detail in Deliverable 4; any deletion/anonymization behavior specific to `Account`/`Transfer` (there is none — the existing `deleteAccount` only touches `User`/`Profile`, and would not need modification merely because `Account`/`Transfer` exist, **unless** counsel determines different treatment is required).

**Why counsel's decision is required before finalizing the data-lifecycle design:** the existing `deleteAccount` precedent (anonymize-in-place, never delete, preserve all financial history under the same `User.id`) is a *candidate* pattern for `Account`/`Transfer` to simply inherit automatically — since `Account.ownerUser`/`Transfer.createdByUser` would point at the same, unmodified `User.id`, nothing in the existing deletion code would even need to change. **Whether that automatic inheritance is legally sufficient, or whether `Account`/`Transfer`'s single-owner (not shared) nature changes the answer, is exactly what counsel must determine** — this document does not assume either answer.

### B. Legal and policy questions

1. What deletion or anonymization obligations apply to `Account`/`Transfer` records specifically, given the already-shipped precedent (above) anonymizes the owning `User`'s identity fields but leaves ALL financial rows — including, by extension, any future `Account`/`Transfer` rows tied to the same `User.id` — completely untouched, including `profile.monthlyIncome`/`monthlyBudget`-style amounts? Does this precedent extend automatically, or does `Account`/`Transfer` require distinct treatment?
2. Must `Account`/`Transfer` records be retained for a defined period? `RET-1` already flags an unresolved, parametric retention window (~30 days working figure) for the broader system — does this feature introduce any retention requirement different from that existing open question, or does it simply inherit `RET-1` unchanged?
3. May some `Account`/`Transfer` records need to remain after a user requests deletion, the way `Expense`/`Settlement`/`DirectLedgerEntry` rows already do today (by design, confirmed above)?
4. Must `Account.displayName`/balance identifiers be deleted, pseudonymized, or retained for legitimate recordkeeping — and does this differ from how `profile.monthlyIncome` is currently retained unmodified after deletion (verified above)?
5. How should account deletion interact with `Account`/`Transfer` given their proposed **single-owner** nature (no sharing with other users) — is this materially different from `Expense`(group-shared)/`DirectLedgerEntry` (shared with a Contact/other User), which is the basis `DEL-1` was originally written to address?
6. Must any `Account`/`Transfer` data remain linked to preserve financial auditability or legal obligations, consistent with how `Expense`/`Settlement`/`audit_logs` are preserved today?
7. Is anonymize-in-place (the existing, shipped pattern) legally appropriate for `Account`/`Transfer`, or does their single-owner nature permit — or require — true deletion instead?
8. Do retention periods or deletion behavior differ by record type (e.g. `Account` vs. `Transfer`) or by jurisdiction? **This document does not know which jurisdictions FinMate currently operates in or targets — if that is not already documented elsewhere, counsel's first task may be identifying what jurisdictional scope applies at all.**
9. Do any user disclosures, consent language, or privacy-policy changes need to accompany an `Account`/`Transfer` feature, beyond what already covers `Expense`/`DirectLedgerEntry`/`Settlement` data today?
10. Is additional legal, compliance, or privacy review needed beyond this brief — e.g., does this interact with `DEL-3`'s still-open "departed-user content in retained shared free-text" question, given `Account.displayName` is user-authored free text?

**These are questions. No legal conclusion is assumed or implied by their wording.**

### C. Technical decision dependencies

| Engineering decision | Depends on counsel's answer to | Current precedent (verified) |
|---|---|---|
| `Account.ownerUser`/`Transfer.createdByUser` FK `onDelete` behavior | B.1, B.5, B.7 | Primary financial-party FKs (`Expense.ownerUser`, `Settlement.fromUser`/`toUser`) have **no** `onDelete` specified → default `RESTRICT`; but the *shipped* `deleteAccount` never triggers this path because it never deletes the `User` row |
| Whether `Account`/`Transfer` need their own soft-delete (`@DeleteDateColumn`) | B.3, B.6 | `Expense`, `ExpensePayment`, `ExpenseSplit`, `DirectLedgerEntry` have it; `Settlement`, `Profile`, `User`, `Contact`, `Group` do **not** — soft-delete is not universal in this codebase, so this is a real open choice, not a default |
| Retention/purge job design | B.2 | `RET-1` — already open, parametric, pending infra mapping; no purge job exists for any entity today |
| Whether `Account.displayName` needs redaction/tombstoning akin to `DEL-3`'s open question | B.4, B.10 | `DEL-3` is unresolved for *existing* shared free-text (e.g. legacy P2P notes); no precedent yet for a *single-owner* free-text field like `Account.displayName` |
| Whether `Account`/`Transfer` can simply inherit `deleteAccount`'s existing behavior unmodified | B.1, B.5 | Technically yes with zero code change, **if** counsel confirms the single-owner case needs no different treatment than the shared-record case `DEL-1` was written for |

**This document does not recommend a definitive database implementation.** The "no code change needed" possibility above is presented as a technical fact (it would require no engineering work to inherit the existing pattern), not as a legal conclusion that doing so is sufficient.

### D. Counsel response form (blank — for counsel to complete)

| Question/issue | Counsel's determination | Jurisdiction/policy | Required retention/deletion behavior | Conditions/exceptions | Required disclosures/policy changes | Follow-up actions | Counsel/reviewer & date |
|---|---|---|---|---|---|---|---|
| B.1 | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| B.2 (ties to `RET-1`) | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| B.3 | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| B.4 | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| B.5 | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| B.6 | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| B.7 | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| B.8 | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| B.9 | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| B.10 (ties to `DEL-3`) | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |

**No legal determination is made or assumed here. `ACC-6` remains blocked.**

---

## Deliverable 16 — Review Process Findings and Readiness Checklist

### Documented reviewer roles and approval process (repository search)

- **No security-reviewer role or formal security-review process document** was found. Searched: `FINMATE_SECURITY_PRIVACY_ARCHITECTURE.md`, `FINMATE_KEY_MANAGEMENT_ARCHITECTURE.md`, `FINMATE_DECISION_LEDGER.md` — no defined role or procedure for approving a data-classification/encryption-zone decision specifically.
- **No designated legal/counsel contact** was found anywhere in the repository.
- **One tangential mention of a "Security Lead" exists:** `docs/PRODUCTION_READINESS_CHECKLIST.md` line 70, a blank sign-off line (`Security Lead: ____`) in a general production-release checklist (alongside "Engineering Lead," "QA Lead," "Release Manager"). **[VERIFIED, but not applicable]** — this checklist concerns build/test/deploy release gates generally, not encryption-zone or data-classification decisions, and no process exists for who holds that title or how they are appointed.
- **The only comparable documented approval mechanism** in this repository is the dated "governance owner (project owner)" sign-off used for `P2P-CNT-3` (`FINMATE_DECISION_LEDGER.md` line 570: *"APPROVED by the FinMate governance owner (project owner) on 2026-09-10... This authorizes the engineering/security boundary... — it is not a legal determination."*). Whether this same mechanism is intended to cover ACC-4/ACC-5's "Product + Security" approval type, or ACC-6's counsel determination, is **not established anywhere** in the repository.

**[RECOMMENDATION — narrowest possible governance clarification]:** before ACC-4/ACC-5/ACC-6 can be formally closed, the repository (or its maintainers) needs a one-line answer to a single question: *is the "governance owner (project owner)" the same person/role authorized to (a) perform or commission the ACC-4/ACC-5 security review, and (b) serve as or route to counsel for ACC-6 — or are these genuinely separate, undesignated roles?* This document does not answer that question or assume an answer.

**No reviewer is appointed, and no external review is represented as requested or completed, by this document.**

### Review-readiness checklist

| Item | Status |
|---|---|
| ACC-4/ACC-5 security brief prepared | **Done** — Deliverable 14, evidence-based, verified against actual source this session |
| Authorized security reviewer identified | **Pending** — no role documented in this repository (see above) |
| ACC-4 determination | **Pending** |
| ACC-5 determination | **Pending** |
| ACC-6 counsel brief prepared | **Done** — Deliverable 15, evidence-based, includes a correction to Deliverable 8's stale "deletion unimplemented" claim |
| Counsel contact identified | **Pending** — none documented in this repository |
| Counsel response received | **Pending** |
| ACC-6 determination | **Pending** |
| ACC-2a (duplicate-resubmission scope) product-owner confirmation | **Outstanding** — recommendation offered in Deliverable 10, not yet confirmed |
| ACC-2b (optional-`manager` extension) engineering design review | **Outstanding** — identified as a design recommendation in Deliverable 10, not implemented or reviewed |
| Decision Ledger entry for the six approved decisions | **Not made** — Deliverable 13 found no precedent for making it before implementation exists; left for a future, separate governance step |
| Implementation readiness | **Blocked** — pending ACC-4, ACC-5, ACC-6, ACC-2a, and ACC-2b, per Deliverable 12 |

Each "Done" row above reflects that the corresponding brief's content was prepared and checked against actual repository evidence in this session — not that the underlying review has occurred. No row in this checklist is marked complete merely because a heading exists.
