import { NotFoundException } from '@nestjs/common';
import { GoalsEnabledGuard } from './goals-enabled.guard';

describe('GoalsEnabledGuard (feature.goals)', () => {
  const ctx = {} as any;

  it('allows the request when the flag is ON', () => {
    const guard = new GoalsEnabledGuard({
      isEnabled: () => true,
    } as any);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('404s (feature inert) when the flag is OFF', () => {
    const guard = new GoalsEnabledGuard({
      isEnabled: () => false,
    } as any);
    expect(() => guard.canActivate(ctx)).toThrow(NotFoundException);
  });
});
