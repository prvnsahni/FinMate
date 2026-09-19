import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  RecurringExpense,
  RecurringExpenseSplit,
  Expense,
  ExpenseSplit,
  Group,
  GroupKeyVersion,
  GroupMember,
  User,
  CURRENCY_MINOR_UNITS,
  CreateRecurringExpenseDto,
  isSupportedCurrencyCode,
  normalizeCurrencyCode,
  UpdateRecurringExpenseDto,
} from '@finmate/data-models';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { calculateDeterministicSplits } from '../split-calculator.util';
import { RecurringExpensesScheduler } from './recurring-expenses.scheduler';

@Injectable()
export class RecurringExpensesService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(RecurringExpense)
    private readonly recurringExpenseRepository: Repository<RecurringExpense>,
    @InjectRepository(RecurringExpenseSplit)
    private readonly recurringExpenseSplitRepository: Repository<RecurringExpenseSplit>,
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(GroupMember)
    private readonly groupMemberRepository: Repository<GroupMember>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    // Reused so the create path and the daily cron share one generation
    // routine — immediate and scheduled occurrences are byte-for-byte identical.
    private readonly scheduler: RecurringExpensesScheduler,
  ) {}

  /** Server's notion of "today" (UTC), identical to the scheduler's. */
  private todayStr(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private async getGroupMembership(
    userId: string,
    groupId: string,
  ): Promise<GroupMember | null> {
    return this.groupMemberRepository.findOne({
      where: {
        group: { id: groupId },
        user: { id: userId },
        joinStatus: In(['active', 'invited']),
      },
      relations: ['user', 'group'],
    });
  }

  private async ensureAccess(
    userId: string,
    template: RecurringExpense,
    write = false,
  ): Promise<void> {
    if (!template.group) {
      if (template.ownerUser.id !== userId) {
        throw new ForbiddenException(
          'You do not have access to this recurring expense',
        );
      }
      return;
    }

    const membership = await this.getGroupMembership(userId, template.group.id);
    if (!membership) {
      throw new ForbiddenException(
        'You do not have access to this recurring expense',
      );
    }

    if (write) {
      if (membership.joinStatus !== 'active') {
        throw new ForbiddenException('You must accept the invitation first');
      }
      if (membership.role === 'viewer') {
        throw new ForbiddenException(
          'Viewers cannot modify recurring expenses',
        );
      }
      if (membership.role === 'member' || membership.role === 'spectator') {
        const paidByCaller =
          template.paidByUser?.id === userId ||
          template.paidByGroupMember?.user?.id === userId;
        if (template.ownerUser.id !== userId && !paidByCaller) {
          throw new ForbiddenException(
            'Members can only modify their own recurring expenses',
          );
        }
      }
    }
  }

  private async buildGroupParticipantMaps(
    groupId: string,
    manager: EntityManager,
  ): Promise<{
    groupMemberById: Map<string, GroupMember>;
    activeOrInvitedByUserId: Map<string, GroupMember>;
  }> {
    const members = await manager.getRepository(GroupMember).find({
      where: { group: { id: groupId }, joinStatus: In(['active', 'invited']) },
      relations: ['user'],
    });

    const groupMemberById = new Map<string, GroupMember>();
    const activeOrInvitedByUserId = new Map<string, GroupMember>();

    for (const member of members) {
      groupMemberById.set(member.id, member);
      // A pending (Contact-backed) member has no user and is only ever
      // resolvable via groupMemberById (participantGroupMemberId).
      if (member.user) {
        activeOrInvitedByUserId.set(member.user.id, member);
      }
    }

    return { groupMemberById, activeOrInvitedByUserId };
  }

  private async persistSplits(
    template: RecurringExpense,
    dto: Pick<
      CreateRecurringExpenseDto,
      | 'splits'
      | 'amountTotal'
      | 'paidByUserId'
      | 'paidByGroupMemberId'
      | 'groupId'
    >,
    manager: EntityManager,
  ): Promise<void> {
    const payerKey = dto.groupId
      ? (dto.paidByGroupMemberId ??
        (
          await manager.getRepository(GroupMember).findOne({
            where: {
              group: { id: dto.groupId },
              user: { id: dto.paidByUserId },
              joinStatus: In(['active', 'invited']),
            },
          })
        )?.id)
      : dto.paidByUserId;

    const calculated = calculateDeterministicSplits(
      dto.amountTotal,
      dto.splits as any,
      payerKey,
    );

    if (!dto.groupId) {
      const participantIds = [
        ...new Set(dto.splits.map((split) => split.participantUserId || '')),
      ].filter(Boolean);
      const users = await manager
        .getRepository(User)
        .find({ where: { id: In(participantIds) } });
      const userMap = new Map(users.map((u) => [u.id, u]));

      for (const split of calculated) {
        const participantUser = split.participantUserId
          ? userMap.get(split.participantUserId)
          : undefined;
        if (!participantUser) {
          throw new BadRequestException({
            errorCode: 'VAL_INVALID_INPUT',
            message:
              'Personal recurring expense participants must be valid users',
          });
        }

        await manager.getRepository(RecurringExpenseSplit).save(
          manager.getRepository(RecurringExpenseSplit).create({
            recurringExpense: template,
            participantUser,
            splitType: split.splitType,
            shareValue: split.shareValue,
            amountOwed: split.amountOwed,
          }),
        );
      }
      return;
    }

    const { groupMemberById, activeOrInvitedByUserId } =
      await this.buildGroupParticipantMaps(dto.groupId, manager);

    for (const split of calculated) {
      const participantGroupMember = split.participantGroupMemberId
        ? groupMemberById.get(split.participantGroupMemberId)
        : undefined;
      const participantByUser = split.participantUserId
        ? activeOrInvitedByUserId.get(split.participantUserId)
        : undefined;

      const resolvedMember = participantGroupMember || participantByUser;

      if (!resolvedMember) {
        throw new BadRequestException({
          errorCode: 'VAL_INVALID_INPUT',
          message: 'Each split participant must belong to the selected group',
        });
      }

      if (resolvedMember.role === 'spectator') {
        throw new BadRequestException({
          errorCode: 'EXP_SPECTATOR_SPLIT',
          message: 'Spectators cannot be included in splits',
        });
      }

      await manager.getRepository(RecurringExpenseSplit).save(
        manager.getRepository(RecurringExpenseSplit).create({
          recurringExpense: template,
          participantGroupMember: resolvedMember,
          splitType: split.splitType,
          shareValue: split.shareValue,
          amountOwed: split.amountOwed,
        }),
      );
    }
  }

  /**
   * Resolves the key version to stamp on a template. A declared version must
   * belong to the group and not be REVOKED (the stamp records the version the
   * ciphertext was actually produced with); otherwise falls back to ACTIVE.
   */
  private async resolveTemplateGroupKeyVersion(
    group: Group,
    declaredVersionId: string | undefined,
    manager: EntityManager,
  ): Promise<GroupKeyVersion> {
    if (declaredVersionId) {
      const declared = await manager.getRepository(GroupKeyVersion).findOne({
        where: { id: declaredVersionId, group: { id: group.id } },
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

    const active = await manager.getRepository(GroupKeyVersion).findOne({
      where: { group: { id: group.id }, status: 'ACTIVE' },
      order: { version: 'DESC' },
    });
    if (active) {
      return active;
    }
    return manager.getRepository(GroupKeyVersion).save(
      manager.getRepository(GroupKeyVersion).create({
        group,
        version: 1,
        algorithm: 'AES-256-GCM',
        status: 'ACTIVE',
      }),
    );
  }

  async createRecurringExpense(
    userId: string,
    dto: CreateRecurringExpenseDto,
  ): Promise<Record<string, any>> {
    const normalizedCurrency = normalizeCurrencyCode(dto.currency);
    const minorUnits = CURRENCY_MINOR_UNITS[normalizedCurrency];
    if (!isSupportedCurrencyCode(normalizedCurrency) || minorUnits !== 2) {
      throw new BadRequestException({
        errorCode: 'CURRENCY_UNSUPPORTED',
        message: `Currency ${normalizedCurrency} is not supported for ledger writes`,
      });
    }

    if (!dto.splits || dto.splits.length === 0) {
      throw new BadRequestException('Splits cannot be empty');
    }

    if (!dto.paidByUserId && !dto.paidByGroupMemberId) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'Provide paidByUserId or paidByGroupMemberId',
      });
    }
    if (dto.paidByUserId && dto.paidByGroupMemberId) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'Provide only one of paidByUserId or paidByGroupMemberId',
      });
    }
    if (dto.paidByGroupMemberId && !dto.groupId) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message:
          'paidByGroupMemberId is only valid for group recurring expenses',
      });
    }

    const ownerUser = await this.userRepository.findOne({
      where: { id: userId },
    });
    if (!ownerUser) {
      throw new NotFoundException('User not found');
    }

    let group: Group | undefined;
    if (dto.groupId) {
      const membership = await this.getGroupMembership(userId, dto.groupId);
      if (
        !membership ||
        membership.joinStatus !== 'active' ||
        membership.role === 'viewer'
      ) {
        throw new ForbiddenException('No write access to this group');
      }
      group = await this.groupRepository.findOne({
        where: { id: dto.groupId },
      });
      if (!group) {
        throw new NotFoundException('Group not found');
      }
      if (
        group.currency &&
        normalizedCurrency !== group.currency.toUpperCase()
      ) {
        throw new BadRequestException({
          errorCode: 'EXP_CURRENCY_MISMATCH',
          message: `Expense currency must match the group's base currency (${group.currency})`,
        });
      }
    }

    let paidByUser: User | undefined;
    let paidByGroupMember: GroupMember | undefined;

    if (group) {
      // Frozen rule: inside a group ledger, the payer always resolves to
      // GroupMember, never User — paidByUserId is accepted as client
      // convenience and resolved to its GroupMember row here.
      if (dto.paidByGroupMemberId) {
        paidByGroupMember =
          (await this.groupMemberRepository.findOne({
            where: {
              id: dto.paidByGroupMemberId,
              group: { id: group.id },
              joinStatus: In(['active', 'invited']),
            },
          })) ?? undefined;
        if (!paidByGroupMember) {
          throw new BadRequestException({
            errorCode: 'VAL_INVALID_INPUT',
            message: 'paidByGroupMemberId must belong to the selected group',
          });
        }
      } else {
        const payerInGroup = await this.groupMemberRepository.findOne({
          where: {
            group: { id: group.id },
            user: { id: dto.paidByUserId },
            joinStatus: In(['active', 'invited']),
          },
        });
        if (!payerInGroup) {
          throw new BadRequestException({
            errorCode: 'VAL_INVALID_INPUT',
            message: 'paidByUserId must belong to the selected group',
          });
        }
        paidByGroupMember = payerInGroup;
      }
    } else {
      paidByUser =
        (await this.userRepository.findOne({
          where: { id: dto.paidByUserId },
        })) ?? undefined;
      if (!paidByUser) {
        throw new BadRequestException('paidByUser not found');
      }
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const groupKeyVersion = group
        ? await this.resolveTemplateGroupKeyVersion(
            group,
            dto.groupKeyVersionId,
            manager,
          )
        : undefined;

      const template = await manager.getRepository(RecurringExpense).save(
        manager.getRepository(RecurringExpense).create({
          title: dto.title,
          description: dto.description,
          amountTotal: dto.amountTotal,
          currency: normalizedCurrency,
          category: dto.category,
          paidByUser,
          paidByGroupMember,
          ownerUser,
          group,
          groupKeyVersion,
          frequency: dto.frequency,
          startDate: dto.startDate,
          endDate: dto.endDate,
          nextOccurrenceDate: dto.startDate,
          status: 'active',
        }),
      );

      await this.persistSplits(template, dto, manager);

      return manager.getRepository(RecurringExpense).findOne({
        where: { id: template.id },
        relations: [
          'paidByUser',
          'paidByGroupMember',
          'ownerUser',
          'group',
          'groupKeyVersion',
        ],
      });
    });

    if (!saved) {
      throw new NotFoundException('Failed to create recurring expense');
    }

    // Option A: if the template's first occurrence is due today, materialize it
    // immediately so it lands in the ledger without waiting for the midnight
    // cron. Past-dated and future-dated templates are left to the scheduler
    // (its `nextOccurrenceDate <= today` sweep). This reuses the scheduler's
    // one generation routine — no second code path. It runs in its own
    // transaction (already committed template above); a failure here is
    // non-fatal because the cron will still generate the occurrence, so the
    // create must not be rolled back or reported as failed.
    const today = this.todayStr();
    let firstOccurrenceGenerated = false;
    if (saved.status === 'active' && saved.nextOccurrenceDate === today) {
      try {
        await this.scheduler.generateDueOccurrences(saved, today);
        firstOccurrenceGenerated = true;
      } catch {
        // Swallow: template is persisted; the cron backstops generation.
        firstOccurrenceGenerated = false;
      }
    }

    return { ...(await this.mapResponse(saved)), firstOccurrenceGenerated };
  }

  async listRecurringExpenses(
    userId: string,
    groupId?: string,
  ): Promise<Record<string, any>[]> {
    const membershipGroupIds = (
      await this.groupMemberRepository.find({
        where: { user: { id: userId }, joinStatus: In(['active', 'invited']) },
        relations: ['group'],
      })
    ).map((m) => m.group.id);

    const query = this.recurringExpenseRepository
      .createQueryBuilder('template')
      .leftJoinAndSelect('template.paidByUser', 'paidByUser')
      .leftJoinAndSelect('template.paidByGroupMember', 'paidByGroupMember')
      .leftJoinAndSelect('template.ownerUser', 'ownerUser')
      .leftJoinAndSelect('template.group', 'group')
      // Needed so the response carries groupKeyVersionId — the client resolves
      // the group decryption key by version to decrypt the title/description.
      .leftJoinAndSelect('template.groupKeyVersion', 'groupKeyVersion');

    if (groupId) {
      if (groupId === 'personal') {
        query.where('group.id IS NULL AND ownerUser.id = :userId', { userId });
      } else {
        if (!membershipGroupIds.includes(groupId)) {
          throw new ForbiddenException('Access denied');
        }
        query.where('group.id = :groupId', { groupId });
      }
    } else {
      query.where('group.id IS NULL AND ownerUser.id = :userId', { userId });
      if (membershipGroupIds.length > 0) {
        query.orWhere('group.id IN (:...groupIds)', {
          groupIds: membershipGroupIds,
        });
      }
    }

    const templates = await query.getMany();
    return Promise.all(templates.map((t) => this.mapResponse(t)));
  }

  async getRecurringExpenseById(
    userId: string,
    id: string,
  ): Promise<Record<string, any>> {
    const template = await this.recurringExpenseRepository.findOne({
      where: { id },
      relations: [
        'paidByUser',
        'paidByGroupMember',
        'paidByGroupMember.user',
        'ownerUser',
        'group',
        'groupKeyVersion',
      ],
    });
    if (!template) {
      throw new NotFoundException('Recurring expense not found');
    }
    await this.ensureAccess(userId, template, false);
    return this.mapResponse(template);
  }

  async updateRecurringExpense(
    userId: string,
    id: string,
    dto: UpdateRecurringExpenseDto,
  ): Promise<Record<string, any>> {
    const template = await this.recurringExpenseRepository.findOne({
      where: { id },
      relations: [
        'paidByUser',
        'paidByGroupMember',
        'paidByGroupMember.user',
        'ownerUser',
        'group',
      ],
    });
    if (!template) {
      throw new NotFoundException('Recurring expense not found');
    }
    await this.ensureAccess(userId, template, true);

    if (template.version !== dto.version) {
      throw new PreconditionFailedException('Version conflict');
    }

    if (dto.paidByUserId && dto.paidByGroupMemberId) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'Provide only one of paidByUserId or paidByGroupMemberId',
      });
    }
    if (dto.paidByGroupMemberId && !template.group) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message:
          'paidByGroupMemberId is only valid for group recurring expenses',
      });
    }
    if (dto.paidByUserId) {
      const paidByUser = await this.userRepository.findOne({
        where: { id: dto.paidByUserId },
      });
      if (!paidByUser) {
        throw new BadRequestException('paidByUserId not found');
      }
      if (template.group) {
        // Frozen rule: a group template's payer always resolves via
        // GroupMember — paidByUserId is accepted as client convenience and
        // resolved to its GroupMember row here.
        const payerMember = await this.groupMemberRepository.findOne({
          where: {
            group: { id: template.group.id },
            user: { id: dto.paidByUserId },
            joinStatus: In(['active', 'invited']),
          },
        });
        if (!payerMember) {
          throw new BadRequestException({
            errorCode: 'VAL_INVALID_INPUT',
            message: 'paidByUserId must belong to the selected group',
          });
        }
        template.paidByGroupMember = payerMember;
        template.paidByUser = undefined;
      } else {
        template.paidByUser = paidByUser;
        template.paidByGroupMember = undefined;
      }
    } else if (dto.paidByGroupMemberId) {
      const payerMember = await this.groupMemberRepository.findOne({
        where: {
          id: dto.paidByGroupMemberId,
          group: { id: template.group!.id },
          joinStatus: In(['active', 'invited']),
        },
      });
      if (!payerMember) {
        throw new BadRequestException({
          errorCode: 'VAL_INVALID_INPUT',
          message: 'paidByGroupMemberId must belong to the selected group',
        });
      }
      template.paidByGroupMember = payerMember;
      template.paidByUser = undefined;
    }

    if (dto.title !== undefined) template.title = dto.title;
    if (dto.description !== undefined) template.description = dto.description;
    if (dto.amountTotal !== undefined) template.amountTotal = dto.amountTotal;
    if (dto.currency !== undefined)
      template.currency = dto.currency.toUpperCase();
    if (dto.category !== undefined) template.category = dto.category;
    if (dto.frequency !== undefined) template.frequency = dto.frequency;
    if (dto.startDate !== undefined) {
      template.startDate = dto.startDate;
      // Also reset nextOccurrenceDate if nextOccurrenceDate is before new startDate
      if (new Date(template.nextOccurrenceDate) < new Date(dto.startDate)) {
        template.nextOccurrenceDate = dto.startDate;
      }
    }
    if (dto.endDate !== undefined) template.endDate = dto.endDate;
    if (dto.status !== undefined) template.status = dto.status;

    if (dto.groupKeyVersionId && !template.group) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'groupKeyVersionId is only valid for group templates',
      });
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      if (template.group && dto.groupKeyVersionId) {
        // Re-stamp to the version the client re-encrypted with.
        template.groupKeyVersion = await this.resolveTemplateGroupKeyVersion(
          template.group,
          dto.groupKeyVersionId,
          manager,
        );
      }
      await manager.getRepository(RecurringExpense).save(template);

      if (dto.splits) {
        await manager
          .getRepository(RecurringExpenseSplit)
          .delete({ recurringExpense: { id: template.id } as any });
        await this.persistSplits(
          template,
          {
            splits: dto.splits,
            amountTotal: dto.amountTotal ?? Number(template.amountTotal),
            paidByUserId: dto.paidByUserId ?? template.paidByUser?.id,
            paidByGroupMemberId:
              dto.paidByGroupMemberId ?? template.paidByGroupMember?.id,
            groupId: template.group?.id,
          },
          manager,
        );
      }

      return manager.getRepository(RecurringExpense).findOne({
        where: { id: template.id },
        relations: [
          'paidByUser',
          'paidByGroupMember',
          'ownerUser',
          'group',
          'groupKeyVersion',
        ],
      });
    });

    if (!saved) {
      throw new NotFoundException('Failed to update recurring expense');
    }

    return this.mapResponse(saved);
  }

  async deleteRecurringExpense(userId: string, id: string): Promise<void> {
    const template = await this.recurringExpenseRepository.findOne({
      where: { id },
      relations: [
        'paidByUser',
        'paidByGroupMember',
        'paidByGroupMember.user',
        'ownerUser',
        'group',
      ],
    });
    if (!template) {
      throw new NotFoundException('Recurring expense not found');
    }
    await this.ensureAccess(userId, template, true);
    await this.recurringExpenseRepository.delete({ id });
  }

  private async mapResponse(
    template: RecurringExpense,
  ): Promise<Record<string, any>> {
    const splits = await this.recurringExpenseSplitRepository.find({
      where: { recurringExpense: { id: template.id } },
      relations: ['participantUser', 'participantGroupMember'],
      order: { createdAt: 'ASC' },
    });

    return {
      id: template.id,
      title: template.title,
      description: template.description ?? null,
      amountTotal: Number(template.amountTotal),
      currency: template.currency,
      category: template.category,
      paidByUserId: template.paidByUser?.id ?? null,
      paidByGroupMemberId: template.paidByGroupMember?.id ?? null,
      ownerUserId: template.ownerUser.id,
      groupId: template.group?.id ?? null,
      groupKeyVersionId: template.groupKeyVersion?.id ?? null,
      // Derived (no column): group templates are group-encrypted, the rest are
      // personal-scoped. The client needs this to pick the right decryption key
      // for the title/description ciphertext.
      encryptionScope: template.group ? 'group' : 'personal',
      frequency: template.frequency,
      startDate: template.startDate,
      endDate: template.endDate ?? null,
      nextOccurrenceDate: template.nextOccurrenceDate,
      status: template.status,
      splits: splits.map((s) => ({
        id: s.id,
        participantUserId: s.participantUser?.id ?? null,
        participantGroupMemberId: s.participantGroupMember?.id ?? null,
        splitType: s.splitType,
        shareValue: Number(s.shareValue),
        amountOwed: Number(s.amountOwed),
      })),
      version: template.version,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }
}
