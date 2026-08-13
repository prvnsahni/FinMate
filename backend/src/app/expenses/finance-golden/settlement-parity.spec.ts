/**
 * FIN-002 settlement / P2P / multi-currency parity — exercises the REAL shared
 * debt-simplification algorithm (`simplifyLedgerDebts`, imported through the
 * same `../../common/ledger-debt-simplifier` re-export the backend uses).
 */
import { simplifyLedgerDebts } from '../../common/ledger-debt-simplifier';
import {
  SETTLEMENT_FIXTURES,
  MULTI_CURRENCY_FIXTURE,
  toCents,
} from './golden-fixtures';

const normalize = (
  txns: { fromKey: string; toKey: string; amount: number }[],
) =>
  txns.map((t) => ({
    fromKey: t.fromKey,
    toKey: t.toKey,
    amountCents: toCents(t.amount),
  }));

describe('Finance golden parity — settlements & P2P (FIN-002)', () => {
  for (const fx of SETTLEMENT_FIXTURES) {
    it(`${fx.id}: ${fx.description}`, () => {
      const actual = simplifyLedgerDebts(fx.balances, fx.currency);
      expect(normalize(actual)).toEqual(normalize(fx.expected));
      // Every emitted transfer carries the requested currency.
      actual.forEach((t) => expect(t.currency).toBe(fx.currency));
    });
  }

  describe('multi-currency: each currency settles independently (no FX)', () => {
    it(MULTI_CURRENCY_FIXTURE.id, () => {
      for (const leg of MULTI_CURRENCY_FIXTURE.perCurrency) {
        const actual = simplifyLedgerDebts(leg.balances, leg.currency);
        expect(normalize(actual)).toEqual(normalize(leg.expected));
        actual.forEach((t) => expect(t.currency).toBe(leg.currency));
      }
    });
  });

  describe('adversarial — the gate must FAIL when a financial input changes', () => {
    it('changed CURRENCY changes the emitted transfer currency', () => {
      const usd = simplifyLedgerDebts(
        [
          { key: 'user-a', balance: -50 },
          { key: 'user-b', balance: 50 },
        ],
        'USD',
      );
      const inr = simplifyLedgerDebts(
        [
          { key: 'user-a', balance: -50 },
          { key: 'user-b', balance: 50 },
        ],
        'INR',
      );
      expect(usd[0].currency).toBe('USD');
      expect(inr[0].currency).toBe('INR');
      expect(usd).not.toEqual(inr);
    });

    it('changed BALANCE changes the settlement amount', () => {
      const a = simplifyLedgerDebts(
        [
          { key: 'user-a', balance: -50 },
          { key: 'user-b', balance: 50 },
        ],
        'USD',
      );
      const b = simplifyLedgerDebts(
        [
          { key: 'user-a', balance: -60 },
          { key: 'user-b', balance: 60 },
        ],
        'USD',
      );
      expect(toCents(a[0].amount)).toBe(5000);
      expect(toCents(b[0].amount)).toBe(6000);
    });

    it('a deliberately-wrong expectation does NOT match (oracle is exact)', () => {
      const actual = simplifyLedgerDebts(
        [
          { key: 'user-a', balance: -50 },
          { key: 'user-b', balance: 50 },
        ],
        'USD',
      );
      expect(normalize(actual)).not.toEqual([
        { fromKey: 'user-b', toKey: 'user-a', amountCents: 5000 },
      ]);
    });
  });
});
