import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { randomBytes, createHash } from 'crypto';
import { Group, GroupMember, PublicShare, User } from '@finmate/data-models';
import {
  CreatePublicShareDto,
  PublicShareSecretResponse,
  PublicShareStatusResponse,
} from './dto';

/**
 * PUBLIC-1B — owner/admin management of a group's PUBLIC read-only share.
 *
 * Capability-secret discipline: the raw token is generated from
 * `crypto.randomBytes(32)` (256-bit), base64url-encoded, and returned to the
 * creator EXACTLY ONCE (create/regenerate). Only its `sha256` hex is persisted
 * (`token_hash`) — the raw token is never stored, never logged, never returned by
 * status, and never placed in an error. No new crypto package.
 *
 * Authorization reuses the established group governance convention: an ACTIVE
 * member is required (non-members are denied) and only `owner`/`admin` may manage
 * sharing (plain members/viewers cannot). `groupId` comes from the route only.
 *
 * Concurrency / one-active-share: create/regenerate/revoke run in a transaction
 * that first takes a `pessimistic_write` lock on the group row, serializing
 * mutations for that group. This guarantees at most one ACTIVE share per group
 * WITHOUT any schema/constraint change to PUBLIC-1A. Regeneration atomically
 * revokes the previous capability and issues a new one; the old token is unusable
 * the instant the transaction commits.
 *
 * FIN-002 is unaffected: this service never reads or writes the ledger, never
 * decrypts E2EE data, and exposes no finance/member content.
 */
@Injectable()
export class PublicSharesService {
  constructor(
    @InjectRepository(PublicShare)
    private readonly publicShareRepository: Repository<PublicShare>,
    @InjectRepository(GroupMember)
    private readonly groupMemberRepository: Repository<GroupMember>,
    private readonly dataSource: DataSource,
  ) {}

  /** Reuse the group governance convention: active member + owner/admin only. */
  private async assertOwnerOrAdmin(
    userId: string,
    groupId: string,
  ): Promise<void> {
    const membership = await this.groupMemberRepository.findOne({
      where: {
        group: { id: groupId },
        user: { id: userId },
        joinStatus: 'active',
      },
    });
    if (!membership) {
      // Non-member (or inactive) — do not disclose anything about the group.
      throw new ForbiddenException('You do not have access to this group');
    }
    if (membership.role !== 'owner' && membership.role !== 'admin') {
      throw new ForbiddenException({
        errorCode: 'RES_FORBIDDEN',
        message: 'Only group owners and admins can manage public sharing',
      });
    }
  }

  /** New 256-bit capability token + its sha256 hex (only the hash is stored). */
  private generateToken(): { raw: string; hash: string } {
    const raw = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(raw).digest('hex');
    return { raw, hash };
  }

  /** A share is usable only while `active` AND not past its optional expiry. */
  private isActive(share: PublicShare): boolean {
    if (share.status !== 'active') return false;
    return !share.expiresAt || new Date(share.expiresAt).getTime() > Date.now();
  }

