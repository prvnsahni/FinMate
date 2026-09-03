/**
 * FIN-013 month-lock regression — exercises the REAL single-source-of-truth
 * policy (`ExpenseEditPolicyService`) with an INJECTED clock so the edit window
 * is fully deterministic. Rule: current month always open; previous month open
 * through MONTH_LOCK_DAY (inclusive, end of day) of the current month; older
 * months and post-grace previous months are fully closed.
 *
 * Clocks are built with the LOCAL numeric Date constructor to match the policy's
 * own local `graceEnd`, so the boundary is stable regardless of the machine TZ.
 * This does NOT modify household/lock behaviour — it only asserts the current one.
 */
import { ForbiddenException } from '@nestjs/common';
import {
  ExpenseEditPolicyService,
  MONTH_LOCK_ERROR_CODE,
} from '../services/expense-edit-policy.service';

const LOCK_DAY = 7;
const policy = new ExpenseEditPolicyService(); // no ConfigService needed

/** Local wall-clock date at noon (avoids DST/UTC edges). */
const local = (year: number, month1: number, day: number): Date =>
  new Date(year, month1 - 1, day, 12, 0, 0, 0);

const ctx = (now: Date) => ({ now, monthLockDay: LOCK_DAY });

describe('Finance golden parity — month lock (FIN-013)', () => {
  it('current calendar month is always OPEN', () => {
    const p = policy.getPolicy('2026-08-15', ctx(local(2026, 8, 20)));
    expect(p.state).toBe('open');
    expect(p.canEditFinancialFields).toBe(true);
    expect(p.canDeleteExpense).toBe(true);
  });

  it('previous month is OPEN up to and including MONTH_LOCK_DAY', () => {
    expect(policy.getPolicy('2026-07-15', ctx(local(2026, 8, 7))).state).toBe(
      'open',
    );
    expect(
      policy.canEditFinancialFields('2026-07-15', ctx(local(2026, 8, 5))),
    ).toBe(true);
  });

  it('previous month is CLOSED after MONTH_LOCK_DAY', () => {
    const p = policy.getPolicy('2026-07-15', ctx(local(2026, 8, 10)));
    expect(p.state).toBe('closed');
    expect(p.canEditFinancialFields).toBe(false);
    expect(p.canDeleteExpense).toBe(false);
  });

  it('older months are CLOSED even inside the current grace window', () => {
    const p = policy.getPolicy('2026-06-15', ctx(local(2026, 8, 5)));
    expect(p.state).toBe('closed');
  });

  it('handles the December → January year rollover of the grace window', () => {
    // Dec 2025 expense stays open through Jan 7 2026.
    expect(policy.getPolicy('2025-12-20', ctx(local(2026, 1, 5))).state).toBe(
      'open',
    );
    expect(policy.getPolicy('2025-12-20', ctx(local(2026, 1, 10))).state).toBe(
      'closed',
    );
  });

  it('adminOverride re-opens any month (future hook, currently unused by callers)', () => {
    const p = policy.getPolicy('2020-01-15', {
      now: local(2026, 8, 20),
      monthLockDay: LOCK_DAY,
      adminOverride: true,
    });
    expect(p.state).toBe('open');
  });

  it('lockedBeforeMonth permanently closes earlier months', () => {
    const p = policy.getPolicy('2026-07-15', {
      now: local(2026, 8, 5), // would otherwise be inside the grace window
      monthLockDay: LOCK_DAY,
      lockedBeforeMonth: '2026-08',
    });
    expect(p.state).toBe('closed');
  });

  describe('enforcement entry points throw with the locked error code', () => {
    it('assertCanEdit throws on a closed month', () => {
      expect(() =>
        policy.assertCanEdit('2026-06-15', ctx(local(2026, 8, 10))),
      ).toThrow(ForbiddenException);
      try {
        policy.assertCanEdit('2026-06-15', ctx(local(2026, 8, 10)));
      } catch (e) {
        const resp = (e as ForbiddenException).getResponse() as {
          errorCode: string;
        };
        expect(resp.errorCode).toBe(MONTH_LOCK_ERROR_CODE);
      }
    });

    it('assertCanEdit does NOT throw on an open month', () => {
      expect(() =>
        policy.assertCanEdit('2026-08-15', ctx(local(2026, 8, 20))),
      ).not.toThrow();
    });

    it('assertCanDelete throws on a closed month', () => {
      expect(() =>
        policy.assertCanDelete('2026-06-15', ctx(local(2026, 8, 10))),
      ).toThrow(ForbiddenException);
    });
  });

  describe('adversarial — a one-day clock move flips the boundary', () => {
    it('open on the lock day, closed the next day', () => {
      expect(policy.getPolicy('2026-07-15', ctx(local(2026, 8, 7))).state).toBe(
        'open',
      );
      expect(policy.getPolicy('2026-07-15', ctx(local(2026, 8, 8))).state).toBe(
        'closed',
      );
    });
  });
});
