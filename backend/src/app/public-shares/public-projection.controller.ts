import { Controller, Get, Param } from '@nestjs/common';
import { SuccessResponse } from '../common/response.util';
import { ThrottleAs } from '../throttler/throttle-policy.decorator';
import { THROTTLE_PROFILES } from '../throttler/throttle.constants';
import { PublicProjectionService } from './public-projection.service';

/**
 * PUBLIC-1C — the ANONYMOUS public group-ledger endpoint.
 *
 * Intentionally has NO `JwtAuthGuard`: access is a capability (the token in the
 * path), not an identity. It is the first anonymous data-bearing route, so it is
 * strictly rate-limited (`PUBLIC_SHARE` profile, per-IP). The token is resolved
 * only in-memory; the raw token/hash is never returned and — via the PUBLIC-1C-PRE
 * `redactUrl` hardening — never logged. Every unavailable case returns a generic
 * 404 (no group/expense/member/user ids, no E2EE, no PII in the payload).
 */
@Controller('public/shares')
@ThrottleAs(THROTTLE_PROFILES.PUBLIC_SHARE)
export class PublicProjectionController {
  constructor(private readonly projection: PublicProjectionService) {}

  /** Resolve the read-only public ledger for a capability token, or generic 404. */
  @Get(':token')
  async getLedger(@Param('token') token: string) {
    const ledger = await this.projection.getPublicLedger(token);
    return new SuccessResponse('Public ledger retrieved', ledger);
  }
}
