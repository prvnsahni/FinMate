import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  Attachment,
  AttachmentVersion,
  AuditLog,
  EncryptedExpenseKey,
  Expense,
  ExpenseSplit,
  ExpensePayment,
  ExpenseSplitVersion,
  ExpenseTag,
  ExpenseVersion,
  Group,
  GroupKeyVersion,
  GroupMember,
  GroupMemberContribution,
  materializeConfirmedExpenseTags,
  ReceiptVersion,
  User,
} from '@finmate/data-models';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  LedgerTotals,
  paginate,
  PaginatedResponse,
} from '../common/pagination.util';
import { simplifyLedgerDebts } from '../common/ledger-debt-simplifier';
import { resolveMemberDisplay } from '../common/member-display.util';
import { calculateDeterministicSplits } from './split-calculator.util';
import { ExpenseEditPolicyService } from './services/expense-edit-policy.service';
import {
  CreateExpenseDto,
  ExpensePaymentInputDto,
  UpdateExpenseDto,
} from './dto';
import {
  GroupExpenseDimensionFilters,
  MemberRef,
  RawGroupExpenseFilter,
  applyExpenseDimensionFilters,
} from './group-expense-filters.util';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExpenseListParams {
  page: number;
  limit: number;
  cursor?: string;
  groupId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  categories?: string[];
  memberIds?: string[];
  paidByIds?: string[];
  transactionType?: 'expense' | 'refund';
  minAmount?: number;
  maxAmount?: number;
  sortBy?: 'date' | 'amount';
  sortOrder?: 'asc' | 'desc';
}

interface AnalyticsFilter {
  userId: string;
  groupId?: string;
  startDate?: string;
  endDate?: string;
  categories?: string[];
  memberIds?: string[];
  paidByIds?: string[];
  transactionType?: 'expense' | 'refund';
  minAmount?: number;
  maxAmount?: number;
}

interface MonthlyTotal {
  month: string;
  total: number;
  currency: string;
}

interface CategoryTotal {
  category: string;
  total: number;
  currency: string;
}

