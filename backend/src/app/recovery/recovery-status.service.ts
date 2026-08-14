import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@finmate/data-models';

/** errorCode returned when a Class-A E2EE write is attempted without recovery. */
export const REC_RECOVERY_REQUIRED = 'REC_RECOVERY_REQUIRED';

/**
 * Server-authoritative REC-1 check: recovery material must exist before new
 * Class-A E2EE data/key-material is established. Reads the authoritative
 * `User.recoveryWrappedKey` on every call (never a cached/client value). It is
 * read-only and zero-knowledge — it only inspects PRESENCE and never returns or
 * logs the recovery blob.
 */
@Injectable()
export class RecoveryStatusService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** True iff the user has recovery material configured. */
  async isConfigured(userId: string): Promise<boolean> {
    if (!userId) return false;
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: { id: true, recoveryWrappedKey: true },
    });
    return !!user?.recoveryWrappedKey;
  }

  /**
   * Throws 409 REC_RECOVERY_REQUIRED unless recovery is configured. Use before
   * establishing any new Class-A E2EE key material.
   */
  async assertConfigured(userId: string): Promise<void> {
    if (await this.isConfigured(userId)) return;
    throw new ConflictException({
      errorCode: REC_RECOVERY_REQUIRED,
      message:
        'Set up account recovery before creating new end-to-end encrypted data. ' +
        'Without recovery, this data could not be restored if you lose your password.',
    });
  }
}
