import { NotificationCandidate } from './notification.types';

/**
 * A source of notification candidates derived from the authenticated user's own
 * authorized data. Providers MUST be strictly read-only and MUST scope every read
 * to `userId` (no cross-user access, no other user's raw data). New providers can
 * be added without changing the API or the frontend contract.
 */
export interface NotificationCandidateProvider {
  /** Stable provider name (for logging/diagnostics). */
  readonly name: string;
  getCandidates(userId: string): Promise<NotificationCandidate[]>;
}

/** DI token for the array of registered candidate providers. */
export const NOTIFICATION_PROVIDERS = Symbol('NOTIFICATION_PROVIDERS');
