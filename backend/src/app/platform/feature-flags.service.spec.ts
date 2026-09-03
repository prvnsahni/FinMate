import { FeatureFlagsService } from './feature-flags.service';
import { ALL_FEATURE_FLAGS, parseFlagValue } from './feature-flags.constants';
import { ConfigService } from '@nestjs/config';

const configWith = (values: Record<string, string>): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('FeatureFlagsService (W-PLAT-01)', () => {
  it('returns the safe default (OFF) for every flag when nothing is configured', () => {
    const svc = new FeatureFlagsService();
    for (const flag of ALL_FEATURE_FLAGS) {
      expect(svc.isEnabled(flag)).toBe(false);
    }
  });

  it('an env override turns a flag ON', () => {
    const svc = new FeatureFlagsService(
      configWith({ FEATURE_AI_FIREWALL: 'true' }),
    );
    expect(svc.isEnabled('ai.firewall')).toBe(true);
    // unrelated flags stay at their default
    expect(svc.isEnabled('feature.goals')).toBe(false);
  });

  it('an env override can force a flag OFF', () => {
    const svc = new FeatureFlagsService(configWith({ FEATURE_GOALS: 'false' }));
    expect(svc.isEnabled('feature.goals')).toBe(false);
  });

  it('unparseable env values fall back to the default', () => {
    const svc = new FeatureFlagsService(
      configWith({ FEATURE_AI_FIREWALL: 'maybe' }),
    );
    expect(svc.isEnabled('ai.firewall')).toBe(false);
  });

  it('all() resolves every registered flag', () => {
    const svc = new FeatureFlagsService(
      configWith({ FEATURE_NOTIFICATIONS_IN_APP: '1' }),
    );
    const all = svc.all();
    expect(Object.keys(all).sort()).toEqual([...ALL_FEATURE_FLAGS].sort());
    expect(all['notifications.inApp']).toBe(true);
    expect(all['ai.firewall']).toBe(false);
  });

  describe('parseFlagValue', () => {
    it('maps truthy/falsy strings and passes through booleans', () => {
      for (const v of ['true', '1', 'on', 'yes', 'TRUE']) {
        expect(parseFlagValue(v)).toBe(true);
      }
      for (const v of ['false', '0', 'off', 'no', 'FALSE']) {
        expect(parseFlagValue(v)).toBe(false);
      }
      expect(parseFlagValue(true)).toBe(true);
      expect(parseFlagValue(false)).toBe(false);
    });

    it('returns undefined for unset/blank/unrecognized', () => {
      expect(parseFlagValue(undefined)).toBeUndefined();
      expect(parseFlagValue(null)).toBeUndefined();
      expect(parseFlagValue('')).toBeUndefined();
      expect(parseFlagValue('enabled?')).toBeUndefined();
    });
  });
});
