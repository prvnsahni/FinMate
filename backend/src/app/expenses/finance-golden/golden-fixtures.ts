/**
 * FINANCIAL GOLDEN FIXTURES (FIN-002 / FIN-013 / FIN-014 / ADR-017)
 *
 * Deterministic, synthetic fixtures that pin the EXACT financial output of the
 * REAL production calculation code:
 *   - split math        → `calculateDeterministicSplits` (@finmate/utils, used by
 *                          ExpensesService via ./split-calculator.util)
 *   - settlement / P2P  → `simplifyLedgerDebts` (@finmate/data-models)
 *   - month-lock        → `ExpenseEditPolicyService`
 *
 * These fixtures are an INDEPENDENT ORACLE: every expected value below was
 * computed by hand from the documented algorithm, NOT by running the function.
 * So the parity specs fail if the implementation's result ever diverges — the
 * whole point of the gate ("same input = same financial result").
 *
 * Money is compared in INTEGER MINOR UNITS (cents) via `toCents`, mirroring the
 * app's own `Math.round((amount + Number.EPSILON) * 100)`. No floating tolerance
 * is used and no new rounding policy is introduced.
 *
 * NOTHING here is production behaviour, a second calculator, or real user data.
 */

export type SplitType = 'equal' | 'fixed' | 'percent' | 'share';

/** App-faithful conversion to integer minor units (cents). */
export const toCents = (amount: number): number =>
  Math.round((amount + Number.EPSILON) * 100);

export interface SplitLine {
  participantUserId: string;
  splitType: SplitType;
  shareValue: number;
}

export interface SplitFixture {
  id: string;
  description: string;
  currency: string;
  amountTotal: number;
  splits: SplitLine[];
  /** Payer's participant key — drives deterministic remainder allocation. */
  payerKey?: string;
  /** Expected owed amount per participant, in CENTS. */
  expectedCents: Record<string, number>;
}

export interface InvalidSplitFixture {
  id: string;
  description: string;
  amountTotal: number;
  splits: SplitLine[];
  payerKey?: string;
  /** Substring expected in the thrown validation message (documentary). */
  reason: string;
}

const line = (
  participantUserId: string,
  splitType: SplitType,
  shareValue: number,
): SplitLine => ({ participantUserId, splitType, shareValue });

/**
 * VALID split fixtures. Expected cents are hand-derived from the algorithm:
 * base = floor(totalCents * weight / totalWeight); the leftover cents are then
 * handed out one-at-a-time to the PAYER first, then lexicographically by key.
 */
export const SPLIT_FIXTURES: SplitFixture[] = [
  {
    id: 'SPLIT-EQUAL-2',
    description: 'Equal split of 100.00 between two people → 50.00 / 50.00',
    currency: 'USD',
    amountTotal: 100,
    splits: [line('user-a', 'equal', 1), line('user-b', 'equal', 1)],
    payerKey: 'user-a',
    expectedCents: { 'user-a': 5000, 'user-b': 5000 },
  },
  {
    id: 'SPLIT-EQUAL-3-PAYER-A',
    description:
      'Equal split of 100.00 three ways; the leftover cent goes to the PAYER (A)',
    currency: 'USD',
    amountTotal: 100,
    splits: [
      line('user-a', 'equal', 1),
      line('user-b', 'equal', 1),
      line('user-c', 'equal', 1),
    ],
    payerKey: 'user-a',
    expectedCents: { 'user-a': 3334, 'user-b': 3333, 'user-c': 3333 },
  },
  {
    id: 'SPLIT-EQUAL-3-PAYER-C',
    description:
      'Same inputs but PAYER is C → the leftover cent moves to C (payer priority)',
    currency: 'USD',
    amountTotal: 100,
    splits: [
      line('user-a', 'equal', 1),
      line('user-b', 'equal', 1),
      line('user-c', 'equal', 1),
    ],
    payerKey: 'user-c',
    expectedCents: { 'user-a': 3333, 'user-b': 3333, 'user-c': 3334 },
  },
  {
    id: 'SPLIT-PERCENT-2',
    description: 'Percent split of 200.00 → A 25% = 50.00, B 75% = 150.00',
    currency: 'USD',
    amountTotal: 200,
    splits: [line('user-a', 'percent', 25), line('user-b', 'percent', 75)],
    payerKey: 'user-a',
    expectedCents: { 'user-a': 5000, 'user-b': 15000 },
  },
  {
    id: 'SPLIT-FIXED-2',
    description: 'Fixed split of 100.00 → A 30.00, B 70.00',
    currency: 'USD',
    amountTotal: 100,
    splits: [line('user-a', 'fixed', 30), line('user-b', 'fixed', 70)],
    payerKey: 'user-a',
    expectedCents: { 'user-a': 3000, 'user-b': 7000 },
  },
  {
    id: 'SPLIT-SHARE-1-3',
    description: 'Share split of 100.00 with weights 1:3 → 25.00 / 75.00',
    currency: 'USD',
    amountTotal: 100,
    splits: [line('user-a', 'share', 1), line('user-b', 'share', 3)],
    payerKey: 'user-a',
    expectedCents: { 'user-a': 2500, 'user-b': 7500 },
  },
  {
    id: 'SPLIT-FRACTIONAL-1-CENT',
    description:
      'Rounding edge: 0.01 split equally → payer A gets the single cent, B gets 0',
    currency: 'USD',
    amountTotal: 0.01,
    splits: [line('user-a', 'equal', 1), line('user-b', 'equal', 1)],
    payerKey: 'user-a',
    expectedCents: { 'user-a': 1, 'user-b': 0 },
  },
  {
    id: 'SPLIT-PERCENT-3-REMAINDER',
    description:
      'Percent 33.33/33.33/33.34 of 100.00 → 33.33 / 33.33 / 33.34 (sums to total)',
    currency: 'USD',
    amountTotal: 100,
    splits: [
      line('user-a', 'percent', 33.33),
      line('user-b', 'percent', 33.33),
      line('user-c', 'percent', 33.34),
    ],
    payerKey: 'user-a',
    expectedCents: { 'user-a': 3333, 'user-b': 3333, 'user-c': 3334 },
  },
];