type ExpenseEncryptionMetadataInput = {
  groupId?: string;
  splits?: CreateExpenseDto['splits'] | UpdateExpenseDto['splits'];
  encryptionScope?: 'personal' | 'group' | 'direct_shared';
  wrappedContentKeys?: CreateExpenseDto['wrappedContentKeys'];
  encryptedAttachments?: CreateExpenseDto['encryptedAttachments'];
};

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ExpensesService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Expense)
    private readonly expenseRepository: Repository<Expense>,
    @InjectRepository(ExpenseSplit)
    private readonly expenseSplitRepository: Repository<ExpenseSplit>,
    @InjectRepository(ExpensePayment)
    private readonly expensePaymentRepository: Repository<ExpensePayment>,
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(GroupMember)
    private readonly groupMemberRepository: Repository<GroupMember>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Attachment)
    private readonly attachmentRepository: Repository<Attachment>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    @InjectRepository(EncryptedExpenseKey)
    private readonly encryptedExpenseKeyRepository: Repository<EncryptedExpenseKey>,
    private readonly expenseEditPolicy: ExpenseEditPolicyService,
  ) {}

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private basename(value: string): string {
    if (!value) return '';
    const parts = value.split('/').filter(Boolean);
    return parts[parts.length - 1] || value;
  }

  private isValidDateFormat(value?: string): boolean {
    if (!value) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    // Reject shape-valid but impossible calendar dates (e.g. 2026-06-31,
    // 2026-02-30). Postgres rejects these against a `date` column, so without
    // this check they surface as an unhandled 500 instead of a clean 400.
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }

  /** Returns the YYYY-MM string for the given date string or today. */
  private toYearMonth(dateStr?: string): string {
    const d = dateStr ? new Date(dateStr) : new Date();
    if (isNaN(d.getTime())) {
      const today = new Date();
      return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Signed contribution of an amount to net spending. Refunds count negatively
   * (money returned), so aggregates read as `expenses − refunds`.
   */
  private signedAmount(
    amount: number | string,
    transactionType?: 'expense' | 'refund',
  ): number {
    const value = Number(amount);
    return transactionType === 'refund' ? -value : value;
  }

  /**
   * Enforces the group transaction editing window on `expenseDate`:
   *  - Current calendar month: always editable.
   *  - Previous calendar month: editable through MONTH_LOCK_DAY (inclusive) of
   *    the current month.
   *  - After that day, and older months: fully locked (no edit, no delete).
   *
   * The rule itself lives in ExpenseEditPolicyService — the single source of
   * truth, unit-tested exhaustively. Household groups are exempt here (they
   * have their own explicit ledger-close lock in ensureExpenseAccess), and
   * personal expenses are never passed through this at all.
   */
  private assertWithinEditWindow(expenseDate: string): void {
    this.expenseEditPolicy.assertCanEdit(expenseDate);
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
      // Spectators are stored in the map so we can look them up, but they are
      // validated against and rejected in persistSplits. A pending
      // (Contact-backed) member has no user.id and is only ever resolvable
      // via groupMemberById (participantGroupMemberId), never by user id.
      if (member.user) {
        activeOrInvitedByUserId.set(member.user.id, member);
      }
    }

    return { groupMemberById, activeOrInvitedByUserId };
  }

  private async getOrCreateActiveGroupKeyVersion(
    group: Group,
    manager: EntityManager,
  ): Promise<GroupKeyVersion> {
    const existing = await manager.getRepository(GroupKeyVersion).findOne({
      where: { group: { id: group.id }, status: 'ACTIVE' },
      order: { version: 'DESC' },
    });
    if (existing) {
      return existing;
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

  /**
   * Resolves the key version the client declared it encrypted with. The stamp
   * must record the version actually used — not whatever is ACTIVE at write
   * time — or a rotation racing a write leaves the ciphertext undecryptable.
   */
  private async resolveDeclaredGroupKeyVersion(
    group: Group,
    declaredVersionId: string,
    manager: EntityManager,
  ): Promise<GroupKeyVersion> {
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

  private async ensureExpenseAccess(
    userId: string,
    expense: Expense,
    write = false,
  ): Promise<void> {
    if (!expense.group) {
      if (expense.ownerUser.id !== userId) {
        throw new ForbiddenException('You do not have access to this expense');
      }
      return;
    }

    const membership = await this.getGroupMembership(userId, expense.group.id);
    if (!membership) {
      throw new ForbiddenException('You do not have access to this expense');
    }

    if (write) {
      if (membership.joinStatus !== 'active') {
        throw new ForbiddenException('You must accept the invitation first');
      }
      // viewers cannot write
      if (membership.role === 'viewer') {
        throw new ForbiddenException('Viewers cannot modify expenses');
      }

      // Members/spectators can only modify their own expenses (either created
      // or paid by them). Group expenses always resolve payer via
      // paidByGroupMember now (frozen rule), so "paid by them" must check
      // that side too; paidByUser is only ever set for personal expenses.
      // A group expense paid by a pending member matches neither and can
      // only be edited by its owner.
      if (membership.role === 'member' || membership.role === 'spectator') {
        const paidByCaller =
          expense.paidByUser?.id === userId ||
          expense.paidByGroupMember?.user?.id === userId;
        if (expense.ownerUser.id !== userId && !paidByCaller) {
          throw new ForbiddenException(
            'Members can only modify their own expenses',
          );
        }
      }

      const group = await this.groupRepository.findOne({
        where: { id: expense.group.id },
      });
      if (!group) {
        throw new NotFoundException('Group not found');
      }
      if (group.isArchived) {
        throw new ForbiddenException({
          errorCode: 'RES_FORBIDDEN',
          message: 'Group is archived and read-only',
        });
      }

      // Monthly closing window (all group types). The current month is always
      // editable; the previous month stays editable through MONTH_LOCK_DAY of
      // the following month; older months are locked. Household groups are
      // keyed by their ledgerMonth (the accounting month), other groups by the
      // transaction date — but they share one rule so the grace period is
      // consistent everywhere. See ExpenseEditPolicyService.
      if (group.groupType === 'household') {
        this.expenseEditPolicy.assertCanEdit(
          expense.ledgerMonth ?? expense.expenseDate,
        );
      } else {
        this.assertWithinEditWindow(expense.expenseDate);
      }
    }
  }

  /** Write an audit log entry. Fire-and-forget — never throws. */
  private async writeAuditLog(opts: {
    actorUser: User;
    action: string;
    entityId: string;
    groupId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.auditLogRepository.save(
        this.auditLogRepository.create({
          actorUser: opts.actorUser,
          action: opts.action,
          entityType: 'expense',
          entityId: opts.entityId,
          scope: opts.groupId ? 'group' : 'personal',
          group: opts.groupId ? ({ id: opts.groupId } as Group) : undefined,
          metadataJson: opts.metadata,
        }),
      );
    } catch {
      // Audit failures must never block the primary operation
    }
  }

  /** Retrieves wrapped content keys for a direct_shared expense. */
  private async getWrappedContentKeys(
    expenseId: string,
  ): Promise<Array<{ userId: string; wrappedKey: string }>> {
    const keys = await this.encryptedExpenseKeyRepository.find({
      where: { expense: { id: expenseId } },
      relations: ['user'],
    });
    return keys.map((k) => ({
      userId: k.user.id,
      wrappedKey: k.wrappedKey,
    }));
  }

  private getDirectParticipantIds(
    dto: ExpenseEncryptionMetadataInput,
    ownerUserId: string,
  ): string[] {
    const ids = new Set<string>([ownerUserId]);
    for (const split of dto.splits ?? []) {
      if (split.participantUserId) {
        ids.add(split.participantUserId);
      }
    }
    return [...ids];
  }

  private validateAttachmentEnvelopeMetadata(
    dto: ExpenseEncryptionMetadataInput,
  ): void {
    for (const attachment of dto.encryptedAttachments ?? []) {
      if (
        !attachment.storageKey ||
        !attachment.encryptedFileKey ||
        !attachment.encryptedOriginalName ||
        !attachment.mimeType ||
        !Number.isFinite(Number(attachment.sizeBytes)) ||
        Number(attachment.sizeBytes) < 0
      ) {
        throw new BadRequestException({
          errorCode: 'VAL_INVALID_INPUT',
          message: 'Encrypted attachment metadata is incomplete',
        });
      }
    }
  }

  private validateExpenseEncryptionMetadata(
    userId: string,
    dto: ExpenseEncryptionMetadataInput,
    groupId?: string,
  ): void {
    this.validateAttachmentEnvelopeMetadata(dto);

    const scope =
      dto.encryptionScope ??
      (groupId
        ? 'group'
        : this.getDirectParticipantIds(dto, userId).length > 1
          ? 'direct_shared'
          : 'personal');

    if (groupId && scope !== 'group') {
      throw new BadRequestException({
        errorCode: 'EXP_ENCRYPTION_SCOPE_MISMATCH',
        message: 'Group expenses must use group encryption scope',
      });
    }

    if (!groupId && scope === 'group') {
      throw new BadRequestException({
        errorCode: 'EXP_ENCRYPTION_SCOPE_MISMATCH',
        message: 'Personal expenses cannot use group encryption scope',
      });
    }

    if (scope === 'direct_shared') {
      throw new BadRequestException({
        errorCode: 'EXP_ENCRYPTION_SCOPE_MISMATCH',
        message:
          'Shared expenses must belong to a group and use group encryption scope',
      });
    }

    if (
      scope === 'personal' &&
      this.getDirectParticipantIds(dto, userId).length > 1
    ) {
      throw new BadRequestException({
        errorCode: 'EXP_ENCRYPTION_SCOPE_MISMATCH',
        message:
          'Shared expenses must belong to a group and use group encryption scope',
      });
    }
  }

  /**
   * Canonical, pure expense response shape. Takes already-loaded relations
   * so both the single-item and batch mapping paths — which differ only in
   * how they fetch splits/attachments/wrappedContentKeys — emit an
   * identical response. See docs/audits/expense-architecture-audit.md
   * (P2-1) for why this was extracted.
   */
  private toExpenseResponse(
    expense: Expense,
    splits: ExpenseSplit[],
    attachments: Attachment[],
    wrappedContentKeys: Array<{ userId: string; wrappedKey: string }>,
  ): Record<string, unknown> {
    return {
      id: expense.id,
      title: expense.title,
      description: expense.description ?? null,
      amountTotal: Number(expense.amountTotal),
      currency: expense.currency,
      category: expense.category,
      transactionType: expense.transactionType ?? 'expense',
      paidByUserId: expense.paidByUser?.id ?? null,
      paidByGroupMemberId: expense.paidByGroupMember?.id ?? null,
      ownerUserId: expense.ownerUser.id,
      groupId: expense.group?.id ?? null,
      groupKeyVersionId: expense.groupKeyVersion?.id ?? null,
      groupKeyVersion: expense.groupKeyVersion?.version ?? null,
      expenseDate: expense.expenseDate,
      status: expense.status,
      encryptionScope: expense.encryptionScope ?? 'personal',
      ledgerMonth: expense.ledgerMonth ?? null,
      isCarryForward: expense.isCarryForward,
      splits: splits.map((split) => ({
        id: split.id,
        expenseId: expense.id,
        participantUserId: split.participantUser?.id ?? null,
        participantGroupMemberId: split.participantGroupMember?.id ?? null,
        splitType: split.splitType,
        shareValue: Number(split.shareValue),
        amountOwed: Number(split.amountOwed),
        isSettled: split.isSettled,
        settledAt: split.settledAt ?? null,
        createdAt: split.createdAt,
        updatedAt: split.updatedAt,
      })),
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        uploaderUserId: attachment.uploaderUser.id,
        expenseId: expense.id,
        noteId: null,
        goalId: null,
        groupId: expense.group?.id ?? null,
        storageKey: attachment.storageKey,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        sizeBytes: Number(attachment.sizeBytes),
        checksumSha256: attachment.checksumSha256 ?? null,
        encryptedFileKey: attachment.encryptedFileKey ?? null,
        encryptedOriginalName: attachment.encryptedOriginalName ?? null,
        createdAt: attachment.createdAt,
      })),
      wrappedContentKeys,
      version: expense.version,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
      deletedAt: expense.deletedAt ?? null,
    };
  }

  private async mapExpenseResponse(
    expense: Expense,
  ): Promise<Record<string, unknown>> {
    const splits = await this.expenseSplitRepository.find({
      where: { expense: { id: expense.id } },
      relations: ['participantUser', 'participantGroupMember'],
      order: { createdAt: 'ASC' },
    });

    const attachments = await this.attachmentRepository.find({
      where: { expense: { id: expense.id } },
      relations: ['uploaderUser'],
      order: { createdAt: 'ASC' },
    });

    const wrappedContentKeys = await this.getWrappedContentKeys(expense.id);

    return this.toExpenseResponse(
      expense,
      splits,
      attachments,
      wrappedContentKeys,
    );
  }

  /**
   * Batch variant of mapExpenseResponse for list endpoints.
   * Replaces N×3 per-expense queries with 3 bulk queries regardless of list size.
   *
   * Query pattern: 1 expense query (caller) + 3 IN-clause queries (this method)
   * vs. the previous 1 expense query + 3×N per-expense queries.
   */
  private async batchMapExpenseResponses(
    expenses: Expense[],
  ): Promise<Record<string, unknown>[]> {
    if (expenses.length === 0) return [];

    const ids = expenses.map((e) => e.id);

    // Three parallel batch fetches — one query each regardless of list size.
    // `relations: ['expense']` loads expense.id for grouping via the identity map;
    // TypeORM deduplicates entity instances within a single query so each unique
    // expense UUID is only instantiated once.
    const [allSplits, allAttachments, allWrappedKeys] = await Promise.all([
      this.expenseSplitRepository.find({
        where: { expense: { id: In(ids) } },
        relations: ['expense', 'participantUser', 'participantGroupMember'],
        order: { createdAt: 'ASC' },
      }),
      this.attachmentRepository.find({
        where: { expense: { id: In(ids) } },
        relations: ['expense', 'uploaderUser'],
        order: { createdAt: 'ASC' },
      }),
      this.encryptedExpenseKeyRepository.find({
        where: { expense: { id: In(ids) } },
        relations: ['expense', 'user'],
      }),
    ]);

    // Group each batch result by expense ID for O(1) lookup during mapping.
    const splitsByExpId = new Map<string, ExpenseSplit[]>();
    for (const split of allSplits) {
      const eid = split.expense.id;
      const arr = splitsByExpId.get(eid);
      if (arr) arr.push(split);
      else splitsByExpId.set(eid, [split]);
    }

    const attachsByExpId = new Map<string, Attachment[]>();
    for (const att of allAttachments) {
      const eid = att.expense.id;
      const arr = attachsByExpId.get(eid);
      if (arr) arr.push(att);
      else attachsByExpId.set(eid, [att]);
    }

    const keysByExpId = new Map<string, EncryptedExpenseKey[]>();
    for (const key of allWrappedKeys) {
      const eid = key.expense.id;
      const arr = keysByExpId.get(eid);
      if (arr) arr.push(key);
      else keysByExpId.set(eid, [key]);
    }

    return expenses.map((expense) => {
      const splits = splitsByExpId.get(expense.id) ?? [];
      const attachments = attachsByExpId.get(expense.id) ?? [];
      const wrappedKeys = keysByExpId.get(expense.id) ?? [];
      const wrappedContentKeys = wrappedKeys.map((k) => ({
        userId: k.user.id,
        wrappedKey: k.wrappedKey,
      }));

      return this.toExpenseResponse(
        expense,
        splits,
        attachments,
        wrappedContentKeys,
      );
    });
  }

  private expenseSnapshot(expense: Expense): Record<string, unknown> {
    return {
      id: expense.id,
      title: expense.title,
      description: expense.description ?? null,
      amountTotal: Number(expense.amountTotal),
      currency: expense.currency,
      category: expense.category,
      transactionType: expense.transactionType ?? 'expense',
      paidByUserId: expense.paidByUser?.id ?? null,
      paidByGroupMemberId: expense.paidByGroupMember?.id ?? null,
      ownerUserId: expense.ownerUser?.id ?? null,
      groupId: expense.group?.id ?? null,
      groupKeyVersionId: expense.groupKeyVersion?.id ?? null,
      expenseDate: expense.expenseDate,
      status: expense.status,
      ledgerMonth: expense.ledgerMonth ?? null,
      isCarryForward: expense.isCarryForward,
      encryptionScope: expense.encryptionScope,
      version: expense.version,
      deletedAt: expense.deletedAt ?? null,
    };
  }

  private splitSnapshot(split: ExpenseSplit): Record<string, unknown> {
    return {
      id: split.id,
      expenseId: split.expense?.id ?? null,
      participantUserId: split.participantUser?.id ?? null,
      participantGroupMemberId: split.participantGroupMember?.id ?? null,
      splitType: split.splitType,
      shareValue: Number(split.shareValue),
      amountOwed: Number(split.amountOwed),
      isSettled: split.isSettled,
      settledAt: split.settledAt ?? null,
      version: split.version ?? null,
      deletedAt: split.deletedAt ?? null,
    };
  }

  private attachmentSnapshot(attachment: Attachment): Record<string, unknown> {
    return {
      id: attachment.id,
      expenseId: attachment.expense?.id ?? null,
      uploaderUserId: attachment.uploaderUser?.id ?? null,
      groupKeyVersionId: attachment.groupKeyVersion?.id ?? null,
      storageKey: attachment.storageKey,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: Number(attachment.sizeBytes),
      checksumSha256: attachment.checksumSha256 ?? null,
      encryptedFileKey: attachment.encryptedFileKey ?? null,
      encryptedOriginalName: attachment.encryptedOriginalName ?? null,
    };
  }

  private async recordExpenseVersion(
    manager: EntityManager,
    expense: Expense,
    action: ExpenseVersion['action'],
    actorUser?: User | null,
  ): Promise<void> {
    await manager.getRepository(ExpenseVersion).save(
      manager.getRepository(ExpenseVersion).create({
        expense,
        entityVersion: expense.version,
        action,
        snapshot: this.expenseSnapshot(expense),
        actorUser: actorUser ?? undefined,
      }),
    );
  }

  private async recordSplitVersions(
    manager: EntityManager,
    expense: Expense,
    splits: ExpenseSplit[],
    action: ExpenseSplitVersion['action'],
    actorUser?: User | null,
  ): Promise<void> {
    for (const split of splits) {
      await manager.getRepository(ExpenseSplitVersion).save(
        manager.getRepository(ExpenseSplitVersion).create({
          expense,
          expenseSplit: split,
          entityVersion: split.version,
          action,
          snapshot: this.splitSnapshot(split),
          actorUser: actorUser ?? undefined,
        }),
      );
    }
  }

  private async recordAttachmentVersions(
    manager: EntityManager,
    expense: Expense,
    attachments: Attachment[],
    action: AttachmentVersion['action'],
    actorUser?: User | null,
  ): Promise<void> {
    for (const attachment of attachments) {
      const snapshot = this.attachmentSnapshot(attachment);
      await manager.getRepository(AttachmentVersion).save(
        manager.getRepository(AttachmentVersion).create({
          attachment,
          expense,
          action,
          snapshot,
          actorUser: actorUser ?? undefined,
        }),
      );
      await manager.getRepository(ReceiptVersion).save(
        manager.getRepository(ReceiptVersion).create({
          receiptAttachment: attachment,
          expense,
          action,
          snapshot,
          actorUser: actorUser ?? undefined,
        }),
      );
    }
  }

  private async persistSplits(
    expense: Expense,
    dto: Pick<
      CreateExpenseDto,
      | 'splits'
      | 'amountTotal'
      | 'paidByUserId'
      | 'paidByGroupMemberId'
      | 'groupId'
    >,
    manager: EntityManager,
  ): Promise<ExpenseSplit[]> {
    const savedSplits: ExpenseSplit[] = [];
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
      dto.splits,
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
            message: 'Personal expense participants must be valid users',
          });
        }

        const savedSplit = await manager.getRepository(ExpenseSplit).save(
          manager.getRepository(ExpenseSplit).create({
            expense,
            participantUser,
            splitType: split.splitType,
            shareValue: split.shareValue,
            amountOwed: split.amountOwed,
            isSettled: false,
          }),
        );
        savedSplits.push(savedSplit);
      }
      return savedSplits;
    }

    const { groupMemberById, activeOrInvitedByUserId } =
      await this.buildGroupParticipantMaps(dto.groupId, manager);

    for (const split of calculated) {
      // Resolve the participant
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

      // Spectators are NEVER part of split calculations
      if (resolvedMember.role === 'spectator') {
        throw new BadRequestException({
          errorCode: 'EXP_SPECTATOR_SPLIT',
          message: `Spectator members (${resolvedMember.user?.id ?? resolvedMember.id}) cannot be included in expense splits`,
        });
      }

      const savedSplit = await manager.getRepository(ExpenseSplit).save(
        manager.getRepository(ExpenseSplit).create({
          expense,
          participantGroupMember: resolvedMember,
          splitType: split.splitType,
          shareValue: split.shareValue,
          amountOwed: split.amountOwed,
          isSettled: false,
        }),
      );
      savedSplits.push(savedSplit);
    }
    return savedSplits;
  }

  /**
   * Persist the payer breakdown for an expense (soft-deleting any existing
   * payments first, so this is safe for both create and update). Multi-payer:
   * when `payments` is supplied it fully specifies every payer and must sum to
   * `amountTotal`; otherwise a single payment is derived from the expense's
   * primary payer (`paidByGroupMember`/`paidByUser`). Multiple payers are only
   * supported for group expenses.
   */
  private async persistExpensePayments(
    expense: Expense,
    opts: {
      amountTotal: number;
      groupId?: string;
      primaryPaidByUser?: User;
      primaryPaidByGroupMember?: GroupMember;
      payments?: ExpensePaymentInputDto[];
    },
    manager: EntityManager,
  ): Promise<ExpensePayment[]> {
    const repo = manager.getRepository(ExpensePayment);
    // Payments are ledger history — soft-delete replaced rows (like splits).
    await repo.softDelete({ expense: { id: expense.id } as Partial<Expense> });

    const toCents = (n: number) => Math.round((n + Number.EPSILON) * 100);
    const totalCents = toCents(opts.amountTotal);
    const saved: ExpensePayment[] = [];

    // Single-payer path (default, and the only path for personal expenses).
    if (!opts.payments || opts.payments.length === 0) {
      const created = repo.create({
        expense,
        paidByUser: opts.groupId ? undefined : opts.primaryPaidByUser,
        paidByGroupMember: opts.groupId
          ? opts.primaryPaidByGroupMember
          : undefined,
        amount: opts.amountTotal,
      });
      saved.push(await repo.save(created));
      return saved;
    }

    // Multi-payer path — group expenses only.
    if (!opts.groupId) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'Multiple payers are only supported for group expenses',
      });
    }

    const { groupMemberById, activeOrInvitedByUserId } =
      await this.buildGroupParticipantMaps(opts.groupId, manager);

    let sumCents = 0;
    const primaryId = opts.primaryPaidByGroupMember?.id;
    let primarySeen = false;

    for (const p of opts.payments) {
      const hasUser = !!p.paidByUserId;
      const hasMember = !!p.paidByGroupMemberId;
      if (hasUser === hasMember) {
        throw new BadRequestException({
          errorCode: 'VAL_INVALID_INPUT',
          message:
            'Each payment must include exactly one of paidByUserId or paidByGroupMemberId',
        });
      }
      if (!Number.isFinite(Number(p.amount)) || Number(p.amount) <= 0) {
        throw new BadRequestException({
          errorCode: 'VAL_INVALID_INPUT',
          message: 'Each payment amount must be a positive number',
        });
      }
      const member = p.paidByGroupMemberId
        ? groupMemberById.get(p.paidByGroupMemberId)
        : activeOrInvitedByUserId.get(p.paidByUserId as string);
      if (!member) {
        throw new BadRequestException({
          errorCode: 'VAL_INVALID_INPUT',
          message: 'Each payer must be an active member of the selected group',
        });
      }
      if (member.role === 'spectator') {
        throw new BadRequestException({
          errorCode: 'EXP_SPECTATOR_SPLIT',
          message: `Spectator members (${member.user?.id ?? member.id}) cannot be expense payers`,
        });
      }
      if (member.id === primaryId) primarySeen = true;
      sumCents += toCents(p.amount);
      saved.push(
        await repo.save(
          repo.create({
            expense,
            paidByGroupMember: member,
            amount: p.amount,
          }),
        ),
      );
    }

    if (sumCents !== totalCents) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'Payment amounts must sum to the expense total',
      });
    }
    if (primaryId && !primarySeen) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'The primary payer (paidBy) must be included in payments',
      });
    }
    return saved;
  }

  // ─── CRUD Operations ───────────────────────────────────────────────────────

  /** Create a personal or group expense. */
  async createExpense(
    userId: string,
    dto: CreateExpenseDto,
  ): Promise<Record<string, unknown>> {
    if (!dto.splits || !Array.isArray(dto.splits) || dto.splits.length === 0) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'Splits must be a non-empty array',
      });
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

    const ownerUser = await this.userRepository.findOne({
      where: { id: userId },
    });
    if (!ownerUser) {
      throw new NotFoundException('User not found');
    }

    let paidByUser: User | undefined;
    let paidByGroupMember: GroupMember | undefined;
    if (dto.paidByUserId) {
      paidByUser =
        (await this.userRepository.findOne({
          where: { id: dto.paidByUserId },
        })) ?? undefined;
      if (!paidByUser) {
        throw new BadRequestException({
          errorCode: 'VAL_INVALID_INPUT',
          message: 'paidByUserId must reference an existing user',
        });
      }
    }
    if (dto.paidByGroupMemberId && !dto.groupId) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'paidByGroupMemberId is only valid for group expenses',
      });
    }

    let group: Group | undefined;

    if (dto.groupId) {
      const membership = await this.getGroupMembership(userId, dto.groupId);
      if (!membership) {
        throw new ForbiddenException('You do not have access to this group');
      }
      if (membership.joinStatus !== 'active') {
        throw new ForbiddenException('You must accept the invitation first');
      }
      // Viewers cannot create; spectators can create (but are excluded from splits)
      if (membership.role === 'viewer') {
        throw new ForbiddenException('Viewers cannot create expenses');
      }

      group = await this.groupRepository.findOne({
        where: { id: dto.groupId },
      });
      if (!group) {
        throw new NotFoundException('Group not found');
      }
      if (group.isArchived) {
        throw new ForbiddenException({
          errorCode: 'RES_FORBIDDEN',
          message: 'Group is archived and read-only',
        });
      }

      // ── Currency validation ─────────────────────────────────────────────
      if (
        group.currency &&
        dto.currency.toUpperCase() !== group.currency.toUpperCase()
      ) {
        throw new BadRequestException({
          errorCode: 'EXP_CURRENCY_MISMATCH',
          message: `Expense currency must match the group's base currency (${group.currency})`,
        });
      }

      // ── Editing-window validation ───────────────────────────────────────
      // One rule for every group type: the current month plus the previous
      // month through MONTH_LOCK_DAY of the following month. A household
      // expense's ledgerMonth is derived from expenseDate, so gating on the
      // date here lands on the same month.
      this.assertWithinEditWindow(dto.expenseDate);

      // Frozen rule: inside a group ledger, the payer always resolves to
      // GroupMember, never User — paidByUserId is accepted as a client
      // convenience (the common "I paid" case) but is resolved to its
      // GroupMember row here and never persisted as paidByUser for a group
      // expense. paidByUser is only ever the payer for personal expenses.
      if (dto.paidByGroupMemberId) {
        paidByGroupMember =
          (await this.groupMemberRepository.findOne({
            where: {
              id: dto.paidByGroupMemberId,
              group: { id: dto.groupId },
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
            group: { id: dto.groupId },
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
      // Always persist via GroupMember for group expenses, per the frozen
      // group-ledger identity rule — regardless of which field the client sent.
      paidByUser = undefined;
    } else {
      if (dto.paidByUserId !== userId) {
        throw new ForbiddenException(
          'Personal expenses must be paid by the authenticated user',
        );
      }
      const hasGroupMemberParticipant = dto.splits.some(
        (split) => !!split.participantGroupMemberId,
      );
      if (hasGroupMemberParticipant) {
        throw new BadRequestException({
          errorCode: 'VAL_INVALID_INPUT',
          message:
            'Personal expenses cannot include participantGroupMemberId in splits',
        });
      }
      if (dto.groupKeyVersionId) {
        throw new BadRequestException({
          errorCode: 'VAL_INVALID_INPUT',
          message: 'groupKeyVersionId is only valid for group expenses',
        });
      }
    }

    this.validateExpenseEncryptionMetadata(userId, dto, group?.id);
    const effectiveEncryptionScope =
      dto.encryptionScope ?? (group ? 'group' : 'personal');

    const saved = await this.dataSource.transaction(async (manager) => {
      const groupKeyVersion = group
        ? dto.groupKeyVersionId
          ? await this.resolveDeclaredGroupKeyVersion(
              group,
              dto.groupKeyVersionId,
              manager,
            )
          : await this.getOrCreateActiveGroupKeyVersion(group, manager)
        : undefined;

      const expense = await manager.getRepository(Expense).save(
        manager.getRepository(Expense).create({
          title: dto.title,
          description: dto.description,
          amountTotal: dto.amountTotal,
          currency: dto.currency.toUpperCase(),
          category: dto.category,
          transactionType: dto.transactionType ?? 'expense',
          paidByUser,
          paidByGroupMember,
          ownerUser,
          group,
          expenseDate: dto.expenseDate,
          status: dto.status || 'posted',
          encryptionScope: effectiveEncryptionScope,
          groupKeyVersion,
          // Auto-assign ledgerMonth for household groups
          ledgerMonth:
            group?.groupType === 'household'
              ? dto.expenseDate.slice(0, 7)
              : undefined,
          isCarryForward: false,
        }),
      );

      const savedSplits = await this.persistSplits(expense, dto, manager);

      // Persist the payer breakdown (single- or multi-payer).
      await this.persistExpensePayments(
        expense,
        {
          amountTotal: dto.amountTotal,
          groupId: group?.id,
          primaryPaidByUser: paidByUser,
          primaryPaidByGroupMember: paidByGroupMember,
          payments: dto.payments,
        },
        manager,
      );

      // Save wrapped content keys for direct_shared expenses
      if (
        effectiveEncryptionScope === 'direct_shared' &&
        dto.wrappedContentKeys?.length
      ) {
        for (const wk of dto.wrappedContentKeys) {
          await manager.getRepository(EncryptedExpenseKey).save(
            manager.getRepository(EncryptedExpenseKey).create({
              expense,
              user: { id: wk.userId } as User,
              wrappedKey: wk.wrappedKey,
            }),
          );
        }
      }

      // Save encrypted attachments (new model)
      const savedAttachments: Attachment[] = [];
      if (dto.encryptedAttachments?.length) {
        for (const att of dto.encryptedAttachments) {
          const savedAttachment = await manager.getRepository(Attachment).save(
            manager.getRepository(Attachment).create({
              uploaderUser: ownerUser,
              expense,
              storageKey: att.storageKey,
              originalName: 'encrypted',
              mimeType: att.mimeType,
              sizeBytes: String(att.sizeBytes),
              encryptedFileKey: att.encryptedFileKey,
              encryptedOriginalName: att.encryptedOriginalName,
            }),
          );
          savedAttachments.push(savedAttachment);
        }
      } else if (dto.attachmentKeys?.length) {
        // Legacy attachment keys support
        for (const key of dto.attachmentKeys) {
          const savedAttachment = await manager.getRepository(Attachment).save(
            manager.getRepository(Attachment).create({
              uploaderUser: ownerUser,
              expense,
              storageKey: key,
              // ZK: never persist a plaintext filename — names live only in
              // encryptedOriginalName on the new attachment model.
              originalName: 'encrypted',
              mimeType: 'application/octet-stream',
              sizeBytes: '0',
            }),
          );
          savedAttachments.push(savedAttachment);
        }
      }

      // TAG-BATCH-A — persist confirmed DOC-5 tags (descriptive Zone-2 metadata
      // only; never touches any financial column). No-op for total-only receipts
      // and manual creation (no `dto.tags`).
      await this.persistConfirmedExpenseTags(manager, expense, dto, ownerUser);

      await this.recordExpenseVersion(manager, expense, 'created', ownerUser);
      await this.recordSplitVersions(
        manager,
        expense,
        savedSplits,
        'created',
        ownerUser,
      );
      await this.recordAttachmentVersions(
        manager,
        expense,
        savedAttachments,
        'created',
        ownerUser,
      );

      return manager.getRepository(Expense).findOne({
        where: { id: expense.id },
        relations: [
          'paidByUser',
          'paidByGroupMember',
          'paidByGroupMember.user',
          'ownerUser',
          'group',
          'groupKeyVersion',
        ],
      });
    });

    if (!saved) {
      throw new NotFoundException('Expense not found after creation');
    }

    // Write audit log (non-blocking)
    void this.writeAuditLog({
      actorUser: ownerUser,
      action: 'expense.created',
      entityId: saved.id,
      groupId: group?.id,
      metadata: {
        title: saved.title,
        amountTotal: Number(saved.amountTotal),
        currency: saved.currency,
      },
    });

    return this.mapExpenseResponse(saved);
  }

  /**
   * TAG-BATCH-A — persist the confirmed DOC-5 taxonomy tags for a freshly
   * created expense. Purely descriptive, server-readable Zone-2 metadata (the
   * same classification as `expenses.category`): it NEVER reads or writes any
   * financial field, so FIN-002 is unaffected.
   *
   * Privacy: the classifier input is ONLY the stable canonical `tagId` +
   * authority the client already confirmed — never `title`/`description`, never
   * keys. The server does not decrypt anything and does not classify from free
   * text here; it only validates each id against the shared canonical taxonomy,
   * materializes active ancestors (milk → dairy → grocery → food), de-dups by
   * id keeping the highest authority (a `USER_CONFIRMED` tag is never downgraded
   * by a derived `INFERRED` one), and drops unknown/deprecated ids.
   *
   * Runs inside the create transaction so tags commit atomically with the
   * expense; the `ON DELETE CASCADE` FK removes them if the expense is hard
   * deleted. No historical backfill — only tags supplied for THIS creation.
   */
  private async persistConfirmedExpenseTags(
    manager: EntityManager,
    expense: Expense,
    dto: CreateExpenseDto,
    createdByUser: User,
  ): Promise<void> {
    if (!dto.tags?.length) {
      return;
    }
    const materialized = materializeConfirmedExpenseTags(
      dto.tags.map((t) => ({
        tagId: t.tagId,
        authority: t.authority,
        source: t.source,
        confidence: t.confidence ?? null,
      })),
    );
    if (materialized.length === 0) {
      return;
    }
    const repo = manager.getRepository(ExpenseTag);
    await repo.save(
      materialized.map((m) =>
        repo.create({
          expense,
          tagId: m.tagId,
          authority: m.authority,
          source: m.source,
          confidence: m.confidence,
          taxonomyVersion: m.taxonomyVersion,
          createdByUser,
        }),
      ),
    );
  }

  /**
   * Soft duplicate check: finds other posted transactions in the same scope
   * (personal, or a specific group) with the same amount, date, currency and
   * transaction type. Never blocks a save — the caller (frontend) uses this
   * only to warn the user and let them decide. Title is intentionally never
   * part of the match (users write wildly different titles for the same
   * real-world transaction), so results are capped and returned in the same
   * shape as listExpenses()/getExpenseById() for the caller to decrypt.
   */
  async findPotentialDuplicates(
    userId: string,
    params: {
      amountTotal: number;
      expenseDate: string;
      currency: string;
      transactionType?: 'expense' | 'refund';
      groupId?: string;
      excludeId?: string;
    },
  ): Promise<Record<string, unknown>[]> {
    if (!Number.isFinite(params.amountTotal) || params.amountTotal <= 0) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'amountTotal must be a positive number',
      });
    }
    if (!this.isValidDateFormat(params.expenseDate)) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'expenseDate must use YYYY-MM-DD format',
      });
    }

    if (params.groupId) {
      const membership = await this.getGroupMembership(userId, params.groupId);
      if (!membership) {
        throw new ForbiddenException('You do not have access to this group');
      }
    }

    const query = this.expenseRepository
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.paidByUser', 'paidByUser')
      .leftJoinAndSelect('expense.ownerUser', 'ownerUser')
      .leftJoinAndSelect('expense.group', 'group')
      .leftJoinAndSelect('expense.groupKeyVersion', 'groupKeyVersion')
      .leftJoinAndSelect('expense.paidByGroupMember', 'paidByGroupMember')
      .where('expense.status != :voidStatus', { voidStatus: 'void' })
      .andWhere('expense.amountTotal = :amountTotal', {
        amountTotal: params.amountTotal,
      })
      .andWhere('expense.expenseDate = :expenseDate', {
        expenseDate: params.expenseDate,
      })
      .andWhere('expense.currency = :currency', {
        currency: params.currency.toUpperCase(),
      })
      .andWhere('expense.transactionType = :transactionType', {
        transactionType: params.transactionType ?? 'expense',
      });

    if (params.groupId) {
      query.andWhere('group.id = :groupId', { groupId: params.groupId });
    } else {
      query.andWhere('group.id IS NULL AND ownerUser.id = :userId', {
        userId,
      });
    }

    if (params.excludeId) {
      query.andWhere('expense.id != :excludeId', {
        excludeId: params.excludeId,
      });
    }

    const matches = await query
      .orderBy('expense.createdAt', 'DESC')
      .take(10)
      .getMany();

    return this.batchMapExpenseResponses(matches);
  }

  /** List expenses with pagination and filtering. */
  async listExpenses(
    userId: string,
    params: ExpenseListParams,
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    if (
      !this.isValidDateFormat(params.startDate) ||
      !this.isValidDateFormat(params.endDate)
    ) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'Date filters must use YYYY-MM-DD format',
      });
    }

    const page =
      Number.isFinite(params.page) && params.page > 0 ? params.page : 1;
    const limit =
      Number.isFinite(params.limit) && params.limit > 0 ? params.limit : 20;

    const membershipGroupIds = (
      await this.groupMemberRepository.find({
        where: { user: { id: userId }, joinStatus: In(['active', 'invited']) },
        relations: ['group'],
      })
    ).map((m) => m.group.id);

    if (params.groupId && params.groupId !== 'personal') {
      const allowed = membershipGroupIds.includes(params.groupId);
      if (!allowed) {
        throw new ForbiddenException('You do not have access to this group');
      }
    }

    const query = this.expenseRepository
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.paidByUser', 'paidByUser')
      .leftJoinAndSelect('expense.ownerUser', 'ownerUser')
      .leftJoinAndSelect('expense.group', 'group')
      .leftJoinAndSelect('expense.groupKeyVersion', 'groupKeyVersion')
      .leftJoinAndSelect('expense.paidByGroupMember', 'paidByGroupMember');

    if (params.groupId) {
      if (params.groupId === 'personal') {
        query.where('group.id IS NULL AND ownerUser.id = :userId', { userId });
      } else {
        query.where('group.id = :groupId', { groupId: params.groupId });
      }
    } else {
      query.where(
        new Brackets((qb) => {
          qb.where('ownerUser.id = :userId AND group.id IS NULL', { userId });
          if (membershipGroupIds.length > 0) {
            qb.orWhere('group.id IN (:...groupIds)', {
              groupIds: membershipGroupIds,
            });
          }
        }),
      );
    }

    if (params.status) {
      query.andWhere('expense.status = :status', { status: params.status });
    }

    if (params.startDate) {
      query.andWhere('expense.expenseDate >= :startDate', {
        startDate: params.startDate,
      });
    }

    if (params.endDate) {
      query.andWhere('expense.expenseDate <= :endDate', {
        endDate: params.endDate,
      });
    }

    // Unified group-filter dimensions (categories / members / payers / type /
    // amount). Applied before the totals-query clone below so the summary tiles
    // reflect the same scope as the paginated rows.
    const [memberRefs, paidByRefs] = await Promise.all([
      this.resolveGroupMemberRefs(params.memberIds, params.groupId),
      this.resolveGroupMemberRefs(params.paidByIds, params.groupId),
    ]);
    applyExpenseDimensionFilters(query, {
      categories: params.categories,
      transactionType: params.transactionType,
      member: memberRefs,
      paidBy: paidByRefs,
      minAmount: params.minAmount,
      maxAmount: params.maxAmount,
    });

    if (params.cursor) {
      // Keyset pagination must key on the same columns as the sort
      // (expenseDate DESC, createdAt DESC) — a bare `id < cursor` skips or
      // repeats rows because ids are not ordered by date.
      const cursorExpense = await this.expenseRepository.findOne({
        where: { id: params.cursor },
      });
      if (cursorExpense) {
        query.andWhere(
          '(expense.expenseDate < :cursorDate OR ' +
            '(expense.expenseDate = :cursorDate AND expense.createdAt < :cursorCreatedAt) OR ' +
            '(expense.expenseDate = :cursorDate AND expense.createdAt = :cursorCreatedAt AND expense.id < :cursorId))',
          {
            cursorDate: cursorExpense.expenseDate,
            cursorCreatedAt: cursorExpense.createdAt,
            cursorId: cursorExpense.id,
          },
        );
      }
    }

    // Snapshot the fully-filtered query for the scope-wide monetary totals
    // BEFORE ordering/pagination is applied, so the summary tiles reflect every
    // matching row rather than just the current page (see computeLedgerTotals).
    const totalsQuery = query.clone();

    const dir: 'ASC' | 'DESC' = params.sortOrder === 'asc' ? 'ASC' : 'DESC';
    if (params.sortBy === 'amount') {
      query
        .orderBy('expense.amountTotal', dir)
        .addOrderBy('expense.expenseDate', 'DESC')
        .addOrderBy('expense.id', 'DESC');
    } else {
      query
        .orderBy('expense.expenseDate', dir)
        .addOrderBy('expense.createdAt', dir)
        .addOrderBy('expense.id', 'DESC');
    }

    const total = await query.getCount();
    const expenses = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const [mapped, totals] = await Promise.all([
      this.batchMapExpenseResponses(expenses),
      this.computeLedgerTotals(totalsQuery),
    ]);

    const response = paginate(mapped, total, page, limit, '/api/v1/expenses', {
      groupId: params.groupId,
      status: params.status,
      startDate: params.startDate,
      endDate: params.endDate,
      cursor: params.cursor,
    });
    response.meta.totals = totals;
    return response;
  }

  /**
   * Sum amounts over an already-filtered expense query, grouped by currency and
   * split into expenses vs. refunds. Runs on the pre-pagination query so the
   * result is the true total for the whole filtered scope. Amounts are stored
   * in plaintext (only titles/descriptions are encrypted), so this is a plain
   * SQL aggregate.
   */
  private async computeLedgerTotals(
    filteredQuery: ReturnType<Repository<Expense>['createQueryBuilder']>,
  ): Promise<LedgerTotals[]> {
    const rows = await filteredQuery
      .select('expense.currency', 'currency')
      .addSelect('expense.transactionType', 'transactionType')
      .addSelect('SUM(expense.amountTotal)', 'sum')
      .groupBy('expense.currency')
      .addGroupBy('expense.transactionType')
      .getRawMany<{
        currency: string;
        transactionType: 'expense' | 'refund' | null;
        sum: string | number | null;
      }>();

    const byCurrency = new Map<
      string,
      { totalExpense: number; totalRefund: number }
    >();
    for (const row of rows) {
      const currency = row.currency;
      if (!currency) continue;
      const entry = byCurrency.get(currency) ?? {
        totalExpense: 0,
        totalRefund: 0,
      };
      const amount = Number(row.sum) || 0;
      if (row.transactionType === 'refund') {
        entry.totalRefund += amount;
      } else {
        entry.totalExpense += amount;
      }
      byCurrency.set(currency, entry);
    }

    return [...byCurrency.entries()].map(([currency, v]) => ({
      currency,
      totalExpense: v.totalExpense,
      totalRefund: v.totalRefund,
      net: v.totalExpense - v.totalRefund,
    }));
  }

  /** Get a single expense by ID. */
  async getExpenseById(
    userId: string,
    id: string,
  ): Promise<Record<string, unknown>> {
    const expense = await this.expenseRepository.findOne({
      where: { id },
      relations: [
        'paidByUser',
        'paidByGroupMember',
        'ownerUser',
        'group',
        'groupKeyVersion',
      ],
    });

    if (!expense) {
      throw new NotFoundException('Expense not found');
    }

    await this.ensureExpenseAccess(userId, expense, false);
    return this.mapExpenseResponse(expense);
  }

  /** Update an expense's fields and/or splits. */
  async updateExpense(
    userId: string,
    id: string,
    dto: UpdateExpenseDto,
  ): Promise<Record<string, unknown>> {
    const expense = await this.expenseRepository.findOne({
      where: { id },
      relations: [
        'paidByUser',
        'paidByGroupMember',
        'ownerUser',
        'group',
        'groupKeyVersion',
      ],
    });

    if (!expense) {
      throw new NotFoundException('Expense not found');
    }

    await this.ensureExpenseAccess(userId, expense, true);

    if (expense.version !== dto.version) {
      throw new PreconditionFailedException({
        errorCode: 'CON_VERSION_CONFLICT',
        message:
          'Version conflict: the resource has been modified by another request',
      });
    }

    if (
      (dto.amountTotal !== undefined || dto.currency !== undefined) &&
      dto.splits === undefined
    ) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message:
          'Updating amountTotal or currency requires providing updated splits',
      });
    }

    // Currency validation (group expenses)
    if (dto.currency !== undefined && expense.group) {
      const grp = await this.groupRepository.findOne({
        where: { id: expense.group.id },
      });
      if (
        grp &&
        grp.currency &&
        dto.currency.toUpperCase() !== grp.currency.toUpperCase()
      ) {
        throw new BadRequestException({
          errorCode: 'EXP_CURRENCY_MISMATCH',
          message: `Expense currency must match the group's base currency (${grp.currency})`,
        });
      }
    }

    // Re-dating a normal-group transaction must not move it into a locked
    // month. ensureExpenseAccess already validated the stored date's window;
    // this guards the *new* date. (Household groups use their own ledger rules.)
    if (
      dto.expenseDate !== undefined &&
      dto.expenseDate !== expense.expenseDate &&
      expense.group
    ) {
      const grp = await this.groupRepository.findOne({
        where: { id: expense.group.id },
      });
      if (grp && grp.groupType !== 'household') {
        this.assertWithinEditWindow(dto.expenseDate);
      }
    }

    if (dto.paidByUserId && dto.paidByGroupMemberId) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'Provide only one of paidByUserId or paidByGroupMemberId',
      });
    }
    if (dto.paidByGroupMemberId && !expense.group) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'paidByGroupMemberId is only valid for group expenses',
      });
    }
    if (dto.paidByUserId) {
      const paidByUser = await this.userRepository.findOne({
        where: { id: dto.paidByUserId },
      });
      if (!paidByUser) {
        throw new BadRequestException({
          errorCode: 'VAL_INVALID_INPUT',
          message: 'paidByUserId must reference an existing user',
        });
      }
      if (!expense.group && dto.paidByUserId !== userId) {
        throw new ForbiddenException(
          'Personal expenses must be paid by the authenticated user',
        );
      }
      if (expense.group) {
        // Frozen rule: a group expense's payer always resolves via
        // GroupMember — paidByUserId is accepted as client convenience and
        // resolved to its GroupMember row here, never persisted as
        // paidByUser for a group expense.
        const payerMember = await this.groupMemberRepository.findOne({
          where: {
            group: { id: expense.group.id },
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
        expense.paidByGroupMember = payerMember;
        expense.paidByUser = undefined;
      } else {
        expense.paidByUser = paidByUser;
        expense.paidByGroupMember = undefined;
      }
    } else if (dto.paidByGroupMemberId) {
      const payerMember = await this.groupMemberRepository.findOne({
        where: {
          id: dto.paidByGroupMemberId,
          group: { id: expense.group!.id },
          joinStatus: In(['active', 'invited']),
        },
      });
      if (!payerMember) {
        throw new BadRequestException({
          errorCode: 'VAL_INVALID_INPUT',
          message: 'paidByGroupMemberId must belong to the selected group',
        });
      }
      expense.paidByGroupMember = payerMember;
      expense.paidByUser = undefined;
    }

    const previousTitle = expense.title;
    if (dto.title !== undefined) expense.title = dto.title;
    if (dto.description !== undefined) expense.description = dto.description;
    if (dto.amountTotal !== undefined) expense.amountTotal = dto.amountTotal;
    if (dto.currency !== undefined)
      expense.currency = dto.currency.toUpperCase();
    if (dto.category !== undefined) expense.category = dto.category;
    if (dto.transactionType !== undefined)
      expense.transactionType = dto.transactionType;
    if (dto.expenseDate !== undefined) expense.expenseDate = dto.expenseDate;
    if (dto.status !== undefined) expense.status = dto.status;
    if (dto.encryptionScope !== undefined)
      expense.encryptionScope = dto.encryptionScope;

    const actorUser = await this.userRepository.findOne({
      where: { id: userId },
    });

    const validationSplits =
      dto.splits ??
      (
        await this.expenseSplitRepository.find({
          where: { expense: { id: expense.id } },
          relations: ['participantUser'],
        })
      ).map((split) => ({
        participantUserId: split.participantUser?.id,
        splitType: split.splitType,
        shareValue: Number(split.shareValue),
      }));

    this.validateExpenseEncryptionMetadata(
      userId,
      {
        ...dto,
        splits: validationSplits,
      },
      expense.group?.id,
    );

    if (dto.groupKeyVersionId && !expense.group) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'groupKeyVersionId is only valid for group expenses',
      });
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const replacedSplits =
        dto.splits !== undefined
          ? await manager.getRepository(ExpenseSplit).find({
              where: { expense: { id: expense.id } },
              relations: ['participantUser', 'participantGroupMember'],
            })
          : [];
      const replacedAttachments =
        dto.encryptedAttachments !== undefined ||
        dto.attachmentKeys !== undefined
          ? await manager.getRepository(Attachment).find({
              where: { expense: { id: expense.id } },
              relations: ['uploaderUser', 'groupKeyVersion'],
            })
          : [];

      if (expense.group && dto.groupKeyVersionId) {
        // Re-stamp to the version the client re-encrypted with; keeping the
        // old stamp after a post-rotation edit breaks decryption permanently.
        expense.groupKeyVersion = await this.resolveDeclaredGroupKeyVersion(
          expense.group,
          dto.groupKeyVersionId,
          manager,
        );
      } else if (expense.group && !expense.groupKeyVersion) {
        expense.groupKeyVersion = await this.getOrCreateActiveGroupKeyVersion(
          expense.group,
          manager,
        );
      }

      const savedExpense = await manager.getRepository(Expense).save(expense);

      if (dto.splits) {
        if (
          !expense.group &&
          dto.splits.some((split) => !!split.participantGroupMemberId)
        ) {
          throw new BadRequestException({
            errorCode: 'VAL_INVALID_INPUT',
            message:
              'Personal expenses cannot include participantGroupMemberId in splits',
          });
        }

        // Soft-delete: splits are ledger history (ARCHITECTURE §4.3) — the
        // replaced allocation stays queryable for audit/adjustment trails.
        await manager
          .getRepository(ExpenseSplit)
          .softDelete({ expense: { id: expense.id } as Partial<Expense> });
        await this.recordSplitVersions(
          manager,
          expense,
          replacedSplits,
          'replaced',
          actorUser,
        );
        const savedSplits = await this.persistSplits(
          expense,
          {
            splits: dto.splits,
            amountTotal: dto.amountTotal ?? Number(expense.amountTotal),
            paidByUserId: dto.paidByUserId ?? expense.paidByUser?.id,
            paidByGroupMemberId:
              dto.paidByGroupMemberId ?? expense.paidByGroupMember?.id,
            groupId: expense.group?.id,
          },
          manager,
        );
        await this.recordSplitVersions(
          manager,
          expense,
          savedSplits,
          'created',
          actorUser,
        );
      }

      // Keep the payer breakdown in sync. Only touch payments when a
      // payment-affecting field changed, so a note-only edit leaves them
      // untouched.
      const paymentsAffected =
        dto.payments !== undefined ||
        dto.amountTotal !== undefined ||
        dto.paidByUserId !== undefined ||
        dto.paidByGroupMemberId !== undefined;
      if (paymentsAffected) {
        if (dto.payments === undefined && dto.amountTotal !== undefined) {
          const activePaymentCount = await manager
            .getRepository(ExpensePayment)
            .count({ where: { expense: { id: expense.id } } });
          if (activePaymentCount > 1) {
            throw new BadRequestException({
              errorCode: 'VAL_INVALID_INPUT',
              message:
                'Editing the amount of a multi-payer expense requires providing payments',
            });
          }
        }
        await this.persistExpensePayments(
          expense,
          {
            amountTotal: Number(expense.amountTotal),
            groupId: expense.group?.id,
            primaryPaidByUser: expense.paidByUser,
            primaryPaidByGroupMember: expense.paidByGroupMember,
            payments: dto.payments,
          },
          manager,
        );
      }

      if (
        expense.encryptionScope === 'direct_shared' &&
        dto.wrappedContentKeys
      ) {
        await manager
          .getRepository(EncryptedExpenseKey)
          .delete({ expense: { id: expense.id } as Partial<Expense> });
        for (const wk of dto.wrappedContentKeys) {
          await manager.getRepository(EncryptedExpenseKey).save(
            manager.getRepository(EncryptedExpenseKey).create({
              expense,
              user: { id: wk.userId } as User,
              wrappedKey: wk.wrappedKey,
            }),
          );
        }
      }

      if (dto.encryptedAttachments) {
        await manager
          .getRepository(Attachment)
          .delete({ expense: { id: expense.id } as Partial<Expense> });
        await this.recordAttachmentVersions(
          manager,
          expense,
          replacedAttachments,
          'replaced',
          actorUser,
        );
        const savedAttachments: Attachment[] = [];
        for (const att of dto.encryptedAttachments) {
          const savedAttachment = await manager.getRepository(Attachment).save(
            manager.getRepository(Attachment).create({
              uploaderUser: expense.ownerUser,
              expense,
              storageKey: att.storageKey,
              originalName: 'encrypted',
              mimeType: att.mimeType,
              sizeBytes: String(att.sizeBytes),
              encryptedFileKey: att.encryptedFileKey,
              encryptedOriginalName: att.encryptedOriginalName,
            }),
          );
          savedAttachments.push(savedAttachment);
        }
        await this.recordAttachmentVersions(
          manager,
          expense,
          savedAttachments,
          'created',
          actorUser,
        );
      } else if (dto.attachmentKeys) {
        await manager
          .getRepository(Attachment)
          .delete({ expense: { id: expense.id } as Partial<Expense> });
        await this.recordAttachmentVersions(
          manager,
          expense,
          replacedAttachments,
          'replaced',
          actorUser,
        );
        const savedAttachments: Attachment[] = [];
        for (const key of dto.attachmentKeys) {
          const savedAttachment = await manager.getRepository(Attachment).save(
            manager.getRepository(Attachment).create({
              uploaderUser: expense.ownerUser,
              expense,
              storageKey: key,
              // ZK: never persist a plaintext filename — names live only in
              // encryptedOriginalName on the new attachment model.
              originalName: 'encrypted',
              mimeType: 'application/octet-stream',
              sizeBytes: '0',
            }),
          );
          savedAttachments.push(savedAttachment);
        }
        await this.recordAttachmentVersions(
          manager,
          expense,
          savedAttachments,
          'created',
          actorUser,
        );
      }

      await this.recordExpenseVersion(
        manager,
        savedExpense,
        'updated',
        actorUser,
      );

      return manager.getRepository(Expense).findOne({
        where: { id: expense.id },
        relations: [
          'paidByUser',
          'paidByGroupMember',
          'paidByGroupMember.user',
          'ownerUser',
          'group',
          'groupKeyVersion',
        ],
      });
    });

    if (!saved) {
      throw new NotFoundException('Expense not found after update');
    }

    // Write audit log (non-blocking)
    if (actorUser) {
      void this.writeAuditLog({
        actorUser,
        action: 'expense.updated',
        entityId: saved.id,
        groupId: expense.group?.id,
        metadata: {
          previousTitle,
          newTitle: saved.title,
          amountTotal: Number(saved.amountTotal),
        },
      });
    }

    return this.mapExpenseResponse(saved);
  }

  /**
   * Soft-delete an expense.
   * - Draft expenses are hard-deleted.
   * - Posted expenses are soft-deleted (deleted_at set, status → void).
   */
  async deleteExpense(userId: string, id: string): Promise<void> {
    const expense = await this.expenseRepository.findOne({
      where: { id },
      relations: [
        'paidByUser',
        'paidByGroupMember',
        'ownerUser',
        'group',
        'groupKeyVersion',
      ],
    });

    if (!expense) {
      throw new NotFoundException('Expense not found');
    }

    await this.ensureExpenseAccess(userId, expense, true);

    const actorUser = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (expense.status === 'draft') {
      await this.expenseRepository.delete({ id: expense.id });
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      const splits = await manager.getRepository(ExpenseSplit).find({
        where: { expense: { id: expense.id } },
        relations: ['participantUser', 'participantGroupMember'],
      });
      const attachments = await manager.getRepository(Attachment).find({
        where: { expense: { id: expense.id } },
        relations: ['uploaderUser', 'groupKeyVersion'],
      });

      // Soft-delete: mark deleted_at + void status
      expense.status = 'void';
      const deleted = await manager.getRepository(Expense).softRemove(expense);
      await this.recordExpenseVersion(manager, deleted, 'deleted', actorUser);
      await this.recordSplitVersions(
        manager,
        deleted,
        splits,
        'deleted',
        actorUser,
      );
      await this.recordAttachmentVersions(
        manager,
        deleted,
        attachments,
        'deleted',
        actorUser,
      );
    });

    // Write audit log (non-blocking)
    if (actorUser) {
      void this.writeAuditLog({
        actorUser,
        action: 'expense.deleted',
        entityId: expense.id,
        groupId: expense.group?.id,
        metadata: {
          title: expense.title,
          amountTotal: Number(expense.amountTotal),
          currency: expense.currency,
        },
      });
    }
  }

  /**
   * Restore a soft-deleted expense.
   *
   * Restore window: the expense must have been deleted within the current
   * calendar month OR within the first 7 days of the following month.
   */
  async restoreExpense(
    userId: string,
    id: string,
  ): Promise<Record<string, unknown>> {
    // withDeleted: true so we can find soft-deleted records
    const expense = await this.expenseRepository.findOne({
      where: { id },
      relations: [
        'paidByUser',
        'paidByGroupMember',
        'ownerUser',
        'group',
        'groupKeyVersion',
      ],
      withDeleted: true,
    });

    if (!expense) {
      throw new NotFoundException('Expense not found');
    }

    if (!expense.deletedAt) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message:
          'This expense has not been deleted and does not need restoring',
      });
    }

    // Verify the caller has write access to the group (or owns the personal expense)
    await this.ensureRestoreAccess(userId, expense);

    // ── Restore window check ─────────────────────────────────────────────────
    const now = new Date();
    const deletedAt = expense.deletedAt;
    const deletedMonth = new Date(
      deletedAt.getFullYear(),
      deletedAt.getMonth(),
      1,
    );
    // Grace period = last day of deletion month + 7 days
    const graceEnd = new Date(
      deletedAt.getFullYear(),
      deletedAt.getMonth() + 1,
      7,
      23,
      59,
      59,
    );

    if (now > graceEnd) {
      throw new ForbiddenException({
        errorCode: 'EXP_RESTORE_WINDOW',
        message: `Restore window has expired. Expenses can only be restored within the month of deletion plus 7 days (deadline was ${graceEnd.toISOString().slice(0, 10)})`,
      });
    }

    // Suppress unused variable warning
    void deletedMonth;

    const actorUser = await this.userRepository.findOne({
      where: { id: userId },
    });

    await this.dataSource.transaction(async (manager) => {
      // Restore: clear deleted_at and reset status to posted
      await manager.getRepository(Expense).restore({ id: expense.id });
      expense.status = 'posted';
      expense.deletedAt = undefined;
      const restoredExpense = await manager
        .getRepository(Expense)
        .save(expense);
      await this.recordExpenseVersion(
        manager,
        restoredExpense,
        'restored',
        actorUser,
      );
    });

    const restored = await this.expenseRepository.findOne({
      where: { id: expense.id },
      relations: [
        'paidByUser',
        'paidByGroupMember',
        'ownerUser',
        'group',
        'groupKeyVersion',
      ],
    });

    if (!restored) {
      throw new NotFoundException('Expense not found after restore');
    }

    // Write audit log (non-blocking)
    if (actorUser) {
      void this.writeAuditLog({
        actorUser,
        action: 'expense.restored',
        entityId: restored.id,
        groupId: expense.group?.id,
        metadata: { title: restored.title },
      });
    }

    return this.mapExpenseResponse(restored);
  }

  /** Check that the user can restore this expense (access check without write-lock enforcement). */
  private async ensureRestoreAccess(
    userId: string,
    expense: Expense,
  ): Promise<void> {
    if (!expense.group) {
      if (expense.ownerUser.id !== userId) {
        throw new ForbiddenException('You do not have access to this expense');
      }
      return;
    }

    const membership = await this.getGroupMembership(userId, expense.group.id);
    if (!membership) {
      throw new ForbiddenException('You do not have access to this expense');
    }
    if (membership.role === 'viewer') {
      throw new ForbiddenException('Viewers cannot restore expenses');
    }
    // Members can only restore their own; admins/owners can restore any
    if (membership.role === 'member' || membership.role === 'spectator') {
      if (expense.ownerUser.id !== userId) {
        throw new ForbiddenException(
          'Members can only restore their own expenses',
        );
      }
    }
  }

  // ─── Analytics ─────────────────────────────────────────────────────────────

  /**
   * Monthly expense summary: totals per month for a given year.
   * Only `posted` expenses are included.
   */
  async getMonthlySummary(
    filter: AnalyticsFilter & { year: number },
  ): Promise<MonthlyTotal[]> {
    const { userId, groupId, year } = filter;

    await this.assertGroupAccess(userId, groupId);

    // An explicit date range from the unified filter (e.g. "Last 6 Months")
    // overrides the year-wide window so the monthly bars match the selection.
    const startDate = filter.startDate ?? `${year}-01-01`;
    const endDate = filter.endDate ?? `${year}-12-31`;

    const dimensions = await this.resolveAnalyticsDimensions(filter);

    const expenses = await this.buildBaseAnalyticsQuery(
      userId,
      groupId,
      startDate,
      endDate,
      dimensions,
    )
      .select([
        'expense.id',
        'expense.expenseDate',
        'expense.amountTotal',
        'expense.transactionType',
        'expense.currency',
      ])
      .getMany();

    const groups = new Map<string, { total: number; currency: string }>();
    for (const exp of expenses) {
      const month = exp.expenseDate.slice(0, 7); // YYYY-MM
      const key = `${month}_${exp.currency}`;
      const existing = groups.get(key) || { total: 0, currency: exp.currency };
      existing.total += this.signedAmount(exp.amountTotal, exp.transactionType);
      groups.set(key, existing);
    }

    const results: MonthlyTotal[] = [];
    for (const [key, val] of groups.entries()) {
      const month = key.split('_')[0];
      results.push({
        month,
        total: Math.round(val.total * 100) / 100,
        currency: val.currency,
      });
    }

    return results.sort((a, b) => a.month.localeCompare(b.month));
  }

  /**
   * Yearly expense summary: totals per year across all years.
   * Only `posted` expenses are included.
   */
  async getYearlySummary(filter: AnalyticsFilter): Promise<MonthlyTotal[]> {
    const { userId, groupId } = filter;

    await this.assertGroupAccess(userId, groupId);

    const dimensions = await this.resolveAnalyticsDimensions(filter);

    const expenses = await this.buildBaseAnalyticsQuery(
      userId,
      groupId,
      filter.startDate,
      filter.endDate,
      dimensions,
    )
      .select([
        'expense.id',
        'expense.expenseDate',
        'expense.amountTotal',
        'expense.transactionType',
        'expense.currency',
      ])
      .getMany();

    const groups = new Map<string, { total: number; currency: string }>();
    for (const exp of expenses) {
      const year = exp.expenseDate.slice(0, 4); // YYYY
      const key = `${year}_${exp.currency}`;
      const existing = groups.get(key) || { total: 0, currency: exp.currency };
      existing.total += this.signedAmount(exp.amountTotal, exp.transactionType);
      groups.set(key, existing);
    }

    const results: MonthlyTotal[] = [];
    for (const [key, val] of groups.entries()) {
      const year = key.split('_')[0];
      results.push({
        month: year,
        total: Math.round(val.total * 100) / 100,
        currency: val.currency,
      });
    }

    return results.sort((a, b) => a.month.localeCompare(b.month));
  }

  /**
   * Category distribution: totals per category.
   * Only `posted` expenses are included.
   */
  async getCategoryDistribution(
    filter: AnalyticsFilter,
  ): Promise<CategoryTotal[]> {
    const { userId, groupId, startDate, endDate } = filter;

    await this.assertGroupAccess(userId, groupId);

    const dimensions = await this.resolveAnalyticsDimensions(filter);

    const expenses = await this.buildBaseAnalyticsQuery(
      userId,
      groupId,
      startDate,
      endDate,
      dimensions,
    )
      .select([
        'expense.id',
        'expense.category',
        'expense.amountTotal',
        'expense.transactionType',
        'expense.currency',
      ])
      .getMany();

    const groups = new Map<string, { total: number; currency: string }>();
    for (const exp of expenses) {
      const key = `${exp.category}_${exp.currency}`;
      const existing = groups.get(key) || { total: 0, currency: exp.currency };
      existing.total += this.signedAmount(exp.amountTotal, exp.transactionType);
      groups.set(key, existing);
    }

    const results: CategoryTotal[] = [];
    for (const [key, val] of groups.entries()) {
      const category = key.split('_')[0];
      results.push({
        category,
        total: Math.round(val.total * 100) / 100,
        currency: val.currency,
      });
    }

    return results.sort((a, b) => b.total - a.total);
  }

  private buildBaseAnalyticsQuery(
    userId: string,
    groupId?: string,
    startDate?: string,
    endDate?: string,
    dimensions?: GroupExpenseDimensionFilters,
  ) {
    const query = this.expenseRepository
      .createQueryBuilder('expense')
      .leftJoin('expense.ownerUser', 'ownerUser')
      .leftJoin('expense.group', 'group')
      .where('expense.status = :status', { status: 'posted' })
      .andWhere('expense.deleted_at IS NULL');

    if (groupId) {
      query.andWhere('group.id = :groupId', { groupId });
    } else {
      query.andWhere('ownerUser.id = :userId AND group.id IS NULL', { userId });
    }

    if (startDate) {
      query.andWhere('expense.expense_date >= :startDate', { startDate });
    }
    if (endDate) {
      query.andWhere('expense.expense_date <= :endDate', { endDate });
    }

    if (dimensions) {
      applyExpenseDimensionFilters(query, dimensions);
    }

    return query;
  }

  /**
   * Resolve the unified filter's member/payer ids and pack the shared
   * expense-dimension filters for the analytics query builder.
   */
  private async resolveAnalyticsDimensions(
    filter: AnalyticsFilter,
  ): Promise<GroupExpenseDimensionFilters> {
    const [member, paidBy] = await Promise.all([
      this.resolveGroupMemberRefs(filter.memberIds, filter.groupId),
      this.resolveGroupMemberRefs(filter.paidByIds, filter.groupId),
    ]);
    return {
      categories: filter.categories,
      transactionType: filter.transactionType,
      member,
      paidBy,
      minAmount: filter.minAmount,
      maxAmount: filter.maxAmount,
    };
  }

  /**
   * Resolve a group-member id (as sent by the member/payer filter dropdowns)
   * to both identifiers it can appear under in expense/split rows: its own id
   * and the backing registered user's id (null for pending, Contact-backed
   * members). Returns undefined when the id is not a member of the group, so
   * the filter is simply skipped rather than matching nothing by accident.
   */
  /**
   * Resolve a set of group-member ids (from the member/payer pickers) to the
   * pair of identifiers each can appear under — its own id and the backing
   * registered user's id (null for pending, Contact-backed members). Ids that
   * aren't members of the group are dropped, so the filter simply ignores them.
   */
  private async resolveGroupMemberRefs(
    groupMemberIds: string[] | undefined,
    groupId?: string,
  ): Promise<MemberRef[]> {
    if (!groupMemberIds?.length || !groupId || groupId === 'personal') {
      return [];
    }
    const members = await this.groupMemberRepository.find({
      where: { id: In(groupMemberIds), group: { id: groupId } },
      relations: ['user'],
    });
    return members.map((m) => ({
      groupMemberId: m.id,
      userId: m.user?.id ?? null,
    }));
  }

  private async assertGroupAccess(
    userId: string,
    groupId?: string,
  ): Promise<void> {
    if (!groupId) return;
    const membership = await this.getGroupMembership(userId, groupId);
    if (!membership) {
      throw new ForbiddenException('You do not have access to this group');
    }
  }

  /** Resolves a GroupMember to its display identity (registered or pending). */
  private carryForwardMemberDisplay(m: GroupMember): {
    groupMemberId: string;
    userId: string | null;
    displayName: string;
  } {
    const { groupMemberId, userId, displayName } = resolveMemberDisplay(m);
    return { groupMemberId, userId, displayName };
  }

  /**
   * Household carry-forward summary: net extra-paid balance per member for a given month.
   * Only applies to `household` group type.
   */
  async getCarryForwardSummary(
    userId: string,
    groupId: string,
    ledgerMonth: string,
  ): Promise<
    {
      groupMemberId: string;
      userId: string | null;
      displayName: string | null;
      netBalance: number;
      currency: string;
      paid: number;
      expected: number;
      percentage: number;
      currentMonthNet: number;
      carryForwardNet: number;
      openingBalance: number;
      closingBalance: number;
      overallBalance: number;
    }[]
  > {
    await this.assertGroupAccess(userId, groupId);

    const group = await this.groupRepository.findOne({
      where: { id: groupId },
    });
    if (!group) throw new NotFoundException('Group not found');
    if (group.groupType !== 'household') {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'Carry-forward summary is only available for household groups',
      });
    }

    // Get all posted expenses for the ledger month
    const expenses = await this.expenseRepository.find({
      where: { group: { id: groupId }, ledgerMonth, status: 'posted' },
      relations: ['paidByUser', 'paidByGroupMember', 'ownerUser'],
      withDeleted: false,
    });

    const activeMembers = await this.groupMemberRepository.find({
      where: { group: { id: groupId }, joinStatus: 'active' },
      relations: ['user', 'contact'],
    });

    // Resolves a User-keyed payer/participant reference (legacy rows) to its
    // current GroupMember.id — the frozen group-ledger identity always keys
    // by GroupMember, never User, going forward.
    const memberIdByUserId = new Map<string, string>();
    for (const m of activeMembers) {
      if (m.user) memberIdByUserId.set(m.user.id, m.id);
    }
    const resolveMemberKey = (opts: {
      groupMember?: GroupMember;
      user?: User;
    }): string | undefined => {
      if (opts.groupMember) return opts.groupMember.id;
      if (opts.user) return memberIdByUserId.get(opts.user.id);
      return undefined;
    };

    const carryExpenses = expenses.filter((exp) => exp.isCarryForward);
    const normalExpenses = expenses.filter((exp) => !exp.isCarryForward);

    // Compute net monthly spending S from normal expenses only. A refund is a
    // negative expense, so it reduces both group spending and the recipient's
    // net paid amount (signedAmount handles the sign).
    const S = normalExpenses.reduce(
      (sum, exp) =>
        sum + this.signedAmount(exp.amountTotal, exp.transactionType),
      0,
    );

    // Compute normal net paid amounts per active member (registered or
    // pending). For a refund the payer field holds the member who *received*
    // the returned money, so signedAmount subtracts it from their net paid.
    const paidMap = new Map<string, number>();
    for (const member of activeMembers) {
      paidMap.set(member.id, 0);
    }
    for (const exp of normalExpenses) {
      const memberId = resolveMemberKey({
        groupMember: exp.paidByGroupMember,
        user: exp.paidByUser,
      });
      if (!memberId) continue;
      paidMap.set(
        memberId,
        (paidMap.get(memberId) ?? 0) +
          this.signedAmount(exp.amountTotal, exp.transactionType),
      );
    }

    // Look up monthly contribution percentages
    const contributions = await this.dataSource
      .getRepository(GroupMemberContribution)
      .createQueryBuilder('contribution')
      .innerJoinAndSelect('contribution.groupMember', 'groupMember')
      .where('groupMember.group_id = :groupId', { groupId })
      .andWhere('contribution.ledgerMonth = :ledgerMonth', { ledgerMonth })
      .getMany();

    const contributionMap = new Map<string, number>();
    for (const c of contributions) {
      contributionMap.set(c.groupMember.id, Number(c.percentage));
    }

    const currency = group.currency;

    if (activeMembers.length === 0) {
      return [];
    }

    // Load splits for carry forward expenses to adjust targets
    const carryExpenseIds = carryExpenses.map((e) => e.id);
    const carrySplits = carryExpenseIds.length
      ? await this.expenseSplitRepository.find({
          where: { expense: { id: In(carryExpenseIds) } },
          relations: ['expense', 'participantUser', 'participantGroupMember'],
        })
      : [];

    const carryOwedMap = new Map<string, number>();
    const carryPaidMap = new Map<string, number>();

    for (const member of activeMembers) {
      carryOwedMap.set(member.id, 0);
      carryPaidMap.set(member.id, 0);
    }

    for (const exp of carryExpenses) {
      const payerId = resolveMemberKey({
        groupMember: exp.paidByGroupMember,
        user: exp.paidByUser,
      });
      if (!payerId) continue;
      carryPaidMap.set(
        payerId,
        (carryPaidMap.get(payerId) ?? 0) +
          this.signedAmount(exp.amountTotal, exp.transactionType),
      );
    }

    for (const split of carrySplits) {
      const participantId = resolveMemberKey({
        groupMember: split.participantGroupMember,
        user: split.participantUser,
      });
      if (participantId) {
        carryOwedMap.set(
          participantId,
          (carryOwedMap.get(participantId) ?? 0) +
            this.signedAmount(split.amountOwed, split.expense?.transactionType),
        );
      }
    }

    // ── Running carry-forward balance (computed; close-month-independent) ──
    // A household ledger is a running balance: each month's Opening is the
    // cumulative Closing of every prior month. We compute that here directly
    // from NORMAL expenses grouped by ledgerMonth — deliberately ignoring
    // materialized `isCarryForward` rollover expenses, which would double-count
    // (closeMonth never deletes the originals). This makes Opening reflect prior
    // months *without* requiring a manual month-close, and keeps Overall a
    // full-history figure independent of the month being viewed.
    const openingByMember = new Map<string, number>();
    const overallByMember = new Map<string, number>();
    {
      const allExpenses = await this.expenseRepository.find({
        where: { group: { id: groupId }, status: 'posted' },
        relations: ['paidByUser', 'paidByGroupMember'],
      });
      const allNormalExpenses = allExpenses.filter((e) => !e.isCarryForward);

      const allContributions = await this.dataSource
        .getRepository(GroupMemberContribution)
        .createQueryBuilder('contribution')
        .innerJoinAndSelect('contribution.groupMember', 'groupMember')
        .where('groupMember.group_id = :groupId', { groupId })
        .getMany();

      // month -> total signed spend (S) and month -> member -> signed paid
      const monthSpend = new Map<string, number>();
      const monthPaid = new Map<string, Map<string, number>>();
      const months = new Set<string>();
      for (const exp of allNormalExpenses) {
        const key =
          exp.ledgerMonth ??
          (exp.expenseDate ? exp.expenseDate.slice(0, 7) : ledgerMonth);
        months.add(key);
        const signed = this.signedAmount(exp.amountTotal, exp.transactionType);
        monthSpend.set(key, (monthSpend.get(key) ?? 0) + signed);
        const memberId = resolveMemberKey({
          groupMember: exp.paidByGroupMember,
          user: exp.paidByUser,
        });
        if (!memberId) continue;
        let pm = monthPaid.get(key);
        if (!pm) {
          pm = new Map();
          monthPaid.set(key, pm);
        }
        pm.set(memberId, (pm.get(memberId) ?? 0) + signed);
      }

      // month -> member -> contribution %
      const monthPct = new Map<string, Map<string, number>>();
      for (const c of allContributions) {
        months.add(c.ledgerMonth);
        let cm = monthPct.get(c.ledgerMonth);
        if (!cm) {
          cm = new Map();
          monthPct.set(c.ledgerMonth, cm);
        }
        cm.set(c.groupMember.id, Number(c.percentage));
      }

      const equalPct =
        activeMembers.length > 0 ? 100 / activeMembers.length : 0;
      // net(member, month) = paid − target, using that month's own % (or equal
      // split when unset) — identical basis to the selected-month currentMonthNet.
      const netFor = (memberId: string, month: string): number => {
        const s = monthSpend.get(month) ?? 0;
        const pct = monthPct.get(month)?.get(memberId) ?? equalPct;
        const paid = monthPaid.get(month)?.get(memberId) ?? 0;
        return paid - s * (pct / 100);
      };

      for (const member of activeMembers) {
        let opening = 0;
        let overall = 0;
        for (const month of months) {
          const net = netFor(member.id, month);
          overall += net;
          if (month < ledgerMonth) opening += net; // strictly prior months
        }
        openingByMember.set(member.id, opening);
        overallByMember.set(member.id, overall);
      }
    }

    return activeMembers.map((m) => {
      const pct = contributionMap.get(m.id) ?? 100 / activeMembers.length;
      const TuNormal = S * (pct / 100);
      const PuNormal = paidMap.get(m.id) ?? 0;

      const carryPaid = carryPaidMap.get(m.id) ?? 0;
      const carryOwed = carryOwedMap.get(m.id) ?? 0;

      const Pu = PuNormal + carryPaid;
      const Tu = TuNormal + carryOwed;

      const display = this.carryForwardMemberDisplay(m);

      // Running-balance decomposition for the Balance Breakdown card:
      // opening (all prior months) + currentMonthNet (this month) = closing,
      // and overall is the full-history running balance (month-independent).
      const currentMonthNet = Math.round((PuNormal - TuNormal) * 100) / 100;
      const openingBalance =
        Math.round((openingByMember.get(m.id) ?? 0) * 100) / 100;
      const overallBalance =
        Math.round((overallByMember.get(m.id) ?? 0) * 100) / 100;
      const closingBalance =
        Math.round((openingBalance + currentMonthNet) * 100) / 100;

      return {
        groupMemberId: display.groupMemberId,
        userId: display.userId,
        displayName: display.displayName,
        netBalance: Math.round((Pu - Tu) * 100) / 100,
        currency,
        paid: Math.round(Pu * 100) / 100,
        expected: Math.round(Tu * 100) / 100,
        percentage: pct,
        currentMonthNet,
        // Materialized-rollover net (from isCarryForward expenses). Retained for
        // reference; the breakdown now uses the computed openingBalance instead.
        carryForwardNet: Math.round((carryPaid - carryOwed) * 100) / 100,
        openingBalance,
        closingBalance,
        overallBalance,
      };
    });
  }

  /**
   * Per-member paid / expected / net over a set of normal (non-carry-forward)
   * expenses, using each expense's ledgerMonth contribution %. Pure aggregation
   * shared by the range-aware household summary for its opening / period / overall
   * partitions.
   */
  private householdNetByMember(
    expenses: Expense[],
    monthPct: Map<string, Map<string, number>>,
    activeMembers: GroupMember[],
    resolveKey: (o: {
      groupMember?: GroupMember;
      user?: User;
    }) => string | undefined,
    equalPct: number,
  ): Map<string, { paid: number; expected: number; net: number }> {
    const monthS = new Map<string, number>();
    const monthPaid = new Map<string, Map<string, number>>();
    for (const exp of expenses) {
      const m =
        exp.ledgerMonth ?? (exp.expenseDate ? exp.expenseDate.slice(0, 7) : '');
      const signed = this.signedAmount(exp.amountTotal, exp.transactionType);
      monthS.set(m, (monthS.get(m) ?? 0) + signed);
      const memberId = resolveKey({
        groupMember: exp.paidByGroupMember,
        user: exp.paidByUser,
      });
      if (!memberId) continue;
      let pm = monthPaid.get(m);
      if (!pm) {
        pm = new Map();
        monthPaid.set(m, pm);
      }
      pm.set(memberId, (pm.get(memberId) ?? 0) + signed);
    }
    const out = new Map<
      string,
      { paid: number; expected: number; net: number }
    >();
    for (const member of activeMembers) {
      let paid = 0;
      let expected = 0;
      for (const [m, s] of monthS) {
        const pct = monthPct.get(m)?.get(member.id) ?? equalPct;
        expected += s * (pct / 100);
        paid += monthPaid.get(m)?.get(member.id) ?? 0;
      }
      out.set(member.id, { paid, expected, net: paid - expected });
    }
    return out;
  }

  /**
   * Range-aware household summary that drives the UI (contribution graph, period
   * Balance card, household suggested settlements). Unlike getCarryForwardSummary
   * (single ledgerMonth, used by closeMonth), this honors the shared TimeScope:
   * `paid`/`expected`/`netBalance` aggregate the FILTERED DATE RANGE (all months
   * within it), `openingBalance` is everything before the range start, and
   * `overallBalance` is the full-history running balance (filter-independent).
   * Computed from normal expenses only (materialized rollovers are ignored to
   * avoid double-counting). Non-date dimensions are intentionally NOT applied —
   * "target vs actual contribution" is defined over total household spend.
   */
  async getHouseholdScopeSummary(
    userId: string,
    groupId: string,
    filter: RawGroupExpenseFilter,
  ): Promise<
    {
      groupMemberId: string;
      userId: string | null;
      displayName: string | null;
      netBalance: number;
      currency: string;
      paid: number;
      expected: number;
      percentage: number;
      currentMonthNet: number;
      carryForwardNet: number;
      openingBalance: number;
      closingBalance: number;
      overallBalance: number;
    }[]
  > {
    await this.assertGroupAccess(userId, groupId);
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
    });
    if (!group) throw new NotFoundException('Group not found');
    if (group.groupType !== 'household') {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'Household summary is only available for household groups',
      });
    }

    const activeMembers = await this.groupMemberRepository.find({
      where: { group: { id: groupId }, joinStatus: 'active' },
      relations: ['user', 'contact'],
    });
    const currency = group.currency;
    if (activeMembers.length === 0) return [];

    const memberIdByUserId = new Map<string, string>();
    for (const m of activeMembers) {
      if (m.user) memberIdByUserId.set(m.user.id, m.id);
    }
    const resolveKey = (opts: {
      groupMember?: GroupMember;
      user?: User;
    }): string | undefined => {
      if (opts.groupMember) return opts.groupMember.id;
      if (opts.user) return memberIdByUserId.get(opts.user.id);
      return undefined;
    };
    const equalPct = 100 / activeMembers.length;

    const allExpenses = await this.expenseRepository.find({
      where: { group: { id: groupId }, status: 'posted' },
      relations: ['paidByUser', 'paidByGroupMember'],
    });
    const normal = allExpenses.filter((e) => !e.isCarryForward);

    const contributions = await this.dataSource
      .getRepository(GroupMemberContribution)
      .createQueryBuilder('contribution')
      .innerJoinAndSelect('contribution.groupMember', 'groupMember')
      .where('groupMember.group_id = :groupId', { groupId })
      .getMany();
    const monthPct = new Map<string, Map<string, number>>();
    for (const c of contributions) {
      let cm = monthPct.get(c.ledgerMonth);
      if (!cm) {
        cm = new Map();
        monthPct.set(c.ledgerMonth, cm);
      }
      cm.set(c.groupMember.id, Number(c.percentage));
    }

    const { from, to } = filter;
    const periodExpenses =
      from || to
        ? normal.filter(
            (e) =>
              !!e.expenseDate &&
              (!from || e.expenseDate >= from) &&
              (!to || e.expenseDate <= to),
          )
        : normal;
    const openingExpenses = from
      ? normal.filter((e) => !!e.expenseDate && e.expenseDate < from)
      : [];

    const periodBy = this.householdNetByMember(
      periodExpenses,
      monthPct,
      activeMembers,
      resolveKey,
      equalPct,
    );
    const openingBy = this.householdNetByMember(
      openingExpenses,
      monthPct,
      activeMembers,
      resolveKey,
      equalPct,
    );
    const overallBy = this.householdNetByMember(
      normal,
      monthPct,
      activeMembers,
      resolveKey,
      equalPct,
    );

    // Effective contribution % over the period (weighted by monthly spend),
    // purely for the graph's "(x%)" hint — falls back to an equal split.
    const periodTotalExpected = Array.from(periodBy.values()).reduce(
      (sum, v) => sum + v.expected,
      0,
    );
    const r2 = (n: number) => Math.round(n * 100) / 100;

    return activeMembers.map((m) => {
      const period = periodBy.get(m.id) ?? { paid: 0, expected: 0, net: 0 };
      const opening = openingBy.get(m.id)?.net ?? 0;
      const overall = overallBy.get(m.id)?.net ?? 0;
      const display = this.carryForwardMemberDisplay(m);
      const percentage =
        periodTotalExpected > 0
          ? r2((period.expected / periodTotalExpected) * 100)
          : equalPct;
      return {
        groupMemberId: display.groupMemberId,
        userId: display.userId,
        displayName: display.displayName,
        netBalance: r2(period.net),
        currency,
        paid: r2(period.paid),
        expected: r2(period.expected),
        percentage,
        currentMonthNet: r2(period.net),
        carryForwardNet: r2(opening),
        openingBalance: r2(opening),
        closingBalance: r2(opening + period.net),
        overallBalance: r2(overall),
      };
    });
  }

  private simplifyDebts(
    balances: { groupMemberId: string; balance: number }[],
    currency: string,
  ): {
    fromGroupMemberId: string;
    toGroupMemberId: string;
    amount: number;
    currency: string;
  }[] {
    return simplifyLedgerDebts(
      balances.map((b) => ({ key: b.groupMemberId, balance: b.balance })),
      currency,
    ).map((t) => ({
      fromGroupMemberId: t.fromKey,
      toGroupMemberId: t.toKey,
      amount: t.amount,
      currency: t.currency,
    }));
  }

  async closeMonth(
    userId: string,
    groupId: string,
    ledgerMonth: string,
  ): Promise<{ nextLedgerMonth: string; carryForwardExpenseCount: number }> {
    // 1. Verify access: caller must have active membership and role owner or admin
    const callerMember = await this.groupMemberRepository.findOne({
      where: {
        group: { id: groupId },
        user: { id: userId },
        joinStatus: 'active',
      },
      relations: ['user'],
    });
    if (
      !callerMember ||
      (callerMember.role !== 'owner' && callerMember.role !== 'admin')
    ) {
      throw new ForbiddenException(
        'Only owners and admins can close a billing month',
      );
    }

    const group = await this.groupRepository.findOne({
      where: { id: groupId },
    });
    if (!group) throw new NotFoundException('Group not found');
    if (group.groupType !== 'household') {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'Month finalization is only available for household groups',
      });
    }

    const currentMonth = this.toYearMonth();
    if (ledgerMonth > currentMonth) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: 'Cannot close a future billing month',
      });
    }

    const [yearStr, monthStr] = ledgerMonth.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const nextDate = new Date(year, month, 1);
    const nextLedgerMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;

    // Verify duplicate closure
    const existingCarryForward = await this.expenseRepository.count({
      where: {
        group: { id: groupId },
        ledgerMonth: nextLedgerMonth,
        isCarryForward: true,
      },
    });
    if (existingCarryForward > 0) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: `Month ${ledgerMonth} is already closed/rolled over`,
      });
    }

    let carryForwardExpenseCount = 0;

    if (group.carryForwardEnabled) {
      const summary = await this.getCarryForwardSummary(
        userId,
        groupId,
        ledgerMonth,
      );
      const balances = summary.map((s) => ({
        groupMemberId: s.groupMemberId,
        balance: s.netBalance,
      }));

      const simplified = this.simplifyDebts(balances, group.currency);
      carryForwardExpenseCount = simplified.length;

      if (simplified.length > 0) {
        await this.dataSource.transaction(async (manager) => {
          for (const tx of simplified) {
            const debtorMember = await manager
              .getRepository(GroupMember)
              .findOne({ where: { id: tx.fromGroupMemberId } });
            const creditorMember = await manager
              .getRepository(GroupMember)
              .findOne({ where: { id: tx.toGroupMemberId } });
            if (!debtorMember || !creditorMember) continue;

            // Frozen rule: inside a group ledger, payer/participant always
            // resolve to GroupMember — mirrors createExpense()'s write path.
            const expense = manager.create(Expense, {
              title: `Carry-Forward from ${ledgerMonth}`,
              description: `System-generated carry-forward balance rollover`,
              amountTotal: tx.amount,
              currency: group.currency,
              category: 'Other',
              paidByGroupMember: creditorMember,
              ownerUser: callerMember.user,
              group,
              expenseDate: `${nextLedgerMonth}-01`,
              ledgerMonth: nextLedgerMonth,
              isCarryForward: true,
              status: 'posted',
            });
            const savedExpense = await manager.save(Expense, expense);

            const split = manager.create(ExpenseSplit, {
              expense: savedExpense,
              participantGroupMember: debtorMember,
              splitType: 'fixed',
              shareValue: tx.amount,
              amountOwed: tx.amount,
              isSettled: false,
            });
            await manager.save(ExpenseSplit, split);
          }
        });
      }
    }

    // Write audit log
    void this.writeAuditLog({
      actorUser: callerMember.user,
      action: 'group.month_closed',
      entityId: groupId,
      groupId,
      metadata: { ledgerMonth, nextLedgerMonth, carryForwardExpenseCount },
    });

    return { nextLedgerMonth, carryForwardExpenseCount };
  }

  /**
   * List soft-deleted expenses (for group history / restore UI).
   * Returns only expenses with deletedAt set, within the given group.
   */
  async listDeletedExpenses(
    userId: string,
    groupId: string,
    page: number,
    limit: number,
    filter?: RawGroupExpenseFilter,
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    await this.assertGroupAccess(userId, groupId);

    const p = page > 0 ? page : 1;
    const l = limit > 0 ? limit : 20;

    // Use createQueryBuilder with withDeleted so we can filter to only soft-deleted rows
    const query = this.expenseRepository
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.paidByUser', 'paidByUser')
      .leftJoinAndSelect('expense.ownerUser', 'ownerUser')
      .leftJoinAndSelect('expense.group', 'group')
      .leftJoinAndSelect('expense.paidByGroupMember', 'paidByGroupMember')
      .where('group.id = :groupId', { groupId })
      .andWhere('expense.deletedAt IS NOT NULL')
      .withDeleted();

    // The unified group filter applies here too (trash rows are expenses).
    if (filter?.from) {
      query.andWhere('expense.expenseDate >= :trashFrom', {
        trashFrom: filter.from,
      });
    }
    if (filter?.to) {
      query.andWhere('expense.expenseDate <= :trashTo', { trashTo: filter.to });
    }
    const [member, paidBy] = await Promise.all([
      this.resolveGroupMemberRefs(filter?.memberIds, groupId),
      this.resolveGroupMemberRefs(filter?.paidByIds, groupId),
    ]);
    applyExpenseDimensionFilters(query, {
      categories: filter?.categories,
      transactionType: filter?.transactionType,
      member,
      paidBy,
      minAmount: filter?.minAmount,
      maxAmount: filter?.maxAmount,
    });

    query.orderBy('expense.deletedAt', 'DESC');

    const total = await query.getCount();
    const expenses = await query
      .skip((p - 1) * l)
      .take(l)
      .getMany();

    const mapped = await Promise.all(
      expenses.map((e) => this.mapExpenseResponse(e)),
    );
    return paginate(
      mapped,
      total,
      p,
      l,
      `/api/v1/groups/${groupId}/expenses/deleted`,
      {},
    );
  }

  /**
   * Returns the append-only version history for a single expense.
   * The caller must be the expense owner or an active member of the expense's group.
   * Read-only — no mutation. Restore is out of scope for v2.
   */
  async getExpenseVersionHistory(
    userId: string,
    expenseId: string,
  ): Promise<Record<string, unknown>[]> {
    const expense = await this.expenseRepository.findOne({
      where: { id: expenseId },
      relations: ['ownerUser', 'group'],
      withDeleted: true,
    });
    if (!expense) {
      throw new NotFoundException('Expense not found');
    }

    // Authorize: owner OR active group member
    const isOwner = expense.ownerUser?.id === userId;
    if (!isOwner && expense.group) {
      const membership = await this.groupMemberRepository.findOne({
        where: {
          group: { id: expense.group.id },
          user: { id: userId },
          joinStatus: 'active',
        },
      });
      if (!membership) {
        throw new ForbiddenException('You do not have access to this expense');
      }
    } else if (!isOwner) {
      throw new ForbiddenException('You do not have access to this expense');
    }

    const versions = await this.dataSource
      .getRepository(ExpenseVersion)
      .createQueryBuilder('v')
      .leftJoinAndSelect('v.actorUser', 'actor')
      .where('v.expense_id = :expenseId', { expenseId })
      .orderBy('v.createdAt', 'ASC')
      .getMany();

    return versions.map((v, i) => ({
      id: v.id,
      versionNumber: i + 1,
      entityVersion: v.entityVersion,
      action: v.action,
      actorUserId: v.actorUser?.id ?? null,
      actorDisplayName:
        v.actorUser?.displayName ?? v.actorUser?.email ?? 'System',
      createdAt: v.createdAt,
      snapshot: v.snapshot,
    }));
  }

  /**
   * Returns the calling user's full expense picture:
   *  - Personal expenses (group IS NULL, owned by the user)
   *  - Group shares    (expenses where the user has an ExpenseSplit entry)
   *
   * No expense is duplicated. Each item carries `expenseType` and `myShare`
   * so the UI can display the user's actual liability without showing the full
   * group amount.
   */
  async listMyExpenses(
    userId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    const p = page > 0 ? page : 1;
    const l = limit > 0 ? limit : 20;

    // ── 1. Personal expenses ───────────────────────────────────────────────
    const personalExpenses = await this.expenseRepository
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.paidByUser', 'paidByUser')
      .leftJoinAndSelect('expense.ownerUser', 'ownerUser')
      .leftJoinAndSelect('expense.groupKeyVersion', 'gkv')
      .where('expense.group IS NULL')
      .andWhere('ownerUser.id = :userId', { userId })
      .andWhere('expense.deletedAt IS NULL')
      .getMany();

    // ── 2. Group shares via ExpenseSplit ────────────────────────────────────
    // Household groups are excluded here: their expenses are contribution
    // tracking, not cost-sharing, so personal spending is the amount the member
    // actually PAID (attributed in step 2b), never their equal-split share.
    const groupSplits = await this.expenseSplitRepository
      .createQueryBuilder('split')
      .innerJoinAndSelect('split.expense', 'expense')
      .leftJoinAndSelect('expense.paidByUser', 'paidByUser')
      .leftJoinAndSelect('expense.paidByGroupMember', 'paidByGroupMember')
      .leftJoinAndSelect('paidByGroupMember.user', 'paidByGroupMemberUser')
      .leftJoinAndSelect(
        'paidByGroupMember.contact',
        'paidByGroupMemberContact',
      )
      .leftJoinAndSelect('expense.group', 'group')
      .leftJoinAndSelect('expense.groupKeyVersion', 'gkv')
      .leftJoin('split.participantGroupMember', 'groupMember')
      .where('expense.deletedAt IS NULL')
      .andWhere("(group.id IS NULL OR group.group_type != 'household')")
      .andWhere(
        '(split.participantUser = :userId OR groupMember.user_id = :userId)',
        { userId },
      )
      .getMany();

    // ── 2b. Household spending via the PAYER (not splits) ────────────────────
    // For a household expense the payer's personal spending is the full amount
    // they paid; non-payers contribute nothing to their own dashboard. Refunds
    // carry through amountTotal's sign via the payer field, as elsewhere.
    const householdPaid = await this.expenseRepository
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.paidByUser', 'paidByUser')
      .leftJoinAndSelect('expense.paidByGroupMember', 'paidByGroupMember')
      .leftJoinAndSelect('paidByGroupMember.user', 'pgmUser')
      .leftJoinAndSelect('paidByGroupMember.contact', 'pgmContact')
      .leftJoinAndSelect('expense.group', 'group')
      .leftJoinAndSelect('expense.groupKeyVersion', 'gkv')
      .where('expense.deletedAt IS NULL')
      .andWhere("group.group_type = 'household'")
      .andWhere('(paidByUser.id = :userId OR pgmUser.id = :userId)', { userId })
      .getMany();

    // ── 3. Build unified items ──────────────────────────────────────────────
    const seen = new Set<string>();

    const items: Array<Record<string, unknown>> = [];

    for (const exp of personalExpenses) {
      if (seen.has(exp.id)) continue;
      seen.add(exp.id);
      items.push({
        id: exp.id,
        title: exp.title,
        description: exp.description,
        amountTotal: Number(exp.amountTotal),
        myShare: Number(exp.amountTotal),
        transactionType: exp.transactionType ?? 'expense',
        category: exp.category,
        expenseDate: exp.expenseDate,
        currency: exp.currency,
        status: exp.status,
        encryptionScope: exp.encryptionScope,
        expenseType: 'PERSONAL',
        groupId: null,
        groupName: null,
        paidByUserId: exp.paidByUser?.id ?? null,
        paidByDisplayName:
          exp.paidByUser?.displayName ?? exp.paidByUser?.email ?? null,
        groupKeyVersionId: exp.groupKeyVersion?.id ?? null,
        splitId: null,
        isSettled: false,
        deletedAt: null,
      });
    }

    for (const split of groupSplits) {
      const exp = split.expense;
      if (seen.has(exp.id)) continue;
      seen.add(exp.id);
      items.push({
        id: exp.id,
        title: exp.title,
        description: exp.description,
        amountTotal: Number(exp.amountTotal),
        myShare: Number(split.amountOwed),
        transactionType: exp.transactionType ?? 'expense',
        category: exp.category,
        expenseDate: exp.expenseDate,
        currency: exp.currency,
        status: exp.status,
        encryptionScope: exp.encryptionScope,
        expenseType: 'GROUP_SHARE',
        groupId: exp.group?.id ?? null,
        groupName: exp.group?.name ?? null,
        // Frozen rule: a group expense's payer resolves via
        // paidByGroupMember, never paidByUser — paidByUser is only ever
        // populated for a legacy, pre-migration row.
        paidByUserId:
          exp.paidByUser?.id ?? exp.paidByGroupMember?.user?.id ?? null,
        paidByGroupMemberId: exp.paidByGroupMember?.id ?? null,
        paidByDisplayName:
          exp.paidByUser?.displayName ??
          exp.paidByUser?.email ??
          exp.paidByGroupMember?.user?.displayName ??
          exp.paidByGroupMember?.user?.email ??
          exp.paidByGroupMember?.contact?.displayName ??
          exp.paidByGroupMember?.contact?.email ??
          null,
        groupKeyVersionId: exp.groupKeyVersion?.id ?? null,
        splitId: split.id,
        isSettled: split.isSettled ?? false,
        deletedAt: null,
      });
    }

    for (const exp of householdPaid) {
      if (seen.has(exp.id)) continue;
      seen.add(exp.id);
      items.push({
        id: exp.id,
        title: exp.title,
        description: exp.description,
        amountTotal: Number(exp.amountTotal),
        // Household: personal spending is the full paid amount, not a share.
        myShare: Number(exp.amountTotal),
        transactionType: exp.transactionType ?? 'expense',
        category: exp.category,
        expenseDate: exp.expenseDate,
        currency: exp.currency,
        status: exp.status,
        encryptionScope: exp.encryptionScope,
        expenseType: 'GROUP_SHARE',
        groupId: exp.group?.id ?? null,
        groupName: exp.group?.name ?? null,
        paidByUserId:
          exp.paidByUser?.id ?? exp.paidByGroupMember?.user?.id ?? null,
        paidByGroupMemberId: exp.paidByGroupMember?.id ?? null,
        paidByDisplayName:
          exp.paidByUser?.displayName ??
          exp.paidByUser?.email ??
          exp.paidByGroupMember?.user?.displayName ??
          exp.paidByGroupMember?.user?.email ??
          exp.paidByGroupMember?.contact?.displayName ??
          exp.paidByGroupMember?.contact?.email ??
          null,
        groupKeyVersionId: exp.groupKeyVersion?.id ?? null,
        splitId: null,
        isSettled: false,
        deletedAt: null,
      });
    }

    // Sort newest first
    items.sort((a, b) =>
      String(b.expenseDate).localeCompare(String(a.expenseDate)),
    );

    const total = items.length;
    const pageItems = items.slice((p - 1) * l, (p - 1) * l + l);

    return paginate(pageItems, total, p, l, '/api/v1/expenses/me', {});
  }

  /**
   * Half-open [monthStart, monthEnd) date range for a `YYYY-MM` month string,
   * as `YYYY-MM-DD` strings. Portable across PostgreSQL (`date`) and SQLite
   * (text dates) — unlike a `LIKE 'YYYY-MM%'` filter, which PostgreSQL rejects
   * against a `date` column.
   */
  private monthDateRange(month: string): {
    monthStart: string;
    monthEnd: string;
  } {
    const [year, mon] = month.split('-').map(Number);
    const nextYear = mon === 12 ? year + 1 : year;
    const nextMon = mon === 12 ? 1 : mon + 1;
    return {
      monthStart: `${month}-01`,
      monthEnd: `${nextYear}-${String(nextMon).padStart(2, '0')}-01`,
    };
  }

  /** Combined category-level aggregated monthly expenditures (personal + group splits) */
  async getCombinedMonthlyAnalytics(
    userId: string,
    month: string,
  ): Promise<{ category: string; amount: number; currency: string }[]> {
    // `expenseDate` is a real `date` column, so a `LIKE 'YYYY-MM%'` filter is
    // invalid on PostgreSQL (`operator does not exist: date ~~ unknown`) even
    // though SQLite tolerates it. Use a half-open date range instead, which is
    // portable across both and index-friendly on the (…, expenseDate) index.
    const { monthStart, monthEnd } = this.monthDateRange(month);

    // 1. Get all group-less posted expenses paid by the user in this month
    const paidPersonalExpenses = await this.expenseRepository
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.paidByUser', 'paidByUser')
      .where('expense.group IS NULL')
      .andWhere('paidByUser.id = :userId', { userId })
      .andWhere('expense.status = :status', { status: 'posted' })
      .andWhere(
        'expense.expenseDate >= :monthStart AND expense.expenseDate < :monthEnd',
        { monthStart, monthEnd },
      )
      .getMany();

    // 2. Fetch splits for those personal expenses to identify which are 100% personal vs direct splits
    const paidPersonalExpenseIds = paidPersonalExpenses.map((e) => e.id);
    const personalSplits = paidPersonalExpenseIds.length
      ? await this.expenseSplitRepository.find({
          where: { expense: { id: In(paidPersonalExpenseIds) } },
          relations: ['expense'],
        })
      : [];
    const personalExpenseHasSplits = new Set(
      personalSplits.map((s) => s.expense.id),
    );

    // 3. Get all splits where the user is a participant (either direct user
    //    split or group member split). Household groups are excluded — their
    //    spending is the amount actually paid (added in step 3b), not a share.
    const userSplits = await this.expenseSplitRepository
      .createQueryBuilder('split')
      .innerJoinAndSelect('split.expense', 'expense')
      .leftJoin('expense.group', 'group')
      .leftJoin('split.participantGroupMember', 'groupMember')
      .where('expense.status = :status', { status: 'posted' })
      .andWhere("(group.id IS NULL OR group.group_type != 'household')")
      .andWhere(
        '(expense.ledgerMonth = :month OR (expense.expenseDate >= :monthStart AND expense.expenseDate < :monthEnd))',
        { month, monthStart, monthEnd },
      )
      .andWhere(
        '(split.participantUser = :userId OR groupMember.user_id = :userId)',
        { userId },
      )
      .getMany();

    // 3b. Household expenses the user PAID — full amount is their contribution.
    const householdPaid = await this.expenseRepository
      .createQueryBuilder('expense')
      .leftJoin('expense.paidByUser', 'paidByUser')
      .leftJoin('expense.paidByGroupMember', 'pgm')
      .leftJoin('pgm.user', 'pgmUser')
      .leftJoin('expense.group', 'group')
      .where('expense.status = :status', { status: 'posted' })
      .andWhere("group.group_type = 'household'")
      .andWhere(
        '(expense.ledgerMonth = :month OR (expense.expenseDate >= :monthStart AND expense.expenseDate < :monthEnd))',
        { month, monthStart, monthEnd },
      )
      .andWhere('(paidByUser.id = :userId OR pgmUser.id = :userId)', { userId })
      .getMany();

    const categorySum = new Map<string, { amount: number; currency: string }>();

    // Add 100% personal expenses (paid by user, group is null, no splits exist).
    // Refunds count negatively so net spending = expenses − refunds.
    for (const exp of paidPersonalExpenses) {
      if (!personalExpenseHasSplits.has(exp.id)) {
        const cat = exp.category || 'Other';
        const amount = this.signedAmount(exp.amountTotal, exp.transactionType);
        const curr = exp.currency || 'USD';
        const key = `${cat}_${curr}`;
        const entry = categorySum.get(key) ?? { amount: 0, currency: curr };
        entry.amount += amount;
        categorySum.set(key, entry);
      }
    }

    // Add split shares (owes) for both group and direct split expenses. A
    // refund share reduces the participant's net spending.
    for (const split of userSplits) {
      const exp = split.expense;
      const cat = exp.category || 'Other';
      const amount = this.signedAmount(split.amountOwed, exp.transactionType);
      const curr = exp.currency || 'USD';
      const key = `${cat}_${curr}`;
      const entry = categorySum.get(key) ?? { amount: 0, currency: curr };
      entry.amount += amount;
      categorySum.set(key, entry);
    }

    // Add household expenses at the full amount the user paid (contribution
    // tracking, not cost-sharing). A refund reduces the payer's net spending.
    for (const exp of householdPaid) {
      const cat = exp.category || 'Other';
      const amount = this.signedAmount(exp.amountTotal, exp.transactionType);
      const curr = exp.currency || 'USD';
      const key = `${cat}_${curr}`;
      const entry = categorySum.get(key) ?? { amount: 0, currency: curr };
      entry.amount += amount;
      categorySum.set(key, entry);
    }

    return Array.from(categorySum.entries()).map(([key, value]) => {
      const lastUnderscore = key.lastIndexOf('_');
      const category = key.substring(0, lastUnderscore);
      return {
        category,
        amount: Math.round(value.amount * 100) / 100,
        currency: value.currency,
      };
    });
  }
}
