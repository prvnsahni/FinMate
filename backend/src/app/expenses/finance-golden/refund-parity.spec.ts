/**
 * FIN-002 refund parity. A refund reuses the SAME split model as an expense but
 * contributes NEGATIVELY to net spend — the production rule is
 * `ExpensesService.signedAmount(value, 'refund') = -value`. This suite computes
 * every expense and refund split with the REAL `calculateDeterministicSplits`
 * and asserts the net (expense − Σ refunds) in integer cents.
 *
 * The only non-calculator arithmetic here is that single documented sign flip;
 * the hard split math always comes from the real shared calculator.
 */
import { calculateDeterministicSplits } from '../split-calculator.util';
import { REFUND_FIXTURES, toCents, SplitLine } from './golden-fixtures';

const owedCents = (
  amountTotal: number,
  splits: SplitLine[],
  payerKey?: string,
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const s of calculateDeterministicSplits(amountTotal, splits, payerKey)) {
    out[s.participantUserId as string] = toCents(s.amountOwed);
  }
  return out;
};

describe('Finance golden parity — refunds (FIN-002)', () => {
  for (const fx of REFUND_FIXTURES) {
    it(`${fx.id}: ${fx.description}`, () => {
      // Start from the expense contributions.
      const net: Record<string, number> = owedCents(
        fx.expense.amountTotal,
        fx.expense.splits,
        fx.expense.payerKey,
      );

      // Subtract each refund's per-participant share (signedAmount = -value).
      for (const refund of fx.refunds) {
        const refundOwed = owedCents(
          refund.amountTotal,
          refund.splits,
          refund.payerKey,
        );
        for (const [key, cents] of Object.entries(refundOwed)) {
          net[key] = (net[key] ?? 0) - cents;
        }
      }

      expect(net).toEqual(fx.expectedNetCents);
    });
  }

  describe('adversarial — refund changes must move the net', () => {
    it('a larger refund reduces the net further; unrelated participants are untouched', () => {
      const expense = owedCents(
        100,
        [
          { participantUserId: 'user-a', splitType: 'fixed', shareValue: 60 },
          { participantUserId: 'user-b', splitType: 'fixed', shareValue: 40 },
        ],
        'user-a',
      );
      const smallRefund = owedCents(
        10,
        [{ participantUserId: 'user-b', splitType: 'fixed', shareValue: 10 }],
        'user-b',
      );
      const bigRefund = owedCents(
        30,
        [{ participantUserId: 'user-b', splitType: 'fixed', shareValue: 30 }],
        'user-b',
      );

      const netSmall = expense['user-b'] - smallRefund['user-b'];
      const netBig = expense['user-b'] - bigRefund['user-b'];
      expect(netSmall).toBe(3000); // 40 − 10
      expect(netBig).toBe(1000); // 40 − 30
      expect(netSmall).not.toBe(netBig);
      // A is unrelated to a B-only refund and must not move.
      expect(expense['user-a']).toBe(6000);
    });
  });
});