/** INVALID inputs the calculator must REJECT (unsupported / guarded behaviour). */
export const INVALID_SPLIT_FIXTURES: InvalidSplitFixture[] = [
  {
    id: 'SPLIT-INVALID-FIXED-SUM',
    description: 'Fixed amounts that do not sum to the total are rejected',
    amountTotal: 100,
    splits: [line('user-a', 'fixed', 30), line('user-b', 'fixed', 60)],
    reason: 'Fixed split amounts must equal amountTotal',
  },
  {
    id: 'SPLIT-INVALID-PERCENT-SUM',
    description: 'Percent values that do not sum to 100 are rejected',
    amountTotal: 100,
    splits: [line('user-a', 'percent', 25), line('user-b', 'percent', 70)],
    reason: 'Percent split values must sum to 100',
  },
  {
    id: 'SPLIT-INVALID-MIXED-TYPES',
    description: 'Mixed split types in one expense are rejected',
    amountTotal: 100,
    splits: [line('user-a', 'equal', 1), line('user-b', 'fixed', 50)],
    reason: 'All split lines must use the same splitType',
  },
  {
    id: 'SPLIT-INVALID-ZERO-TOTAL',
    description: 'A zero total is rejected',
    amountTotal: 0,
    splits: [line('user-a', 'equal', 1), line('user-b', 'equal', 1)],
    reason: 'Total amount must be greater than zero',
  },
  {
    id: 'SPLIT-INVALID-NONPOSITIVE-SHARE',
    description: 'A non-positive share weight is rejected',
    amountTotal: 100,
    splits: [line('user-a', 'share', 1), line('user-b', 'share', 0)],
    reason: 'Share values must be positive numbers',
  },
];

// ─── Settlement / P2P netting fixtures (simplifyLedgerDebts) ─────────────────

export interface Balance {
  key: string;
  balance: number;
}

export interface ExpectedTransfer {
  fromKey: string;
  toKey: string;
  amount: number;
}

export interface SettlementFixture {
  id: string;
  description: string;
  currency: string;
  balances: Balance[];
  expected: ExpectedTransfer[];
}

export const SETTLEMENT_FIXTURES: SettlementFixture[] = [
  {
    id: 'SETTLE-SIMPLE',
    description: 'A owes 50, B is owed 50 → A pays B 50.00',
    currency: 'USD',
    balances: [
      { key: 'user-a', balance: -50 },
      { key: 'user-b', balance: 50 },
    ],
    expected: [{ fromKey: 'user-a', toKey: 'user-b', amount: 50 }],
  },
  {
    id: 'SETTLE-MULTI-DEBTORS',
    description: 'A -30, B -20, C +50 → A→C 30.00, then B→C 20.00',
    currency: 'USD',
    balances: [
      { key: 'user-a', balance: -30 },
      { key: 'user-b', balance: -20 },
      { key: 'user-c', balance: 50 },
    ],
    expected: [
      { fromKey: 'user-a', toKey: 'user-c', amount: 30 },
      { fromKey: 'user-b', toKey: 'user-c', amount: 20 },
    ],
  },
  {
    id: 'SETTLE-TIEBREAK',
    description:
      'Two debtors tied at -25 → lexicographic tie-break: A→C 25.00, then B→C 25.00',
    currency: 'USD',
    balances: [
      { key: 'user-a', balance: -25 },
      { key: 'user-b', balance: -25 },
      { key: 'user-c', balance: 50 },
    ],
    expected: [
      { fromKey: 'user-a', toKey: 'user-c', amount: 25 },
      { fromKey: 'user-b', toKey: 'user-c', amount: 25 },
    ],
  },
  {
    id: 'P2P-NET-AFTER-LEND-BORROW',
    description:
      'P2P: net of lend/borrow leaves A -40, B +40 → single transfer A→B 40.00',
    currency: 'USD',
    balances: [
      { key: 'user-a', balance: -40 },
      { key: 'user-b', balance: 40 },
    ],
    expected: [{ fromKey: 'user-a', toKey: 'user-b', amount: 40 }],
  },
  {
    id: 'SETTLE-ZERO-TOLERANCE',
    description:
      'Sub-cent balances (|b| < 0.01) are treated as settled → no transfers',
    currency: 'USD',
    balances: [
      { key: 'user-a', balance: -0.005 },
      { key: 'user-b', balance: 0.005 },
    ],
    expected: [],
  },
  {
    id: 'SETTLE-ALREADY-SETTLED',
    description: 'All-zero balances → no transfers (P2P after full settlement)',
    currency: 'USD',
    balances: [
      { key: 'user-a', balance: 0 },
      { key: 'user-b', balance: 0 },
    ],
    expected: [],
  },
];

