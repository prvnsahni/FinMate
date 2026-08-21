import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CustomTag,
  Group,
  GroupKeyVersion,
  GroupMember,
  User,
} from '@finmate/data-models';
import {
  CreateGroupCustomTagDto,
  CreatePersonalCustomTagDto,
  UpdateCustomTagDto,
} from './dto';

/**
 * Server-safe projection of a custom tag. Deliberately excludes the related
 * `ownerUser`/`createdByUser`/`group` entities (which carry sensitive account
 * fields) — the only name material returned is the opaque `encryptedName` the
 * client itself produced.
 */
export interface CustomTagResponse {
  id: string;
  scopeType: 'personal' | 'group';
  encryptedName: string;
  status: 'active' | 'deprecated';
  version: number;
  groupId: string | null;
  groupKeyVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * TAG-BATCH-C2 — CRUD + authorization for personal and group custom-tag
 * DEFINITIONS (the naming layer added in C1). Assignments continue to live in
 * `expense_tags`; the global canonical taxonomy stays code-curated and is NOT
 * reachable here.
 *
 * E2EE boundary (per C0/C1): the tag name is handled ONLY as the client's
 * opaque `encryptedName` ciphertext. This service never decrypts, normalizes,
 * hashes, searches, or logs it — de-duplication is a client concern. The server
 * authorizes purely on ownership (personal) / active membership (group) + the
 * opaque id.
 */
@Injectable()
export class CustomTagsService {
  constructor(
    @InjectRepository(CustomTag)
    private readonly customTagRepository: Repository<CustomTag>,
    @InjectRepository(GroupMember)
    private readonly groupMemberRepository: Repository<GroupMember>,
    @InjectRepository(GroupKeyVersion)
    private readonly groupKeyVersionRepository: Repository<GroupKeyVersion>,
  ) {}

  /** Map an entity to the server-safe projection (never leaks related accounts). */
  private toResponse(tag: CustomTag): CustomTagResponse {
    return {
      id: tag.id,
      scopeType: tag.scopeType,
      encryptedName: tag.encryptedName,
      status: tag.status,
      version: tag.version,
      groupId: tag.group?.id ?? null,
      groupKeyVersionId: tag.groupKeyVersion?.id ?? null,
      createdAt: tag.createdAt,
      updatedAt: tag.updatedAt,
    };
  }

  /** Throws unless the user is an ACTIVE member of the group (group-scope authz). */
  private async assertActiveMembership(
    userId: string,
    groupId: string,
  ): Promise<GroupMember> {
    const membership = await this.groupMemberRepository.findOne({
      where: {
        group: { id: groupId },
        user: { id: userId },
        joinStatus: 'active',
      },
    });
    if (!membership) {
      throw new ForbiddenException('You do not have access to this group');
    }
    return membership;
  }

