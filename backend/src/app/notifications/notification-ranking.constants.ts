import {
  NotificationControl,
  NotificationImportance,
  NotificationLevel,
} from './notification.types';

/**
 * Ranking / control tuning. Every value here is **[PRODUCT-TUNABLE]** — the exact
 * thresholds are open product/design questions (SRS OQ-06/OQ-07, UX §28) and are
 * expected to be adjusted without code-structure changes. No ML, no personalization.
 */

/** Frozen default control (NOT-004). */
export const DEFAULT_CONTROL: NotificationControl = 'standard';

/** Base L1–L5 level per importance. [PRODUCT-TUNABLE] */
export const IMPORTANCE_BASE_LEVEL: Record<
  NotificationImportance,
  NotificationLevel
> = {
  critical: 1,
  high: 2,
  useful: 3,
  low: 4,
  optional: 5,
};

/** High urgency + sufficient confidence promotes a candidate one level. [PRODUCT-TUNABLE] */
export const URGENCY_PROMOTE_THRESHOLD = 0.8;
export const CONFIDENCE_MIN_FOR_PROMOTE = 0.6;
/** Low confidence demotes a candidate one level. [PRODUCT-TUNABLE] */
export const LOW_CONFIDENCE_DEMOTE = 0.4;

/**
 * Highest level visible per control (a candidate is shown if its level ≤ this).
 * `off` → 0 means "no non-critical items"; critical **security** L1 always survives
 * via an explicit override in the ranker (NOT-006). [PRODUCT-TUNABLE]
 */
export const CONTROL_MAX_LEVEL: Record<NotificationControl, number> = {
  standard: 4, // L5 (optional) hidden by default
  quieter: 2,
  off: 0,
};

/** Hard cap for the "While you were away" pull summary (UX-007 / OQ-16). [PRODUCT-TUNABLE] */
export const WHILE_AWAY_ITEM_CAP = 5;

/** Overall cap for a normal notifications fetch. [PRODUCT-TUNABLE] */
export const MAX_NOTIFICATIONS = 20;

/** Bounded Redis retention for seen/acted state (auto-expiry prevents growth). */
export const SEEN_STATE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** Cap on distinct seen/acted ids retained per user (bounds the Redis blob size). */
export const MAX_SEEN_IDS = 500;

/** Retention for the per-user control preference (refreshed on write). */
export const CONTROL_PREF_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year
