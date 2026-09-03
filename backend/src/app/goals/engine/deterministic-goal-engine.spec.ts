import { DeterministicGoalEngine } from './deterministic-goal-engine';
import { GoalProjectionInput } from './goal-engine.types';

const engine = new DeterministicGoalEngine();

const input = (
  over: Partial<GoalProjectionInput> = {},
): GoalProjectionInput => ({
  goal: {
    id: 'g1',
    currency: 'USD',
    targetAmount: 1000,
    savedAmount: 0,
    status: 'active',
    ...(over.goal ?? {}),
  },
  now: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('DeterministicGoalEngine (Goal Engine V1)', () => {
  it('invalid_goal when target amount is not positive', () => {
    const r = engine.project(
      input({
        goal: {
          id: 'g',
          currency: 'USD',
          targetAmount: 0,
          savedAmount: 0,
          status: 'active',
        },
      }),
    );
    expect(r.status).toBe('invalid_goal');
    expect(r.projection).toBeUndefined();
  });

  it('already reached → ok, on track, completion today', () => {
    const r = engine.project(
      input({
        goal: {
          id: 'g',
          currency: 'USD',
          targetAmount: 500,
          savedAmount: 500,
          status: 'active',
        },
      }),
    );
    expect(r.status).toBe('ok');
    expect(r.projection?.onTrack).toBe(true);
    expect(r.projection?.projectedCompletionDate).toBe('2026-01-01');
  });

  it('insufficient_data when there is no contribution rate', () => {
    const r = engine.project(input());
    expect(r.status).toBe('insufficient_data');
    expect(r.projection?.projectedCompletionDate).toBeUndefined();
  });

  it('insufficient_data still surfaces requiredMonthlyContribution when a target date exists', () => {
    const r = engine.project(
      input({
        goal: {
          id: 'g',
          currency: 'USD',
          targetAmount: 1200,
          savedAmount: 0,
          status: 'active',
          targetDate: '2027-01-01',
        },
      }),
    );
    expect(r.status).toBe('insufficient_data');
    expect(r.projection?.requiredMonthlyContribution).toBe(100); // 1200 / 12 months
  });

  it('projects a completion date from an assumed monthly contribution', () => {
    const r = engine.project(input({ assumedMonthlyContribution: 100 }));
    expect(r.status).toBe('ok');
    expect(r.projection?.projectedCompletionDate).toBe('2026-11-01'); // ceil(1000/100)=10 months
    expect(r.confidence?.band).toBe('medium');
  });

  it('on track when the projection meets the target date', () => {
    const r = engine.project(
      input({
        assumedMonthlyContribution: 100,
        goal: {
          id: 'g',
          currency: 'USD',
          targetAmount: 1000,
          savedAmount: 0,
          status: 'active',
          targetDate: '2027-01-01',
        },
      }),
    );
    expect(r.projection?.onTrack).toBe(true);
    expect(r.projection?.projectedShortfall).toBeUndefined();
  });

  it('off track → computes required contribution and shortfall', () => {
    const r = engine.project(
      input({
        assumedMonthlyContribution: 100,
        goal: {
          id: 'g',
          currency: 'USD',
          targetAmount: 1200,
          savedAmount: 0,
          status: 'active',
          targetDate: '2026-06-01',
        },
      }),
    );
    expect(r.projection?.onTrack).toBe(false);
    expect(r.projection?.requiredMonthlyContribution).toBe(240); // 1200 / 5 months
    expect(r.projection?.projectedShortfall).toBe(700); // 1200 - 100*5
  });

  it('uses observedMonthlyRate (lower confidence) when no assumption is given', () => {
    const r = engine.project(input({ observedMonthlyRate: 200 }));
    expect(r.status).toBe('ok');
    expect(r.confidence?.band).toBe('low');
    expect(r.projection?.projectedCompletionDate).toBe('2026-06-01'); // ceil(1000/200)=5
  });

  it('is deterministic — same input yields identical output', () => {
    const a = engine.project(input({ assumedMonthlyContribution: 100 }));
    const b = engine.project(input({ assumedMonthlyContribution: 100 }));
    expect(a).toEqual(b);
  });

  it('always includes explanation + disclaimers and never uses shame/advice language', () => {
    const r = engine.project(input({ assumedMonthlyContribution: 100 }));
    expect(r.explanation.method).toBe('deterministic');
    expect(r.explanation.disclaimers.length).toBeGreaterThan(0);
    const text = JSON.stringify(r).toLowerCase();
    for (const banned of [
      'fail',
      'ai predicts',
      'you should buy',
      'invest',
      'shame',
    ]) {
      expect(text).not.toContain(banned);
    }
  });

  it('carries no free-text/PII input — only numeric/enum fields', () => {
    // The input type has no title/free-text; a stray field must not surface.
    const r = engine.project(input({ assumedMonthlyContribution: 100 }));
    expect(JSON.stringify(r)).not.toContain('title');
  });
});
