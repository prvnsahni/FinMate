/**
 * FIN-002 split parity — exercises the REAL production split calculator
 * (`calculateDeterministicSplits`, imported through the same
 * `../split-calculator.util` the ExpensesService uses) against hand-computed
 * golden expectations in integer cents. See ./README.md.
 */
import { BadRequestException } from '@nestjs/common';
import { calculateDeterministicSplits } from '../split-calculator.util';
import {
  SPLIT_FIXTURES,
  INVALID_SPLIT_FIXTURES,
  toCents,
  SplitType,
} from './golden-fixtures';

/** Run the real calculator and reduce its output to { participantKey: cents }. */
const runToCents = (
  amountTotal: number,
  splits: {
    participantUserId: string;
    splitType: SplitType;
    shareValue: number;
  }[],
  payerKey?: string,
): Record<string, number> => {
  const result = calculateDeterministicSplits(amountTotal, splits, payerKey);
  const out: Record<string, number> = {};
  for (const s of result) {
    out[s.participantUserId as string] = toCents(s.amountOwed);
  }
  return out;
};

describe('Finance golden parity — splits (FIN-002)', () => {
  for (const fx of SPLIT_FIXTURES) {
    it(`${fx.id}: ${fx.description}`, () => {
      const actual = runToCents(fx.amountTotal, fx.splits, fx.payerKey);
      expect(actual).toEqual(fx.expectedCents);

      // Conservation: the split must reconcile exactly to the total (no cents
      // created or lost).
      const sumCents = Object.values(actual).reduce((a, b) => a + b, 0);
      expect(sumCents).toBe(toCents(fx.amountTotal));
    });
  }

  describe('invalid inputs are rejected (unsupported behaviour is NOT invented)', () => {
    for (const fx of INVALID_SPLIT_FIXTURES) {
      it(`${fx.id}: ${fx.description}`, () => {
        // The backend wraps the shared SplitCalculationError as a NestJS
        // BadRequestException carrying { errorCode: 'VAL_INVALID_INPUT', message }.
        expect(() =>
          calculateDeterministicSplits(fx.amountTotal, fx.splits, fx.payerKey),
        ).toThrow(BadRequestException);
        try {
          calculateDeterministicSplits(fx.amountTotal, fx.splits, fx.payerKey);
        } catch (e) {
          const resp = (e as BadRequestException).getResponse() as {
            errorCode: string;
            message: string;
          };
          expect(resp.errorCode).toBe('VAL_INVALID_INPUT');
          expect(resp.message).toContain(fx.reason);
        }
      });
    }
  });

  describe('adversarial — the gate must FAIL when a financial input changes', () => {
    it('changed PAYER moves the leftover cent (A-payer ≠ C-payer)', () => {
      const withPayerA = runToCents(
        100,
        [
          { participantUserId: 'user-a', splitType: 'equal', shareValue: 1 },
          { participantUserId: 'user-b', splitType: 'equal', shareValue: 1 },
          { participantUserId: 'user-c', splitType: 'equal', shareValue: 1 },
        ],
        'user-a',
      );
      const withPayerC = runToCents(
        100,
        [
          { participantUserId: 'user-a', splitType: 'equal', shareValue: 1 },
          { participantUserId: 'user-b', splitType: 'equal', shareValue: 1 },
          { participantUserId: 'user-c', splitType: 'equal', shareValue: 1 },
        ],
        'user-c',
      );
      expect(withPayerA).not.toEqual(withPayerC);
      expect(withPayerA['user-a']).toBe(3334);
      expect(withPayerC['user-c']).toBe(3334);
    });

    it('changed AMOUNT changes the result', () => {
      const a = runToCents(
        100,
        [
          { participantUserId: 'user-a', splitType: 'equal', shareValue: 1 },
          { participantUserId: 'user-b', splitType: 'equal', shareValue: 1 },
        ],
        'user-a',
      );
      const b = runToCents(
        101,
        [
          { participantUserId: 'user-a', splitType: 'equal', shareValue: 1 },
          { participantUserId: 'user-b', splitType: 'equal', shareValue: 1 },
        ],
        'user-a',
      );
      expect(a).not.toEqual(b);
    });

    it('an EXTRA participant (e.g. wrongly-included spectator) changes every share', () => {
      const two = runToCents(
        100,
        [
          { participantUserId: 'user-a', splitType: 'equal', shareValue: 1 },
          { participantUserId: 'user-b', splitType: 'equal', shareValue: 1 },
        ],
        'user-a',
      );
      const three = runToCents(
        100,
        [
          { participantUserId: 'user-a', splitType: 'equal', shareValue: 1 },
          { participantUserId: 'user-b', splitType: 'equal', shareValue: 1 },
          { participantUserId: 'user-c', splitType: 'equal', shareValue: 1 },
        ],
        'user-a',
      );
      expect(two['user-a']).toBe(5000);
      expect(three['user-a']).toBe(3334);
    });

    it('a deliberately-wrong expectation does NOT match (oracle is exact)', () => {
      const actual = runToCents(
        100,
        [
          { participantUserId: 'user-a', splitType: 'equal', shareValue: 1 },
          { participantUserId: 'user-b', splitType: 'equal', shareValue: 1 },
        ],
        'user-a',
      );
      expect(actual).not.toEqual({ 'user-a': 5001, 'user-b': 4999 });
    });
  });
});
