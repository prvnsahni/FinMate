/**
 * In-app ranked notifications (BATCH-12 / W-NOT-01 · SRS NOT-001/003/004/006/007,
 * UX-007 · ADR-021). V1 is COMPUTED and READ-ONLY — candidates are derived from
 * the authenticated user's own authorized data, ranked L1–L5, filtered by the
 * user's 3-way control, and suppressed once seen/acted. No DB table, no OS push,
 * no AI, no engagement scoring.
 *
 * The API contract (`RankedNotification`) is deliberately decoupled from the
 * candidate-generation implementation so the engine can be replaced later without
 * changing the API or the frontend.
 */

/** L1 = critical … L5 = optional. */
export type NotificationLevel = 1 | 2 | 3 | 4 | 5;

/** Frozen 3-way user control (NOT-004). */
export type NotificationControl = 'quieter' | 'standard' | 'off';

export type NotificationImportance =
  | 'critical'
  | 'high'
  | 'useful'
  | 'low'
  | 'optional';

export type NotificationCategory =
  | 'security'
  | 'recurring'
  | 'settlement'
  | 'reminder'
  | 'finance';

export type NotificationSourceDomain = 'CORE' | 'FINANCE';

/** An opaque, presentation-safe action reference — never a raw DB foreign key. */
export interface NotificationAction {
  type: string;
  /** Opaque reference the client can route on (e.g. a group id already owned). */
  ref?: string;
}

/**
 * A provider-produced candidate. `id` MUST be stable and deterministic for the
 * same underlying state (used for seen/acted suppression) and MUST NOT be a raw
 * database primary key.
 */
export interface NotificationCandidate {
  id: string;
  category: NotificationCategory;
  sourceDomain: NotificationSourceDomain;
  title: string;
  /** Presentation-safe message — no secrets, tokens, E2EE plaintext, or raw FKs. */
  message: string;
  importance: NotificationImportance;
  /** 0..1 */
  urgency: number;
  /** 0..1 */
  confidence: number;
  actionable: boolean;
  /** ISO timestamp of the underlying observation. */
  observedAt: string;
  action?: NotificationAction;
  /** True for critical security/life-impacting events (survive the "off" control). */
  security?: boolean;
}

/** The minimized shape returned by the API (no importance/urgency/confidence internals). */
export interface RankedNotification {
  id: string;
  category: NotificationCategory;
  level: NotificationLevel;
  title: string;
  message: string;
  actionable: boolean;
  observedAt: string;
  action?: NotificationAction;
}

export type NotificationState = 'seen' | 'acted';
