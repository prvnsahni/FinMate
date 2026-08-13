import { Global, Module } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { ObservabilityService } from './observability.service';

/**
 * Platform foundation (BATCH-04 / W-PLAT-01 + W-PLAT-02): feature flags and a
 * secret-free observability emitter. Global so any later batch can inject these
 * without re-importing. Providers are side-effect-free at boot.
 */
@Global()
@Module({
  providers: [FeatureFlagsService, ObservabilityService],
  exports: [FeatureFlagsService, ObservabilityService],
})
export class PlatformModule {}
