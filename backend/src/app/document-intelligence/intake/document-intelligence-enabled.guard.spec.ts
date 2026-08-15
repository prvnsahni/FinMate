import { NotFoundException } from '@nestjs/common';
import { DocumentIntelligenceEnabledGuard } from './document-intelligence-enabled.guard';
import { FeatureFlagsService } from '../../platform/feature-flags.service';

describe('DocumentIntelligenceEnabledGuard', () => {
  const guardWith = (enabled: boolean) => {
    const flags = { isEnabled: jest.fn().mockReturnValue(enabled) } as unknown as FeatureFlagsService;
    return { guard: new DocumentIntelligenceEnabledGuard(flags), flags };
  };

  it('allows when document.intelligence is ON', () => {
    const { guard, flags } = guardWith(true);
    expect(guard.canActivate()).toBe(true);
    expect(flags.isEnabled).toHaveBeenCalledWith('document.intelligence');
  });

  it('404s (feature inert) when OFF — default OFF keeps the unfinished itemized workflow hidden', () => {
    const { guard } = guardWith(false);
    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });
});
