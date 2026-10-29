# FinMate - Account / Balance Ledger (FUTURE)

**Status:** FUTURE architecture proposal only. **Not an ADR** — per `ADR_INDEX.md`
("all Accepted — no ADR invents a decision"), no ADR is written until a decision
is actually made. This document exists to present options for that decision.
**Nature:** Documentation only. This file authorizes no code, schema, migration,
API contract, encryption change, feature flag, package, deployment, or production
change. It does not modify the frozen SRS, Decision Ledger, ADRs, OpenAPI, data
classification matrix, key management model, AI firewall, Goal Engine, or
Document Intelligence workstream.

**Origin:** this proposal responds to the "FinMate — Financial Intelligence and
Expense Automation" brainstorming brief (external product doc, not yet frozen),
specifically §2.7, §6, §10.1–10.2, which ask FinMate to track cash/bank/credit-card
balances, transfers, and credit-card purchase-vs-payment as distinct events.

## 1. Why a decision is required (not an extension of existing work)

FinMate's current financial model is **expense-split-centric**: an `Expense` is
created, split across `ExpenseSplit` rows, and settled via `Settlement` /
`DirectLedgerEntry`. There is **no account/balance concept anywhere in the schema**
— confirmed by inspection, zero entities named `Account`, `BankAccount`,
`CashAccount`, or `CreditCard` exist in `shared/data-models/src/lib/`, and no
module computes a running balance.

The brief's cash/bank/credit-card requirements are not addable as a field on
`Expense`. They require answering: does money *move between accounts* (a
`Transfer`, not an `Expense`), and does a credit-card *purchase* increase a
liability while the later *payment* decreases it without creating a second
expense? Answering this wrong corrupts spend totals (double-counting) — which is
exactly the failure mode `AGENT_RULES.md`'s Architecture Governance section exists
to prevent being decided silently.

## 2. Repository Reconciliation

| Area | CURRENT verified reality | Account/Balance implication |
|---|---|---|
| Expense model | `Expense` + `ExpenseSplit` + `ExpensePayment`; `amountTotal`/`category`/`expenseDate` plaintext Zone 2 (server-readable for calc); `title`/`description` E2EE Zone 1a. No `accountId`, no balance field anywhere. | A new Account concept cannot reuse `Expense` as its ledger — it needs its own entity or must attach to `Expense` without redefining what `Expense` means. |
| P2P / lending | `DirectLedgerEntry` (`User` XOR `Contact` per side, ADR-025) already represents money-owed-between-people, immutable, read-time claim/merge resolution. | Lending/borrowing (brief §7) is **already solved** at the person level. An Account model must not duplicate this — a cash loan to a Contact should debit a `CashAccount` AND create/rely on the existing `DirectLedgerEntry`, not reinvent P2P. |
| Settlements | `SettlementsService.calculateGroupBalances` is the **sole** authoritative balance calculator (FIN-002/ADR-017); `simplifyLedgerDebts` operates on opaque keys. | Any new balance math (account running balances) is a **separate** calculator from FIN-002's group-settlement math. They must not be merged into one function — different domains (who-owes-whom vs. how-much-is-in-this-account). |
| Document Intelligence | `document-intelligence/engine` already has an extraction engine, `rule-based-classification-engine.ts`, adapters, and a `reconciliation.ts` stub (receipt-scoped today). | This is the nearest reusable scaffold for the brief's §3–§5/§9/§11 message-capture pipeline — a separate concern from the Account model itself, but likely the eventual **producer** of account-affecting events. |
| Encryption zones | Zone 1 (client E2EE: titles/notes) vs Zone 2 (plaintext-but-protected, server-readable for calculation: amounts/categories/dates) per `FINMATE_DATA_CLASSIFICATION_ENCRYPTION_MATRIX.md`. | An `Account.balance`/`Account.name` ("HDFC Savings", "Wallet") needs an explicit zone assignment — likely Zone 2 (server must compute running balances) with the account *label* possibly Zone 1 if treated as sensitive free text. Not decided here. |
| GOV-1 (additive baseline) | `ADR-001`: existing functionality must not be broken; new domains are additive. | An Account model must be **additive** — existing `Expense`/`Settlement`/`DirectLedgerEntry` behavior stays byte-for-byte unchanged; `expenseDate`/`amountTotal` etc. are not repurposed. |
| Deletion (DEL-1) | Financial rows are anonymize-in-place, never row-DELETEd (`ADR-019`). | A new `Account`/`Transfer` entity inherits the same constraint — no hard deletes of balance-affecting history. |
| Feature flags | Flag registry exists (e.g. `document.intelligence`); no `accounts.*` flag exists. | A new Account surface should ship behind a default-OFF flag, consistent with how Document Intelligence was gated. |
| OpenAPI | No `accounts`/`transfers` path exists in `openapi.yaml`. | Any endpoints below are conceptual/TARGET examples only. |

