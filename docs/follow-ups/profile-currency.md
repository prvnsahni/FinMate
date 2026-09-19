# Profile Currency Follow-Up

Owner: Product + Backend + Frontend
Status: Follow-up required

## Purpose

A user profile stores a default currency:
- Set during signup.
- Editable later from profile/settings.
- Cached client-side so currency detail is not refetched on every request.

This is a UX/defaulting concern, not a ledger semantics change.

## Hard Rule: Default Only, Never a Ledger Filter/Converter

Profile currency is a DEFAULT for new expense/settlement inputs only.

It must never:
- Filter what debts/balances are shown.
- Convert historical amounts.
- Hide obligations created in another currency.

Invariant example:
- If a member owes in USD, they must continue seeing that USD debt regardless of profile default changes.

## Interaction With Group Base-Currency Guard (Authoritative)

Group-level currency guard remains the source of truth for what rows may be written in a group ledger.

Current authoritative checks:
- Expense create: `EXP_CURRENCY_MISMATCH` when input currency differs from group base currency.
  - `backend/src/app/expenses/expenses.service.ts:1258`
  - `backend/src/app/expenses/expenses.service.ts:1262`
- Recurring expense create: same mismatch guard.
  - `backend/src/app/expenses/services/recurring-expenses.service.ts:343`
  - `backend/src/app/expenses/services/recurring-expenses.service.ts:347`
- Settlement propose/record-payment: `SETTLE_CURRENCY_MISMATCH` when currency differs from group base currency.
  - `backend/src/app/settlements/settlements.service.ts:867`
  - `backend/src/app/settlements/settlements.service.ts:871`
  - `backend/src/app/settlements/settlements.service.ts:975`
  - `backend/src/app/settlements/settlements.service.ts:979`

Implication:
- Profile default can prefill forms, but it does not override group base-currency constraints.

## Interaction With CURRENCY_MINOR_UNITS and CURRENCY_UNSUPPORTED

Profile currency must be a supported code present in `CURRENCY_MINOR_UNITS`.

Current source of support map:
- `shared/data-models/src/lib/currency-minor-units.ts:10`
- Support predicate: `shared/data-models/src/lib/currency-minor-units.ts:19`

Validation contract requirement:
- Selecting an unsupported profile currency must be rejected using the same `CURRENCY_UNSUPPORTED` contract already used for ledger writes.

Existing write-side evidence:
- Expense create unsupported guard: `backend/src/app/expenses/expenses.service.ts:1175`
- Recurring create unsupported guard: `backend/src/app/expenses/services/recurring-expenses.service.ts:290`
- Settlement propose unsupported guard: `backend/src/app/settlements/settlements.service.ts:809`
- Settlement record-payment unsupported guard: `backend/src/app/settlements/settlements.service.ts:951`

## Open Questions (Not Resolved by Current Code)

- Should groups ever support mixed-currency rows in a single group ledger, or should single base-currency remain strict?
- When a user default currency differs from a group base currency, what should happen on join and first-create UX:
  - silent form prefill override to group currency,
  - blocking prompt,
  - or explicit one-time chooser?
