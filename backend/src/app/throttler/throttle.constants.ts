/**
 * Centralized throttle profile names and metadata key.
 *
 * Every throttle profile used in the application must be registered here.
 * This prevents typos and makes refactoring safer.
 *
 * When adding a new profile:
 *   1. Add it to THROTTLE_PROFILES
 *   2. Add a throttler entry in app.module.ts with skipIf
 *   3. Apply @ThrottleAs(THROTTLE_PROFILES.NEW_NAME) to the route
 *   4. Add test cases in throttle-policy.resolver.spec.ts and throttler-integration.spec.ts
 */
export const THROTTLE_PROFILES = {
  DEFAULT: 'default',
  LOGIN: 'login',
  REGISTER: 'register',
  FORGOT_PASSWORD: 'forgotPassword',
  RESET_PASSWORD: 'resetPassword',
  OTP: 'otp',
  REFRESH: 'refresh',
  IMPORT: 'import',
  EXPORT: 'export',
  INVITE: 'invite',
  PUBLIC_SHARE: 'publicShare',
} as const;

export type ThrottleProfile =
  (typeof THROTTLE_PROFILES)[keyof typeof THROTTLE_PROFILES];

/**
 * Metadata key owned by FinMate — not dependent on any @nestjs/throttler internals.
 * Used by ThrottlePolicyResolver to determine which throttle profile is active for a route.
 */
export const THROTTLE_POLICY_KEY = 'FINMATE:THROTTLE_POLICY';
