import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FeatureFlag,
  FEATURE_FLAGS,
  ALL_FEATURE_FLAGS,
  parseFlagValue,
} from './feature-flags.constants';

/**
 * Central feature-flag reader (BATCH-04 / W-PLAT-01). Future security/product
 * batches call `isEnabled(flag)` to gate their rollout; a flag's value is the
 * env override (via ConfigService) or, when unset/unparseable, the registered
 * safe default. Pure with respect to app state — it only reads config.
 */
@Injectable()
export class FeatureFlagsService {
  constructor(@Optional() private readonly config?: ConfigService) {}

  /** Whether a feature flag is enabled. Unknown flags are treated as OFF. */
  isEnabled(flag: FeatureFlag): boolean {
    const def = FEATURE_FLAGS[flag];
    if (!def) return false;
    const raw = this.config?.get<string | boolean>(def.envKey);
    const parsed = parseFlagValue(raw);
    return parsed === undefined ? def.default : parsed;
  }

  /** Resolve every flag to its effective boolean (handy for a status view). */
  all(): Record<FeatureFlag, boolean> {
    const out = {} as Record<FeatureFlag, boolean>;
    for (const flag of ALL_FEATURE_FLAGS) {
      out[flag] = this.isEnabled(flag);
    }
    return out;
  }
}