  /**
   * Resolves the group-key version to stamp on a group tag. A declared id must
   * belong to the group and not be REVOKED; otherwise the group's current
   * ACTIVE version is used. Mirrors the expense/recurring key-version discipline
   * and invents no new group-key flow.
   */
  private async resolveGroupKeyVersion(
    groupId: string,
    declaredVersionId: string | undefined,
  ): Promise<GroupKeyVersion> {
    if (declaredVersionId) {
      const declared = await this.groupKeyVersionRepository.findOne({
        where: { id: declaredVersionId, group: { id: groupId } },
      });
      if (!declared || declared.status === 'REVOKED') {
        throw new BadRequestException({
          errorCode: 'VAL_INVALID_INPUT',
          message:
            'groupKeyVersionId must reference a usable key version of the selected group',
        });
      }
      return declared;
    }

    const active = await this.groupKeyVersionRepository.findOne({
      where: { group: { id: groupId }, status: 'ACTIVE' },
      order: { version: 'DESC' },
    });
    if (!active) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'The group has no active key version for tag encryption',
      });
    }
    return active;
  }

  // ─── PERSONAL ──────────────────────────────────────────────────────────────

  /**
   * Creates a personal custom tag owned by the authenticated user. Scope and
   * owner are server-derived, never taken from the body.
   * @param userId authenticated user id
   * @param dto opaque encrypted name only
   */
  async createPersonal(
    userId: string,
    dto: CreatePersonalCustomTagDto,
  ): Promise<CustomTagResponse> {
    const tag = this.customTagRepository.create({
      scopeType: 'personal',
      ownerUser: { id: userId } as User,
      createdByUser: { id: userId } as User,
      encryptedName: dto.encryptedName,
      status: 'active',
    });
    const saved = await this.customTagRepository.save(tag);
    return this.toResponse(saved);
  }

  /**
   * Lists the authenticated user's own ACTIVE personal custom tags. Never
   * returns another user's tags or the canonical taxonomy.
   * @param userId authenticated user id
   */
  async listPersonal(userId: string): Promise<CustomTagResponse[]> {
    const tags = await this.customTagRepository.find({
      where: {
        scopeType: 'personal',
        status: 'active',
        ownerUser: { id: userId },
      },
      order: { createdAt: 'DESC' },
    });
    return tags.map((t) => this.toResponse(t));
  }

  // ─── GROUP ───────────────────────────────────────────────────────────────

  /**
   * Creates a group custom tag. Requires ACTIVE membership; the scope and group
   * come from the route. Records the resolved group-key version for SEC-KI1
   * version discipline.
   * @param userId authenticated user id
   * @param groupId target group id
   * @param dto opaque encrypted name + optional groupKeyVersionId
   */
  async createGroup(
    userId: string,
    groupId: string,
    dto: CreateGroupCustomTagDto,
  ): Promise<CustomTagResponse> {
    await this.assertActiveMembership(userId, groupId);
    const groupKeyVersion = await this.resolveGroupKeyVersion(
      groupId,
      dto.groupKeyVersionId,
    );

    const tag = this.customTagRepository.create({
      scopeType: 'group',
      group: { id: groupId } as Group,
      groupKeyVersion,
      createdByUser: { id: userId } as User,
      encryptedName: dto.encryptedName,
      status: 'active',
    });
    const saved = await this.customTagRepository.save(tag);
    return this.toResponse(saved);
  }

  /**
   * Lists a group's ACTIVE custom tags. Requires ACTIVE membership.
   * @param userId authenticated user id
   * @param groupId target group id
   */
  async listGroup(
    userId: string,
    groupId: string,
  ): Promise<CustomTagResponse[]> {
    await this.assertActiveMembership(userId, groupId);
    const tags = await this.customTagRepository.find({
      where: {
        scopeType: 'group',
        status: 'active',
        group: { id: groupId },
      },
      order: { createdAt: 'DESC' },
      relations: ['group', 'groupKeyVersion'],
    });
    return tags.map((t) => this.toResponse(t));
  }

  // ─── UPDATE / DEPRECATE (by id, both scopes) ───────────────────────────────

  /**
   * Loads a tag by id and authorizes the caller for it. To prevent existence
   * disclosure via id enumeration (IDOR), any authorization failure on the
   * by-id path surfaces as `NotFoundException` — a non-owner/non-member cannot
   * distinguish "does not exist" from "not yours".
   */
  private async loadAuthorizedTag(
    userId: string,
    id: string,
  ): Promise<CustomTag> {
    const tag = await this.customTagRepository.findOne({
      where: { id },
      relations: ['ownerUser', 'group', 'groupKeyVersion'],
    });
    if (!tag) {
      throw new NotFoundException('Custom tag not found');
    }

    if (tag.scopeType === 'personal') {
      if (tag.ownerUser?.id !== userId) {
        throw new NotFoundException('Custom tag not found');
      }
    } else {
      const groupId = tag.group?.id;
      const membership = groupId
        ? await this.groupMemberRepository.findOne({
            where: {
              group: { id: groupId },
              user: { id: userId },
              joinStatus: 'active',
            },
          })
        : null;
      if (!membership) {
        throw new NotFoundException('Custom tag not found');
      }
    }

    return tag;
  }

  /**
   * Renames a custom tag (personal or group) by replacing its opaque encrypted
   * payload. The server never inspects the name. Optimistic-lock protected via
   * `version` (`CON_VERSION_CONFLICT`).
   * @param userId authenticated user id
   * @param id custom tag id
   * @param dto new encrypted name, last-seen version, optional groupKeyVersionId
   */
  async rename(
    userId: string,
    id: string,
    dto: UpdateCustomTagDto,
  ): Promise<CustomTagResponse> {
    const tag = await this.loadAuthorizedTag(userId, id);

    if (tag.version !== dto.version) {
      throw new PreconditionFailedException({
        errorCode: 'CON_VERSION_CONFLICT',
        message:
          'Version conflict: the resource has been modified by another request',
      });
    }

    tag.encryptedName = dto.encryptedName;

    // Group rename may carry a fresh key-version stamp (e.g. re-encrypted after
    // a rotation). Reuse the existing version discipline; personal tags ignore it.
    if (tag.scopeType === 'group' && dto.groupKeyVersionId && tag.group) {
      tag.groupKeyVersion = await this.resolveGroupKeyVersion(
        tag.group.id,
        dto.groupKeyVersionId,
      );
    }

    const saved = await this.customTagRepository.save(tag);
    return this.toResponse(saved);
  }

  /**
   * Deprecates a custom tag: it disappears from the ACTIVE lists but is NOT
   * physically removed, so historical `expense_tags` assignments stay
   * resolvable and no financial record is touched. Idempotent.
   * @param userId authenticated user id
   * @param id custom tag id
   */
  async deprecate(userId: string, id: string): Promise<CustomTagResponse> {
    const tag = await this.loadAuthorizedTag(userId, id);
    if (tag.status !== 'deprecated') {
      tag.status = 'deprecated';
      const saved = await this.customTagRepository.save(tag);
      return this.toResponse(saved);
    }
    return this.toResponse(tag);
  }
}