  /** Validate an optional expiry — reject an invalid or past timestamp. */
  private validateExpiry(expiresAt?: string): Date | null {
    if (!expiresAt) return null;
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'expiresAt must be a valid future date',
      });
    }
    return d;
  }

  /** Serialize mutations for a group by locking its row (no schema change needed). */
  private async lockGroup(
    manager: EntityManager,
    groupId: string,
  ): Promise<void> {
    await manager
      .createQueryBuilder(Group, 'g')
      .setLock('pessimistic_write')
      .where('g.id = :groupId', { groupId })
      .getOne();
  }

  /** Revoke every currently-ACTIVE share for the group; returns how many. */
  private async revokeActive(
    manager: EntityManager,
    groupId: string,
  ): Promise<number> {
    const repo = manager.getRepository(PublicShare);
    const actives = await repo.find({
      where: { group: { id: groupId }, status: 'active' },
    });
    const now = new Date();
    for (const share of actives) {
      share.status = 'revoked';
      share.revokedAt = now;
      await repo.save(share);
    }
    return actives.length;
  }

  private toSecret(raw: string, share: PublicShare): PublicShareSecretResponse {
    return {
      token: raw,
      status: 'active',
      expiresAt: share.expiresAt
        ? new Date(share.expiresAt).toISOString()
        : null,
      createdAt: share.createdAt,
      revokedAt: share.revokedAt ?? null,
    };
  }

  /**
   * Create the group's public share. Owner/admin only. Rejects if an active
   * share already exists (never silently issues a second capability — the owner
   * must revoke or regenerate). Returns the raw token exactly once.
   */
  async create(
    userId: string,
    groupId: string,
    dto: CreatePublicShareDto,
  ): Promise<PublicShareSecretResponse> {
    await this.assertOwnerOrAdmin(userId, groupId);
    const expiresAt = this.validateExpiry(dto.expiresAt);

    return this.dataSource.transaction(async (manager) => {
      await this.lockGroup(manager, groupId);
      const repo = manager.getRepository(PublicShare);
      const existing = await repo.find({
        where: { group: { id: groupId }, status: 'active' },
      });
      if (existing.some((s) => this.isActive(s))) {
        throw new ConflictException({
          errorCode: 'RES_ALREADY_EXISTS',
          message:
            'A public share is already active for this group. Revoke it or regenerate the link.',
        });
      }
      const { raw, hash } = this.generateToken();
      const saved = await repo.save(
        repo.create({
          group: { id: groupId } as Group,
          createdByUser: { id: userId } as User,
          tokenHash: hash,
          status: 'active',
          expiresAt,
        }),
      );
      return this.toSecret(raw, saved);
    });
  }

  /**
   * Atomically regenerate: revoke the previous capability and issue a new one in
   * a single transaction under the group lock, so two concurrent regenerations
   * can never leave multiple usable tokens. Returns the new raw token once.
   */
  async regenerate(
    userId: string,
    groupId: string,
    dto: CreatePublicShareDto,
  ): Promise<PublicShareSecretResponse> {
    await this.assertOwnerOrAdmin(userId, groupId);
    const expiresAt = this.validateExpiry(dto.expiresAt);

    return this.dataSource.transaction(async (manager) => {
      await this.lockGroup(manager, groupId);
      await this.revokeActive(manager, groupId);
      const repo = manager.getRepository(PublicShare);
      const { raw, hash } = this.generateToken();
      const saved = await repo.save(
        repo.create({
          group: { id: groupId } as Group,
          createdByUser: { id: userId } as User,
          tokenHash: hash,
          status: 'active',
          expiresAt,
        }),
      );
      return this.toSecret(raw, saved);
    });
  }

  /**
   * Revoke the group's active share immediately. Idempotent: revoking when there
   * is no active share is a safe no-op (`revoked: false`).
   */
  async revoke(userId: string, groupId: string): Promise<{ revoked: boolean }> {
    await this.assertOwnerOrAdmin(userId, groupId);
    return this.dataSource.transaction(async (manager) => {
      await this.lockGroup(manager, groupId);
      const count = await this.revokeActive(manager, groupId);
      return { revoked: count > 0 };
    });
  }

  /**
   * Owner/admin sharing status. NEVER returns the raw token or the token hash.
   * Reports the latest share's state (active accounts for expiry) or `shared:
   * false` when the group was never shared.
   */
  async getStatus(
    userId: string,
    groupId: string,
  ): Promise<PublicShareStatusResponse> {
    await this.assertOwnerOrAdmin(userId, groupId);
    const latest = await this.publicShareRepository.findOne({
      where: { group: { id: groupId } },
      order: { createdAt: 'DESC' },
    });
    if (!latest) {
      return {
        active: false,
        status: null,
        expiresAt: null,
        createdAt: null,
        revokedAt: null,
      };
    }
    return {
      active: this.isActive(latest),
      status: latest.status,
      expiresAt: latest.expiresAt
        ? new Date(latest.expiresAt).toISOString()
        : null,
      createdAt: latest.createdAt,
      revokedAt: latest.revokedAt ?? null,
    };
  }
}
