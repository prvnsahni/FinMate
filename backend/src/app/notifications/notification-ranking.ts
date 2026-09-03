import {
  NotificationCandidate,
  NotificationControl,
  NotificationLevel,
  RankedNotification,
} from './notification.types';
import {
  CONFIDENCE_MIN_FOR_PROMOTE,
  CONTROL_MAX_LEVEL,
  IMPORTANCE_BASE_LEVEL,
  LOW_CONFIDENCE_DEMOTE,
  URGENCY_PROMOTE_THRESHOLD,
} from './notification-ranking.constants';

/**
 * Pure, deterministic ranking (no ML, no personalization, no external calls).
 * The same underlying candidates always produce the same ordering.
 */

const clampLevel = (n: number): NotificationLevel =>
  Math.min(5, Math.max(1, n)) as NotificationLevel;

/**
 * Resolve a candidate's L1–L5 level from importance, then adjust by urgency and
 * confidence: high urgency + sufficient confidence promotes one level; low
 * confidence demotes one level.
 */
export function computeLevel(
  candidate: NotificationCandidate,
): NotificationLevel {
  let level: number = IMPORTANCE_BASE_LEVEL[candidate.importance] ?? 3;
  if (
    candidate.urgency >= URGENCY_PROMOTE_THRESHOLD &&
    candidate.confidence >= CONFIDENCE_MIN_FOR_PROMOTE
  ) {
    level -= 1;
  }
  if (candidate.confidence < LOW_CONFIDENCE_DEMOTE) {
    level += 1;
  }
  return clampLevel(level);
}

/**
 * Whether a candidate at `level` is visible under the given control. Critical
 * security events (security && level 1) always survive, even under "off" (NOT-006).
 */
export function isVisible(
  level: NotificationLevel,
  control: NotificationControl,
  security?: boolean,
): boolean {
  if (security && level === 1) return true;
  return level <= CONTROL_MAX_LEVEL[control];
}

/** Stable tie-breaker within the same level: urgency ↓, confidence ↓, observedAt ↓, id ↑. */
function compareSameLevel(
  a: NotificationCandidate,
  b: NotificationCandidate,
): number {
  if (b.urgency !== a.urgency) return b.urgency - a.urgency;
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  if (a.observedAt !== b.observedAt)
    return a.observedAt < b.observedAt ? 1 : -1; // newer first
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const toRanked = (
  candidate: NotificationCandidate,
  level: NotificationLevel,
): RankedNotification => ({
  id: candidate.id,
  category: candidate.category,
  level,
  title: candidate.title,
  message: candidate.message,
  actionable: candidate.actionable,
  observedAt: candidate.observedAt,
  ...(candidate.action ? { action: candidate.action } : {}),
});

/**
 * Rank candidates for the given control: compute levels, drop items hidden by the
 * control (except surviving critical security), sort by level then the stable
 * tie-breaker, and minimize to the API shape. Deterministic and pure.
 */
export function rankCandidates(
  candidates: NotificationCandidate[],
  control: NotificationControl,
): RankedNotification[] {
  return candidates
    .map((candidate) => ({ candidate, level: computeLevel(candidate) }))
    .filter(({ candidate, level }) =>
      isVisible(level, control, candidate.security),
    )
    .sort((a, b) =>
      a.level !== b.level
        ? a.level - b.level
        : compareSameLevel(a.candidate, b.candidate),
    )
    .map(({ candidate, level }) => toRanked(candidate, level));
}
