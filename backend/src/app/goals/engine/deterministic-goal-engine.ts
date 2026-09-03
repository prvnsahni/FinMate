import {
  EngineStatus,
  GoalEngine,
  GoalProjection,
  GoalProjectionInput,
  GoalProjectionResult,
} from './goal-engine.types';

/** Deterministic 2-dp money rounding (app-consistent). */
const round2 = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

const toUtc = (iso: string): Date => new Date(iso);

/** Whole calendar months from `from` to `to` (day-of-month aware). Can be negative. */
function monthsBetween(from: Date, to: Date): number {
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return months;
}

/** `date` + `n` months, returned as YYYY-MM-DD (UTC, day clamped to month length). */
function addMonths(date: Date, n: number): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + n;
  const targetY = y + Math.floor(m / 12);
  const targetM = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDay);
  const d = new Date(Date.UTC(targetY, targetM, day));
  return d.toISOString().slice(0, 10);
}

const dateOnly = (iso: string): string => toUtc(iso).toISOString().slice(0, 10);

/**
 * V1 deterministic Goal Engine. Pure arithmetic on the goal's own numeric fields
 * plus an optional user assumption — no AI, no personalization, no external calls,
 * no financial advice, no shame language. Same input ⇒ same output.
 */
export class DeterministicGoalEngine implements GoalEngine {
  readonly name = 'deterministic';
  readonly version = '1.0.0';
  readonly kind = 'deterministic' as const;

  project(input: GoalProjectionInput): GoalProjectionResult {
    const { goal } = input;
    const now = toUtc(input.now);
    const base = (status: EngineStatus, extra: Partial<GoalProjectionResult>) =>
      this.result(input, status, extra);

    if (!(goal.targetAmount > 0)) {
      return base('invalid_goal', {
        explanation: this.explain(
          'This goal has no positive target amount.',
          [],
          [],
        ),
      });
    }

    const remaining = round2(goal.targetAmount - goal.savedAmount);

    // Already reached.
    if (remaining <= 0) {
      return base('ok', {
        projection: {
          projectedCompletionDate: dateOnly(input.now),
          onTrack: true,
          requiredMonthlyContribution: 0,
          projectedShortfall: 0,
        },
        confidence: { score: 1, band: 'high', basis: 'data_sufficiency' },
        explanation: this.explain(
          'You have already reached this goal.',
          ['savedAmount', 'targetAmount'],
          [],
        ),
      });
    }

    const targetDate = goal.targetDate ? toUtc(goal.targetDate) : null;
    const monthsUntilTarget = targetDate
      ? Math.max(1, monthsBetween(now, targetDate))
      : undefined;
    const requiredMonthlyContribution =
      monthsUntilTarget !== undefined
        ? round2(remaining / monthsUntilTarget)
        : undefined;

    const rate =
      input.assumedMonthlyContribution && input.assumedMonthlyContribution > 0
        ? input.assumedMonthlyContribution
        : input.observedMonthlyRate && input.observedMonthlyRate > 0
          ? input.observedMonthlyRate
          : undefined;

    // No contribution rate → we cannot project a completion date; still surface
    // what would be required if a target date exists.
    if (rate === undefined) {
      const projection: GoalProjection = {};
      if (requiredMonthlyContribution !== undefined) {
        projection.requiredMonthlyContribution = requiredMonthlyContribution;
      }
      return base('insufficient_data', {
        projection: Object.keys(projection).length ? projection : undefined,
        explanation: this.explain(
          'Add a monthly contribution (or some savings history) to project a completion date.',
          [
            'targetAmount',
            'savedAmount',
            ...(targetDate ? ['targetDate'] : []),
          ],
          [],
        ),
      });
    }

    const monthsNeeded = Math.ceil(remaining / rate);
    const projectedCompletionDate = addMonths(now, monthsNeeded);
    const onTrack =
      targetDate !== null
        ? projectedCompletionDate <= dateOnly(goal.targetDate as string)
        : undefined;
    const projectedShortfall =
      targetDate !== null &&
      onTrack === false &&
      monthsUntilTarget !== undefined
        ? Math.max(0, round2(remaining - rate * monthsUntilTarget))
        : undefined;

    const usedAssumption =
      !!input.assumedMonthlyContribution &&
      input.assumedMonthlyContribution > 0;

    const summary = this.buildSummary(
      rate,
      goal.currency,
      projectedCompletionDate,
      onTrack,
      requiredMonthlyContribution,
      goal.currency,
    );

    return base('ok', {
      projection: {
        projectedCompletionDate,
        onTrack,
        requiredMonthlyContribution,
        projectedShortfall,
      },
      confidence: {
        score: usedAssumption ? 0.7 : 0.5,
        band: usedAssumption ? 'medium' : 'low',
        basis: 'data_sufficiency',
      },
      explanation: this.explain(
        summary,
        ['targetAmount', 'savedAmount', ...(targetDate ? ['targetDate'] : [])],
        usedAssumption
          ? ['assumedMonthlyContribution']
          : ['observedMonthlyRate'],
      ),
    });
  }

  private buildSummary(
    rate: number,
    _rateCurrency: string,
    completion: string,
    onTrack: boolean | undefined,
    required: number | undefined,
    currency: string,
  ): string {
    let s = `At about ${rate} ${currency}/month, the projected completion date is around ${completion}.`;
    if (onTrack === true) s += ' You are on track for your target date.';
    if (onTrack === false && required !== undefined) {
      s += ` To reach your target date, about ${required} ${currency}/month would be needed.`;
    }
    return s;
  }

  private explain(
    summary: string,
    inputsUsed: string[],
    assumptionsUsed: string[],
  ): GoalProjectionResult['explanation'] {
    return {
      method: 'deterministic',
      summary,
      inputsUsed,
      assumptionsUsed,
      disclaimers: [
        'This is a deterministic estimate based on your own numbers, not a guarantee or financial advice.',
      ],
    };
  }

  private result(
    input: GoalProjectionInput,
    status: EngineStatus,
    extra: Partial<GoalProjectionResult>,
  ): GoalProjectionResult {
    return {
      engine: { name: this.name, version: this.version, kind: this.kind },
      status,
      generatedAt: input.now,
      explanation:
        extra.explanation ?? this.explain('No projection available.', [], []),
      ...(extra.projection ? { projection: extra.projection } : {}),
      ...(extra.confidence ? { confidence: extra.confidence } : {}),
    };
  }
}
