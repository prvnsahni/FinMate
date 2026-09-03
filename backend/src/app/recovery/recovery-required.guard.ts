import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { RecoveryStatusService } from './recovery-status.service';

/**
 * REC-1 guard for endpoints that establish new Class-A E2EE key material. Runs
 * AFTER `JwtAuthGuard` (which populates `req.user`) and rejects with
 * 409 REC_RECOVERY_REQUIRED when the authenticated user has no recovery material.
 * Server-authoritative: re-reads committed state per request, so a client that
 * skips the pre-check can never bypass it, and a write racing recovery setup is
 * evaluated against the committed recovery state.
 */
@Injectable()
export class RecoveryRequiredGuard implements CanActivate {
  constructor(private readonly recovery: RecoveryStatusService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    await this.recovery.assertConfigured(req.user?.id);
    return true;
  }
}