## 3. Options

### Option A — New parallel Account/Transfer ledger (separate domain)

Add `Account` (type: `cash` \| `bank` \| `credit_card`), `Transfer` (moves money
between two `Account`s, never an `Expense`), and a `sourceAccountId` reference on
`Expense`/credit-card purchases so a purchase can both (a) remain an `Expense` for
spend reporting and (b) increase the linked credit-card `Account`'s liability.
Settling the card bill is a `Transfer` (bank → credit-card liability), not a
second `Expense`.

- **Pros:** Correctly represents transfers, cash withdrawals, and credit-card
  purchase-vs-payment as the brief's §10 requires, without touching `Expense`
  semantics (GOV-1 additive). Enables cash reconciliation (§6) and balance
  reporting as genuinely new, isolated features. Mirrors how `DirectLedgerEntry`
  was added alongside `Expense` rather than overloading it (precedent exists).
- **Cons:** Largest option. New entities, new migration, new calculator (balance
  engine, separate from FIN-002), new reconciliation UX, new encryption-zone
  decision, new deletion/DEL-1 extension, likely a new ADR + Decision Ledger
  entries (same governance weight as ADR-025/P2P-1..4). Multi-month scope if done
  to the brief's full ambition (§6.3 discrepancy flow, §6.4 reconciliation
  cadence).

### Option B — Minimal tag on Expense (no separate balance ledger)

Add an `accountId` (free-form, user-named "wallet") and a `transactionType` enum
(`expense`/`transfer`/`credit_card_payment`/…) directly on `Expense`; compute
"balance" as a derived sum over tagged expenses rather than a stored running
balance.

- **Pros:** Much smaller diff; no new entity; fast to ship a basic "spending by
  account" view.
