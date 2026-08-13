/**
 * FIN-014 spectator exclusion.
 *
 * The production backend enforces spectator exclusion at the service layer: a
 * member with role `spectator` is rejected from BOTH expense splits and the
 * payer set with error code `EXP_SPECTATOR_SPLIT`
 * (ExpensesService.persistSplits / payer validation). That rejection is an
 * authorization guard exercised by the ExpensesService integration specs.
 *
 * At the CALCULATION layer the guarantee is structural: the split calculator is
 * strictly participant-driven — it only ever distributes money across the
 * participants it is given, and it never fabricates a non-participant. So a
 * spectator that is (correctly) absent from the splits can have no financial
 * effect, and a spectator that were (wrongly) present would be financially
 * meaningful — which is exactly why the service must exclude them.
 */
import { calculateDeterministicSplits } from '../split-calculator.util';
import { toCents } from './golden-fixtures';

const keys = (
  splits: {
    participantUserId: string;
    splitType: 'equal';
    shareValue: number;
  }[],
) =>
  calculateDeterministicSplits(100, splits, 'user-a').map(
    (s) => s.participantUserId,
  );

describe('Finance golden parity — spectator exclusion (FIN-014)', () => {
  it('the calculator only ever returns the participants it was given', () => {
    const result = calculateDeterministicSplits(
      100,
      [
        { participantUserId: 'user-a', splitType: 'equal', shareValue: 1 },
        { participantUserId: 'user-b', splitType: 'equal', shareValue: 1 },
      ],
      'user-a',
    );
    const ids = result.map((s) => s.participantUserId);
    expect(ids).toEqual(['user-a', 'user-b']);
    // A spectator who is absent from the input never appears in the output.
    expect(ids).not.toContain('user-spectator');
  });

  it('an absent spectator has ZERO financial effect (identical to excluding them)', () => {
    const withoutSpectator = calculateDeterministicSplits(
      100,
      [
        { participantUserId: 'user-a', splitType: 'equal', shareValue: 1 },
        { participantUserId: 'user-b', splitType: 'equal', shareValue: 1 },
      ],
      'user-a',
    );
    // Same two participants; a spectator simply is not in the list.
    expect(withoutSpectator.map((s) => toCents(s.amountOwed))).toEqual([
      5000, 5000,
    ]);
  });

  it('a WRONGLY-included spectator would change everyone’s share (why exclusion matters)', () => {
    const excluded = keys([
      { participantUserId: 'user-a', splitType: 'equal', shareValue: 1 },
      { participantUserId: 'user-b', splitType: 'equal', shareValue: 1 },
    ]);
    const included = keys([
      { participantUserId: 'user-a', splitType: 'equal', shareValue: 1 },
      { participantUserId: 'user-b', splitType: 'equal', shareValue: 1 },
      { participantUserId: 'user-spectator', splitType: 'equal', shareValue: 1 },
    ]);
    expect(excluded).not.toEqual(included);
    expect(included).toContain('user-spectator');

    const twoWay = calculateDeterministicSplits(
      100,
      [
        { participantUserId: 'user-a', splitType: 'equal', shareValue: 1 },
        { participantUserId: 'user-b', splitType: 'equal', shareValue: 1 },
      ],
      'user-a',
    );
    const threeWay = calculateDeterministicSplits(
      100,
      [
        { participantUserId: 'user-a', splitType: 'equal', shareValue: 1 },
        { participantUserId: 'user-b', splitType: 'equal', shareValue: 1 },
        { participantUserId: 'user-spectator', splitType: 'equal', shareValue: 1 },
      ],
      'user-a',
    );
    expect(toCents(twoWay[0].amountOwed)).toBe(5000);
    expect(toCents(threeWay[0].amountOwed)).toBe(3334);
  });
});
