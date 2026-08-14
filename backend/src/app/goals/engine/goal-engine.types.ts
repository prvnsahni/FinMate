/**
 * Goal Engine contract (implements docs/architecture/FINMATE_GOAL_ENGINE_ARCHITECTURE.md).
 * The Goals module depends ONLY on the `GoalEngine` interface — never on this or
 * any concrete engine. Inputs are numeric/enum only (never the E2EE title/free-text).
 * The interface is the stable replacement boundary (deterministic V1 → future
 * model/population engines) and must not be redesigned here.
 */

export type EngineKind = 'deterministic' | 'model' | 'population';

export type EngineStatus =
  | 'ok'
  | 'insufficient_data'
  | 'invalid_goal'
  | 'unsupported_goal_type'
  | 'low_confidence';

export interface GoalProjectionInput {
  goal: {
    id: string;
    currency: string;
    targetAmount: number;
    savedAmount: number;
    targetDate?: string | null; // YYYY-MM-DD
    status: 'active' | 'achieved' | 'paused' | 'cancelled';
    priority?: number;
  };
  /** Explicit user-declared monthly contribution (takes precedence). */
  assumedMonthlyContribution?: number;
  /** Rate derived by the caller from the goal's own numeric progress (no free-text). */
  observedMonthlyRate?: number;
  /** Injected clock (ISO) so projections are fully deterministic. */
  now: string;
}

export interface GoalProjection {
  projectedCompletionDate?: string;
  onTrack?: boolean;
  requiredMonthlyContribution?: number;
  projectedShortfall?: number;
}

export interface GoalProjectionResult {
  engine: { name: string; version: string; kind: EngineKind };
  status: EngineStatus;
  projection?: GoalProjection;
  confidence?: {
    score: number; // 0..1
    band: 'low' | 'medium' | 'high';
    basis: 'data_sufficiency';
  };
  explanation: {
    method: 'deterministic';
    summary: string; // plain, no shame, no advice claim, no accuracy promise
    inputsUsed: string[];
    assumptionsUsed: string[];
    disclaimers: string[];
  };
  generatedAt: string;
}

export interface GoalEngine {
  readonly name: string;
  readonly version: string;
  readonly kind: EngineKind;
  project(input: GoalProjectionInput): GoalProjectionResult;
}

/** DI token so the concrete engine can be swapped without touching the Goals module. */
export const GOAL_ENGINE = Symbol('GOAL_ENGINE');