/**
 * MULTI-CURRENCY: the app nets each currency INDEPENDENTLY (no FX). Each entry is
 * simplified with its own currency; there must be no cross-currency netting.
 */
export const MULTI_CURRENCY_FIXTURE = {
  id: 'SETTLE-MULTI-CURRENCY',
  description:
    'USD {A:-50,B:+50} and INR {A:+50,B:-50} settle independently — no FX, no cross-netting',
  perCurrency: [
    {
      currency: 'USD',
      balances: [
        { key: 'user-a', balance: -50 },
        { key: 'user-b', balance: 50 },
      ],
      expected: [{ fromKey: 'user-a', toKey: 'user-b', amount: 50 }],
    },
    {
      currency: 'INR',
      balances: [
        { key: 'user-a', balance: 50 },
        { key: 'user-b', balance: -50 },
      ],
      expected: [{ fromKey: 'user-b', toKey: 'user-a', amount: 50 }],
    },
  ],
};

// ─── Refund fixtures (expense splits minus refund splits; signedAmount rule) ──

export interface RefundFixture {
  id: string;
  description: string;
  currency: string;
  expense: { amountTotal: number; splits: SplitLine[]; payerKey?: string };
  refunds: { amountTotal: number; splits: SplitLine[]; payerKey?: string }[];
  /** Expected NET owed per participant in CENTS = expense − Σ refunds. */
  expectedNetCents: Record<string, number>;
}

export const REFUND_FIXTURES: RefundFixture[] = [
  {
    id: 'REFUND-FULL',
    description: 'Full refund of a 100.00 equal split → everyone nets 0',
    currency: 'USD',
    expense: {
      amountTotal: 100,
      splits: [line('user-a', 'equal', 1), line('user-b', 'equal', 1)],
      payerKey: 'user-a',
    },
    refunds: [
      {
        amountTotal: 100,
        splits: [line('user-a', 'equal', 1), line('user-b', 'equal', 1)],
        payerKey: 'user-a',
      },
    ],
    expectedNetCents: { 'user-a': 0, 'user-b': 0 },
  },
  {
    id: 'REFUND-PARTIAL-ONE',
    description:
      'Expense A 60 / B 40 (fixed); 20.00 refunded to B only → net A 60.00, B 20.00',
    currency: 'USD',
    expense: {
      amountTotal: 100,
      splits: [line('user-a', 'fixed', 60), line('user-b', 'fixed', 40)],
      payerKey: 'user-a',
    },
    refunds: [
      {
        amountTotal: 20,
        splits: [line('user-b', 'fixed', 20)],
        payerKey: 'user-b',
      },
    ],
    expectedNetCents: { 'user-a': 6000, 'user-b': 2000 },
  },
  {
    id: 'REFUND-COMPOSE-TWO',
    description:
      'Expense 100.00 equal A/B; two 10.00 refunds split equally compose → net 40.00 / 40.00',
    currency: 'USD',
    expense: {
      amountTotal: 100,
      splits: [line('user-a', 'equal', 1), line('user-b', 'equal', 1)],
      payerKey: 'user-a',
    },
    refunds: [
      {
        amountTotal: 10,
        splits: [line('user-a', 'equal', 1), line('user-b', 'equal', 1)],
        payerKey: 'user-a',
      },
      {
        amountTotal: 10,
        splits: [line('user-a', 'equal', 1), line('user-b', 'equal', 1)],
        payerKey: 'user-a',
      },
    ],
    expectedNetCents: { 'user-a': 4000, 'user-b': 4000 },
  },
];
