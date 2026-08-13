/**
 * Feature-flag registry (BATCH-04 / W-PLAT-01).
 *
 * Every future security/product batch gates its rollout behind one of these
 * flags (see FINMATE_IMPLEMENTATION_ROADMAP §15 and the pre-implementation
 * execution plan). Each flag defaults to its SAFE state. Nothing in the app
 * reads these yet, so the defaults have NO current behavioural effect — this
 * batch only provides the framework the later batches will use.
 *
 * An env var (see `envKey`) overrides the default at runtime, e.g.
 * `FEATURE_AI_FIREWALL=true`. Accepted truthy: true/1/on/yes; falsy:
 * false/0/off/no (case-insensitive). Anything else falls back to the default.
 */
export type FeatureFlag =
  | 'auth.dualTransport'
  | 'enc.p2pNoteE2EE'
  | 'enc.settlementNoteE2EE'
  | 'enc.groupDescE2EE'
  | 'dbIsolation'
  | 'ai.firewall'
  | 'feature.goals'
  | 'notifications.inApp'
  | 'mobile.secureStorage'
  | 'mobile.push'
  | 'domain.intelligence';

export interface FeatureFlagDef {
  /** Env var whose value overrides the default (e.g. FEATURE_AI_FIREWALL). */
  envKey: string;
  /** Safe default applied when the env var is unset or unparseable. */
  default: boolean;
  /** Which batch/workstream will consume this flag. */
  description: string;
}

/**
 * All defaults are OFF (the safe state). Note: `auth.dualTransport` will default
 * ON *when BATCH-06 lands* (dual-emit must be on during the transition); it is
 * OFF here only because no auth-transport code reads it yet.
 */
export const FEATURE_FLAGS: Record<FeatureFlag, FeatureFlagDef> = {
  'auth.dualTransport': {
    envKey: 'FEATURE_AUTH_DUAL_TRANSPORT',
    default: false,
    description: 'BATCH-06 auth cookie/header dual-emit transition',
  },
  'enc.p2pNoteE2EE': {
    envKey: 'FEATURE_ENC_P2P_NOTE_E2EE',
    default: false,
    description: 'BATCH-08 P2P note E2EE (write encrypted); readers stay mixed-state',
  },
  'enc.settlementNoteE2EE': {
    envKey: 'FEATURE_ENC_SETTLEMENT_NOTE_E2EE',
    default: false,
    description: 'BATCH-08 settlement note E2EE',
  },
  'enc.groupDescE2EE': {
    envKey: 'FEATURE_ENC_GROUP_DESC_E2EE',
    default: false,
    description: 'BATCH-08 group description E2EE',
  },
  dbIsolation: {
    envKey: 'FEATURE_DB_ISOLATION',
    default: false,
    description: 'BATCH-10 per-domain DB principals (new domains only)',
  },
  'ai.firewall': {
    envKey: 'FEATURE_AI_FIREWALL',
    default: false,
    description: 'BATCH-13 AI privacy firewall (proxy retained until retired)',
  },
  'feature.goals': {
    envKey: 'FEATURE_GOALS',
    default: false,
    description: 'BATCH-11 goals-v2 (born-E2EE)',
  },
  'notifications.inApp': {
    envKey: 'FEATURE_NOTIFICATIONS_IN_APP',
    default: false,
    description: 'BATCH-12 in-app ranked notifications',
  },
  'mobile.secureStorage': {
    envKey: 'FEATURE_MOBILE_SECURE_STORAGE',
    default: false,
    description: 'BATCH-14 native secure-storage refresh transport',
  },
  'mobile.push': {
    envKey: 'FEATURE_MOBILE_PUSH',
    default: false,
    description: 'BATCH-14 OS push',
  },
  'domain.intelligence': {
    envKey: 'FEATURE_DOMAIN_INTELLIGENCE',
    default: false,
    description: 'BATCH-15 V2 intelligence domain',
  },
};

export const ALL_FEATURE_FLAGS = Object.keys(FEATURE_FLAGS) as FeatureFlag[];

/**
 * Parse an env value into a boolean, or `undefined` when unset/unrecognized
 * (so the caller can fall back to the registered default).
 */
export function parseFlagValue(
  raw: string | boolean | undefined | null,
): boolean | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'boolean') return raw;
  const v = String(raw).trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'on' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
  return undefined;
}
