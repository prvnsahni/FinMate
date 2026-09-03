import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { FeatureFlagsService } from '../../platform/feature-flags.service';

/**
 * Gates the whole Document Intelligence intake surface behind the
 * `document.intelligence` flag (default OFF). When OFF, every route responds 404 —
 * the (still incomplete, extraction-less) feature is inert and not exposed. Mirrors
 * GoalsEnabledGuard.
 */
@Injectable()
export class DocumentIntelligenceEnabledGuard implements CanActivate {
  constructor(private readonly flags: FeatureFlagsService) {}

  canActivate(): boolean {
    if (!this.flags.isEnabled('document.intelligence')) {
      throw new NotFoundException(
        'Document intelligence feature is not available',
      );
    }
    return true;
  }
}
