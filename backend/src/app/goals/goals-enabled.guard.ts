import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FeatureFlagsService } from '../platform/feature-flags.service';

/**
 * Gates the whole Goals surface behind the `feature.goals` flag (BATCH-04,
 * default OFF). When OFF, every Goals route responds 404 — the feature is inert
 * and not exposed. Runs at the class level, before the per-route recovery guard.
 */
@Injectable()
export class GoalsEnabledGuard implements CanActivate {
  constructor(private readonly flags: FeatureFlagsService) {}

  canActivate(_context: ExecutionContext): boolean {
    if (!this.flags.isEnabled('feature.goals')) {
      throw new NotFoundException('Goals feature is not available');
    }
    return true;
  }
}
