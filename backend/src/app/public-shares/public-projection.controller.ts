import { Controller, Get, Param, Res } from '@nestjs/common';
import { SuccessResponse } from '../common/response.util';
import { ThrottleAs } from '../throttler/throttle-policy.decorator';
import { THROTTLE_PROFILES } from '../throttler/throttle.constants';
import { PublicProjectionService } from './public-projection.service';

/** Minimal shape of the response object we touch (Express `Response`). */
interface HeaderSettableResponse {
  setHeader(name: string, value: string): void;
}

/**
 * PUBLIC-1C — the ANONYMOUS public group-ledger endpoint.
 *
 * Intentionally has NO `JwtAuthGuard`: access is a capability (the token in the
 * path), not an identity. It is the first anonymous data-bearing route, so it is
 * strictly rate-limited (`PUBLIC_SHARE` profile, per-IP). The token is resolved
 * only in-memory; the raw token/hash is never returned and — via the PUBLIC-1C-PRE
 * `redactUrl` hardening — never logged. Every unavailable case returns a generic
 * 404 (no group/expense/member/user ids, no E2EE, no PII in the payload).
 *
 * PUBLIC-1G — a shared ledger is REVOCABLE, so its response must never be cached
 * anywhere (browser/back-forward/CDN); a stale copy could outlive a revoke/
 * regenerate/expiry. `Cache-Control: no-store` is set on the response BEFORE the
 * lookup, so it applies to BOTH the 200 projection and the generic 404 (the
 * exception filter writes the error via `response.send()`, preserving the header
 * already set here). No ETag/Last-Modified, no caching layer, no CDN change.
 */
@Controller('public/shares')
@ThrottleAs(THROTTLE_PROFILES.PUBLIC_SHARE)
export class PublicProjectionController {
  constructor(private readonly projection: PublicProjectionService) {}

  /** Resolve the read-only public ledger for a capability token, or generic 404. */
  @Get(':token')
  async getLedger(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: HeaderSettableResponse,
  ) {
    // Set before the (possibly throwing) lookup so it is present on success AND
    // on the generic-404 error path.
    res.setHeader('Cache-Control', 'no-store');
    const ledger = await this.projection.getPublicLedger(token);
    return new SuccessResponse('Public ledger retrieved', ledger);
  }
}