- **Cons:** Does not actually solve the brief's core requirement — a `transfer`
  tagged this way still has to be excluded from spend totals everywhere `Expense`
  is summed today (dashboard, exports, goals), which risks silently changing
  existing `Expense` semantics (violates GOV-1's "existing functionality
  untouched" guarantee) for the sake of a half-measure. Doesn't support §6.3
  (counted-cash vs recorded-cash reconciliation) because there's no stored
  balance to reconcile against. Likely cheaper now, more expensive later when it
  has to be redone as Option A anyway.

### Option C — Defer; do not build an Account model now

Treat brief §2.7/§6/§10 as out of scope. Keep FinMate as expense-split + P2P
ledger (`DirectLedgerEntry`) + goals + documents. Revisit only if/when message
capture (§3–§5) is independently prioritized, since that is the feature that
would actually produce the account-affecting events.

- **Pros:** Zero engineering cost now. Avoids a large governance package
  (ADR + Decision Ledger + FIN-002-style parity gate for a second calculator)
  for a feature with no inbound data source yet (no SMS/statement ingestion
  exists to populate it).
- **Cons:** Blocks the brief's §6/§10 entirely. If message capture is built
  later without an Account model underneath it, every parsed "bank debited
  ₹X" message has nowhere correct to land except as another `Expense` — which
  is the exact double-counting failure the brief's §10.2 warns against.

## 4. Recommendation

**Option A**, but scoped down from the brief's full ambition for a first slice:
ship `Account` + `Transfer` + the `sourceAccountId` link on `Expense`, with
**manual entry only** (no message capture yet) and **no cash-discrepancy
reconciliation flow** (§6.3/§6.4) in the first slice — that UX question is
explicitly unresolved in the brief itself (§15 Question A) and shouldn't be
designed alongside the schema decision. This keeps the first slice to "can a
user record a withdrawal/transfer/credit-card-payment correctly," which is the
accounting-correctness floor everything else in the brief depends on, without
committing to reconciliation UX or message ingestion in the same decision.

Option B is not recommended — it risks exactly the kind of silent semantic
change to `Expense` that `AGENT_RULES.md` and GOV-1 exist to prevent, in
exchange for a feature that doesn't fully work.

Option C is a legitimate choice if the product owner doesn't yet want the
governance cost (this would be a P2P-1-sized or larger batch, per the P2P
precedent) — but it means the brief's §6/§10 stay permanently out of scope
until revisited.

## 5. Suggested data model (SUGGESTION ONLY — not authorized)

```
Account
  id, ownerUser, type (cash | bank | credit_card), displayName,
  openingBalance, currency, isArchived, version (optimistic lock, per existing pattern)

Transfer
  id, fromAccount, toAccount, amount, currency, occurredAt,
  transferType (withdrawal | deposit | manual_transfer | credit_card_payment),
  createdByUser, version

Expense (additive — existing columns untouched)
  + sourceAccountId (nullable FK -> Account)   // which account funded this expense
  + liabilityAccountId (nullable FK -> Account) // credit-card purchases only
```

A credit-card purchase: `Expense` created as today (`amountTotal`, split, etc.)
with `liabilityAccountId` pointing at the card `Account`; the card `Account`'s
balance is `sum(liability Expenses) - sum(Transfers of type credit_card_payment
into it)`. No change to how `Expense` is summed for existing spend reports —
reports keep summing `Expense` exactly as now; `Account` balance is a *second*,
independent read, never fed back into `SettlementsService`/FIN-002.

## 6. Open questions (per-topic classification, house convention)

| Topic | Classification |
|---|---|
| Build Option A now vs. defer (Option C) | **[PRODUCT DECISION REQUIRED]** |
| Encryption zone for `Account.displayName`/`openingBalance` | **[PRODUCT DECISION REQUIRED]**, informed by `FINMATE_DATA_CLASSIFICATION_ENCRYPTION_MATRIX.md` |
| Cash discrepancy reconciliation cadence/flow (brief §6.4 Q-A) | **[PRODUCT DECISION REQUIRED]** — explicitly unresolved in the source brief too |
| Whether a lending `Transfer` must also create a `DirectLedgerEntry` automatically, or require the user to do both | **[PRODUCT DECISION REQUIRED]** |
| Deletion/DEL-1 extension to `Account`/`Transfer` | **[COUNSEL REQUIRED]** (same gate pattern as DEL-1/P2P-CNT-4) |
| Feature flag name/default | **[ENGINEERING PARAMETER]** |
| Second balance calculator's test/parity gate (equivalent of FIN-002 for Accounts) | **[ENGINEERING PARAMETER]**, but required before any Account math ships |

## 7. Final Reconciliation

- **CURRENT:** no account/balance concept exists in FinMate; `Expense` +
  `DirectLedgerEntry` + `Settlement` fully cover expense-splitting and P2P
  lending/borrowing already, more thoroughly than the source brief assumed.
- **TARGET (if approved):** Option A's `Account`/`Transfer` model, additive to
  `Expense`, with its own isolated balance calculator — never merged into
  FIN-002.
- **Not changed:** code, schemas, migrations, OpenAPI, frozen SRS, Decision
  Ledger, ADRs, E2EE/security model, FIN-002, `DirectLedgerEntry`/P2P semantics,
  production.

**One-line status:** Future architecture proposal only; no implementation
authorized. Awaiting product-owner decision between Option A (scoped), B
(not recommended), or C (defer).
