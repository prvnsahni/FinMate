# Financial Golden-Fixture Parity Gate

**Requirements:** FIN-002, FIN-013, FIN-014 · **ADR-001, ADR-017** · Implementation Roadmap / Pre-Implementation Execution Plan (BATCH-05).

## Why this exists

FinMate is a live money app. **Before any change that can affect money, we must
prove the new implementation produces the _exact same_ financial result as the
current one for the same inputs.** This suite is that proof and the reusable
regression gate.

> **The rule:** `same input = same financial result`.

## What it covers

It exercises the **real production calculation code** (never a reinvented
calculator) against **independently hand-computed** golden expectations:

| Area                                                                      | Real code under test                                                                                 | File                          |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------- |
| Splits (equal / fixed / percent / share, multi-payer remainder, rounding) | `calculateDeterministicSplits` (`@finmate/utils` via `../split-calculator.util`)                     | `split-parity.spec.ts`        |
| Refunds (partial / full / composed; `signedAmount` negation)              | `calculateDeterministicSplits` + documented sign rule                                                | `refund-parity.spec.ts`       |
| Settlements, People/P2P netting, multi-currency (no FX)                   | `simplifyLedgerDebts` (`@finmate/data-models` via `../../common/ledger-debt-simplifier`)             | `settlement-parity.spec.ts`   |
| Household month-lock (FIN-013)                                            | `ExpenseEditPolicyService` (injected clock)                                                          | `month-lock-parity.spec.ts`   |
| Spectator exclusion (FIN-014)                                             | participant-driven `calculateDeterministicSplits` invariant (service enforces `EXP_SPECTATOR_SPLIT`) | `spectator-invariant.spec.ts` |

Fixtures live in `golden-fixtures.ts`.

## Money comparison

Money is compared in **integer minor units (cents)** via `toCents(x) =
Math.round((x + Number.EPSILON) * 100)` — the app's own rounding. **No
`toBeCloseTo`, no tolerance, no new rounding policy.** Split remainders are
allocated to the **payer first, then lexicographically** by participant key
(this is production behaviour and is asserted explicitly).

## How to run it

```bash
# just the parity gate
npx nx test backend --testPathPattern=finance-golden

# full backend suite (includes the gate)
npx nx test backend
```

## What counts as a failure

- Any split / settlement / refund amount differs from the golden cents.
- The month-lock boundary opens/closes on the wrong day.
- A spectator (extra participant) leaks into the calculation.
- Splits do not reconcile exactly to the total.

If the gate fails after a change, **the change altered financial behaviour** —
stop and confirm the change is intended and the golden fixtures are updated with
a documented reason (never "adjust the expected number until green").

## Adding a fixture

1. Add a row to the relevant array in `golden-fixtures.ts` with a human-readable
   `description` and **hand-computed** `expectedCents` (derive it from the
   algorithm, do **not** paste the function's output).
2. The parity spec picks it up automatically.
3. Run the gate; a genuinely correct fixture passes first time.

## Golden rule for future finance-touching batches

**Any change to expenses, payments, splits, refunds, household/carry-forward,
settlements, or People/P2P MUST run this gate before merge, and MUST NOT
silently change financial semantics.** A CURRENT→TARGET refactor keeps the
golden expectations fixed and proves the new path reproduces them exactly.
