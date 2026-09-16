import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, In, DataSource, EntityManager } from 'typeorm';
import {
  MemberRef,
  RawGroupExpenseFilter,
  applyExpenseDimensionFilters,
} from '../expenses/group-expense-filters.util';
import {
  Group,
  GroupMember,
  Expense,
  ExpenseSplit,
  ExpensePayment,
  Settlement,
  SettlementVersion,
  ProposeSettlementDto,
  RecordPaymentDto,
  UpdateSettlementDto,
  AuditLog,
  User,
} from '@finmate/data-models';
import { createHash } from 'crypto';
import { paginate, PaginatedResponse } from '../common/pagination.util';
import { simplifyLedgerDebts } from '../common/ledger-debt-simplifier';
import {
  MemberDisplay,
  resolveMemberDisplay,
} from '../common/member-display.util';

export interface MemberBalance {
  userId: string;
  balance: number;
}

export interface SimplifiedTransaction {
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: string;
}

/**
 * Enriched, externally-exposed shape of a suggested settlement.
 *
 * `simplifyDebts`/`SimplifiedTransaction` are unchanged and stay keyed by an
 * opaque identifier (internally, GroupMember.id) — this shape is the
 * post-processing step that resolves each side back to a real user or a
 * pending Contact for display, so the balance graph itself never needs to
 * know whether either party has an account.
 */
export interface SuggestedSettlement {
  fromGroupMemberId: string;
  fromUserId: string | null;
  fromContactId: string | null;
  toGroupMemberId: string;
  toUserId: string | null;
  toContactId: string | null;
  amount: number;
  currency: string;
}

/**
 * The calling member's balance decomposed for the "Balance Breakdown" view.
 * Intentionally minimal and nested so future terms (e.g. refunds/settlements
 * lines) can be added without breaking existing clients. The identity always
 * holds by construction: `openingBalance + currentPeriodBalance = closingBalance`.
 *
 *  - `closingBalance`       — the caller's true all-time balance (carry-forward
 *                             and settlements folded in). Never affected by filters.
 *  - `currentPeriodBalance` — the caller's balance within the active filter slice
 *                             (settlements and system carry-forward excluded).
 *  - `openingBalance`       — everything carried in before the period
 *                             (`closing − period`).
 */
export interface CallerBalanceBreakdown {
  currency: string;
  openingBalance: number;
  currentPeriodBalance: number;
  closingBalance: number;
}

@Injectable()
export class SettlementsService {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(GroupMember)
    private readonly groupMemberRepository: Repository<GroupMember>,
    @InjectRepository(Expense)
    private readonly expenseRepository: Repository<Expense>,
    @InjectRepository(ExpenseSplit)
    private readonly expenseSplitRepository: Repository<ExpenseSplit>,
    @InjectRepository(ExpensePayment)
    private readonly expensePaymentRepository: Repository<ExpensePayment>,
    @InjectRepository(Settlement)
    private readonly settlementRepository: Repository<Settlement>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private getIpHash(ip?: string): string | undefined {
    if (!ip) return undefined;
    return createHash('sha256').update(ip).digest('hex');
  }

  private async writeAuditLog(opts: {
    actorUser: User;
    action: string;
    entityId: string;
    groupId?: string;
    metadata?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      const meta = { ...opts.metadata };
      if (opts.userAgent) {
        meta.userAgent = opts.userAgent;
      }
      await this.auditLogRepository.save(
        this.auditLogRepository.create({
          actorUser: opts.actorUser,
          action: opts.action,
          entityType: 'settlement',
          entityId: opts.entityId,
          scope: opts.groupId ? 'group' : 'personal',
          group: opts.groupId ? ({ id: opts.groupId } as Group) : undefined,
          metadataJson: meta,
          ipHash: this.getIpHash(opts.ip),
        }),
      );
    } catch {
      // Audit log failures should never block primary operations
    }
  }

  private settlementSnapshot(settlement: Settlement): Record<string, unknown> {
    return {
      id: settlement.id,
      groupId: settlement.group?.id ?? null,
      fromUserId: settlement.fromUser?.id ?? null,
      fromGroupMemberId: settlement.fromGroupMember?.id ?? null,
      toUserId: settlement.toUser?.id ?? null,
      toGroupMemberId: settlement.toGroupMember?.id ?? null,
      amount: Number(settlement.amount),
      currency: settlement.currency,
      status: settlement.status,
      settledOn: settlement.settledOn ?? null,
      note: settlement.note ?? null,
      version: settlement.version,
    };
  }

  private async recordSettlementVersion(
    manager: EntityManager,
    settlement: Settlement,
    action: SettlementVersion['action'],
    actorUser?: User | null,
  ): Promise<void> {
    await manager.save(
      SettlementVersion,
      manager.create(SettlementVersion, {
        settlement,
        entityVersion: settlement.version,
        action,
        snapshot: this.settlementSnapshot(settlement),
        actorUser: actorUser ?? undefined,
      }),
    );
  }

  simplifyDebts(
    balances: MemberBalance[],
    currency: string,
  ): SimplifiedTransaction[] {
    return simplifyLedgerDebts(
      balances.map((b) => ({ key: b.userId, balance: b.balance })),
      currency,
    ).map((t) => ({
      fromUserId: t.fromKey,
      toUserId: t.toKey,
      amount: t.amount,
      currency: t.currency,
    }));
  }

  /** Resolves display info for a GroupMember, whichever identity backs it. */
  private memberDisplay(m: GroupMember): MemberDisplay {
    return resolveMemberDisplay(m);
  }

  /** Resolve group-member ids to {groupMemberId, userId} pairs for the filter. */
  private async resolveGroupMemberRefs(
    groupMemberIds: string[] | undefined,
    groupId: string,
  ): Promise<MemberRef[]> {
    if (!groupMemberIds?.length) return [];
    const members = await this.groupMemberRepository.find({
      where: { id: In(groupMemberIds), group: { id: groupId } },
      relations: ['user'],
    });
    return members.map((m) => ({
      groupMemberId: m.id,
      userId: m.user?.id ?? null,
    }));
  }

  /**
   * Returns both the all-time `overall` balances (with settlements + carry
   * forward intact) and the `filtered` balances for the supplied unified filter.
   * Filtered balances reflect only the matching expenses (settlements are not
   * attributable to a category/member slice, so they're excluded there) — this
   * preserves real accounting under `overall` while enabling period/category
   * analysis under `filtered`.
   */
  async calculateGroupBalances(
    userId: string,
    groupId: string,
    filter?: RawGroupExpenseFilter,
  ) {
    // 1. Verify access: caller must have active membership
    const callerMember = await this.groupMemberRepository
      .createQueryBuilder('member')
      .where('member.group_id = :groupId', { groupId })
      .andWhere('member.user_id = :userId', { userId })
      .andWhere('member.joinStatus = :status', { status: 'active' })
      .getOne();
    if (!callerMember) {
      throw new ForbiddenException('You do not have access to this group');
    }

    // Verify group exists
    const groupExists = await this.groupRepository.findOne({
      where: { id: groupId },
    });
    if (!groupExists) {
      throw new NotFoundException('Group not found');
    }

    // 2. Fetch active and invited group members (User- or Contact-backed)
    const allMembers = await this.groupMemberRepository.find({
      where: { group: { id: groupId }, joinStatus: In(['active', 'invited']) },
      relations: ['user', 'contact'],
    });

    const overall = await this.computeBalancesCore(
      groupId,
      allMembers,
      undefined,
      true,
    );
    // Only compute a separate filtered view when a filter was actually supplied
    // (internal callers like Friends pass none and just want the overall picture).
    const filtered = filter
      ? await this.computeBalancesCore(groupId, allMembers, filter, false)
      : overall;

    // Decompose the *caller's* balance for the Balance Breakdown UI. The
    // backend stays the single source of truth: Opening is derived here as
    // Closing − Period, so the three always reconcile exactly and no refund or
    // settlement is ever counted twice (settlements live only in Closing;
    // refunds are signed expenses already inside both sums).
    const groupCurrency = groupExists.currency;
    const callerBalanceIn = (view: {
      balances: Array<{
        userId: string | null;
        currency: string;
        netBalance: number;
      }>;
    }): number => {
      const entry = view.balances.find(
        (b) => b.userId === userId && b.currency === groupCurrency,
      );
      return entry ? entry.netBalance : 0;
    };
    const closingBalance = callerBalanceIn(overall);
    const currentPeriodBalance = callerBalanceIn(filtered);
    const breakdown: CallerBalanceBreakdown = {
      currency: groupCurrency,
      openingBalance:
        Math.round((closingBalance - currentPeriodBalance) * 100) / 100,
      currentPeriodBalance,
      closingBalance,
    };

    return { overall, filtered, breakdown };
  }

  /**
   * Caller-agnostic all-time balances for every member of a group, keyed by
   * GroupMember.id (one row per member per currency). Unlike
   * `calculateGroupBalances` this performs no caller access check or breakdown —
   * it is an internal computation used by `BalancesService` to gate identity
   * changes. Includes confirmed settlements (all-time overall view).
   */
  async getOverallBalances(groupId: string): Promise<
    Array<{
      userId: string | null;
      contactId: string | null;
      groupMemberId: string;
      displayName: string;
      netBalance: number;
      currency: string;
    }>
  > {
    const allMembers = await this.groupMemberRepository.find({
      where: { group: { id: groupId }, joinStatus: In(['active', 'invited']) },
      relations: ['user', 'contact'],
    });
    const { balances } = await this.computeBalancesCore(
      groupId,
      allMembers,
      undefined,
      true,
    );
    return balances;
  }

  /**
   * Core balance computation over a (optionally filtered) set of expenses.
   * `includeSettlements` folds confirmed settlements into the balance (only
   * meaningful for the all-time overall view).
   */
  private async computeBalancesCore(
    groupId: string,
    allMembers: GroupMember[],
    filter: RawGroupExpenseFilter | undefined,
    includeSettlements: boolean,
  ) {
    // 3. Fetch posted (non-deleted) expenses, applying the unified filter.
    const expenseQb = this.expenseRepository
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.paidByUser', 'paidByUser')
      .leftJoinAndSelect('expense.paidByGroupMember', 'paidByGroupMember')
      .leftJoinAndSelect('paidByGroupMember.user', 'pgmUser')
      .leftJoinAndSelect('paidByGroupMember.contact', 'pgmContact')
      .where('expense.group = :groupId', { groupId })
      .andWhere('expense.status = :status', { status: 'posted' })
      .andWhere('expense.deletedAt IS NULL');
    // The filtered/period view excludes system carry-forward rollover expenses
    // (household groups only) so "This Month" reflects real in-period spending
    // rather than the balance rolled in from prior months — that rolled-in
    // amount belongs to the Opening balance (Closing − Period), not the period.
    // The overall view (includeSettlements) keeps them: they're real debt.
    if (!includeSettlements) {
      expenseQb.andWhere('expense.isCarryForward = false');
    }
    if (filter?.from) {
      expenseQb.andWhere('expense.expenseDate >= :balFrom', {
        balFrom: filter.from,
      });
    }
    if (filter?.to) {
      expenseQb.andWhere('expense.expenseDate <= :balTo', { balTo: filter.to });
    }
    if (filter) {
      const [member, paidBy] = await Promise.all([
        this.resolveGroupMemberRefs(filter.memberIds, groupId),
        this.resolveGroupMemberRefs(filter.paidByIds, groupId),
      ]);
      applyExpenseDimensionFilters(expenseQb, {
        categories: filter.categories,
        transactionType: filter.transactionType,
        member,
        paidBy,
        minAmount: filter.minAmount,
        maxAmount: filter.maxAmount,
      });
    }
    const expenses = await expenseQb.getMany();

    // 4. Fetch expense splits for those expenses
    const expenseIds = expenses.map((e) => e.id);
    const splits =
      expenseIds.length > 0
        ? await this.expenseSplitRepository.find({
            where: { expense: { id: In(expenseIds) } },
            relations: [
              'expense',
              'participantUser',
              'participantGroupMember',
              'participantGroupMember.user',
              'participantGroupMember.contact',
            ],
          })
        : [];

    // 4b. Fetch payer breakdown rows (multi-payer). An expense may be split
    //     across several payers; when payment rows exist they are authoritative.
    //     Legacy/single-payer expenses without rows fall back to `paidBy*` below.
    const payments =
      expenseIds.length > 0
        ? await this.expensePaymentRepository.find({
            where: { expense: { id: In(expenseIds) } },
            relations: [
              'expense',
              'paidByUser',
              'paidByGroupMember',
              'paidByGroupMember.user',
              'paidByGroupMember.contact',
            ],
          })
        : [];
    const paymentsByExpense = new Map<string, ExpensePayment[]>();
    for (const p of payments) {
      const list = paymentsByExpense.get(p.expense.id) ?? [];
      list.push(p);
      paymentsByExpense.set(p.expense.id, list);
    }

    // 5. Fetch confirmed settlements (only for the all-time overall view — a
    //    settlement can't be attributed to a category/member slice).
    const settlements = includeSettlements
      ? await this.settlementRepository.find({
          where: { group: { id: groupId }, status: 'confirmed' },
          relations: [
            'fromUser',
            'toUser',
            'fromGroupMember',
            'fromGroupMember.user',
            'fromGroupMember.contact',
            'toGroupMember',
            'toGroupMember.user',
            'toGroupMember.contact',
          ],
        })
      : [];

    // 6. Build list of all unique currencies
    const currencies = new Set<string>();
    expenses.forEach((e) => currencies.add(e.currency));
    settlements.forEach((s) => currencies.add(s.currency));

    // Balances are keyed internally by GroupMember.id — the only identifier
    // guaranteed to exist whether or not a member has a User account.
    // Mapping of userId -> the owning GroupMember, for legacy rows that only
    // populated fromUser/toUser (pre-dating the GroupMember columns).
    const memberIdByUserId = new Map<string, string>();
    allMembers.forEach((m) => {
      if (m.user) memberIdByUserId.set(m.user.id, m.id);
    });

    const displayMap = new Map<string, MemberDisplay>();
    const registerMember = (m?: GroupMember) => {
      if (!m) return;
      if (!displayMap.has(m.id)) {
        displayMap.set(m.id, this.memberDisplay(m));
      }
    };
    allMembers.forEach((m) => registerMember(m));
    expenses.forEach((e) => registerMember(e.paidByGroupMember));
    payments.forEach((p) => registerMember(p.paidByGroupMember));
    splits.forEach((s) => registerMember(s.participantGroupMember));
    settlements.forEach((s) => {
      registerMember(s.fromGroupMember);
      registerMember(s.toGroupMember);
    });

    /** Resolves any expense/split/settlement party to a GroupMember.id. */
    const resolveMemberId = (opts: {
      groupMember?: GroupMember;
      user?: User;
    }): string | undefined => {
      if (opts.groupMember) return opts.groupMember.id;
      if (opts.user) return memberIdByUserId.get(opts.user.id);
      return undefined;
    };

    const finalBalances: Array<{
      userId: string | null;
      contactId: string | null;
      groupMemberId: string;
      displayName: string;
      netBalance: number;
      currency: string;
    }> = [];
    const finalSuggestedSettlements: SuggestedSettlement[] = [];

    // 7. Calculate balances per currency
    for (const currency of currencies) {
      // Map of GroupMember.id -> balance
      const balanceMap = new Map<string, number>();

      // Initialize all current members to 0 for this currency
      allMembers.forEach((m) => balanceMap.set(m.id, 0));

      // Add paid expenses. A refund is a negative expense: the payer is the
      // member who *received* the returned money, so their contribution to the
      // ledger is inverted (they now effectively owe the group the shared
      // portion back), while each participant's share swings the other way.
      for (const expense of expenses) {
        if (expense.currency !== currency) continue;
        const sign = expense.transactionType === 'refund' ? -1 : 1;
        const exPayments = paymentsByExpense.get(expense.id);
        if (exPayments && exPayments.length > 0) {
          // Multi-payer: attribute each payment to its own payer.
          for (const payment of exPayments) {
            const payerId = resolveMemberId({
              groupMember: payment.paidByGroupMember,
              user: payment.paidByUser,
            });
            if (!payerId) continue;
            balanceMap.set(
              payerId,
              (balanceMap.get(payerId) || 0) + sign * Number(payment.amount),
            );
          }
        } else {
          // Legacy / single-payer fallback: use the expense's primary payer.
          const payerId = resolveMemberId({
            groupMember: expense.paidByGroupMember,
            user: expense.paidByUser,
          });
          if (!payerId) continue;
          balanceMap.set(
            payerId,
            (balanceMap.get(payerId) || 0) + sign * Number(expense.amountTotal),
          );
        }
      }

      // Subtract split owes (added back for refunds — see the payer loop above)
      for (const split of splits) {
        if (split.expense.currency !== currency) continue;
        const participantId = resolveMemberId({
          groupMember: split.participantGroupMember,
          user: split.participantUser,
        });
        if (!participantId) continue;
        const sign = split.expense.transactionType === 'refund' ? -1 : 1;
        balanceMap.set(
          participantId,
          (balanceMap.get(participantId) || 0) -
            sign * Number(split.amountOwed),
        );
      }

      // Add settlements
      for (const settlement of settlements) {
        if (settlement.currency !== currency) continue;
        const fromId = resolveMemberId({
          groupMember: settlement.fromGroupMember,
          user: settlement.fromUser,
        });
        const toId = resolveMemberId({
          groupMember: settlement.toGroupMember,
          user: settlement.toUser,
        });
        if (!fromId || !toId) continue;
        balanceMap.set(
          fromId,
          (balanceMap.get(fromId) || 0) + Number(settlement.amount),
        );
        balanceMap.set(
          toId,
          (balanceMap.get(toId) || 0) - Number(settlement.amount),
        );
      }

      // Convert to MemberBalance array — `userId` here is repurposed as the
      // opaque balance-graph key (a GroupMember.id); simplifyDebts's math
      // doesn't care what the string represents.
      const memberBalances: MemberBalance[] = [];
      for (const [groupMemberId, balance] of balanceMap.entries()) {
        memberBalances.push({ userId: groupMemberId, balance });
      }

      // Add to final balances list (formatting each member entry)
      for (const mb of memberBalances) {
        const display = displayMap.get(mb.userId);
        if (display) {
          finalBalances.push({
            userId: display.userId,
            contactId: display.contactId,
            groupMemberId: display.groupMemberId,
            displayName: display.displayName,
            netBalance: Math.round(mb.balance * 100) / 100,
            currency,
          });
        }
      }

      // Run simplifyDebts for this currency, then resolve each side back to
      // a real user or a pending Contact for the response.
      const simplified = this.simplifyDebts(memberBalances, currency);
      for (const s of simplified) {
        const from = displayMap.get(s.fromUserId);
        const to = displayMap.get(s.toUserId);
        if (!from || !to) continue;
        finalSuggestedSettlements.push({
          fromGroupMemberId: from.groupMemberId,
          fromUserId: from.userId,
          fromContactId: from.contactId,
          toGroupMemberId: to.groupMemberId,
          toUserId: to.userId,
          toContactId: to.contactId,
          amount: s.amount,
          currency: s.currency,
        });
      }
    }

    return {
      balances: finalBalances,
      suggestedSettlements: finalSuggestedSettlements,
    };
  }

  async proposeSettlement(
    userId: string,
    groupId: string,
    dto: ProposeSettlementDto,
    context?: { ip?: string; userAgent?: string },
  ): Promise<Settlement> {
    // 1. Validate caller active membership in group
    const callerMember = await this.groupMemberRepository.findOne({
      where: {
        group: { id: groupId },
        user: { id: userId },
        joinStatus: 'active',
      },
      relations: ['user'],
    });
    if (!callerMember) {
      throw new ForbiddenException('You do not have access to this group');
    }

    const group = await this.groupRepository.findOne({
      where: { id: groupId },
    });
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    // 2. Validate recipient active/invited membership in group. `toGroupMemberId`
    // is the primary path — it resolves a member whether they're a registered
    // User or a pending Contact. `toUserId` is kept for backward compatibility.
    if (!dto.toGroupMemberId && !dto.toUserId) {
      throw new BadRequestException(
        'Provide toGroupMemberId or toUserId to identify the recipient',
      );
    }
    const recipientMember = await this.groupMemberRepository.findOne({
      where: dto.toGroupMemberId
        ? {
            id: dto.toGroupMemberId,
            group: { id: groupId },
            joinStatus: In(['active', 'invited']),
          }
        : {
            group: { id: groupId },
            user: { id: dto.toUserId },
            joinStatus: In(['active', 'invited']),
          },
      relations: ['user', 'contact'],
    });
    if (!recipientMember) {
      throw new BadRequestException('Recipient is not a member of this group');
    }
    if (recipientMember.id === callerMember.id) {
      throw new BadRequestException(
        'Cannot propose a settlement with yourself',
      );
    }

    // Currency check
    if (
      group.currency &&
      dto.currency.toUpperCase() !== group.currency.toUpperCase()
    ) {
      throw new BadRequestException({
        errorCode: 'SETTLE_CURRENCY_MISMATCH',
        message: `Settlement currency must match the group's base currency (${group.currency})`,
      });
    }

    const savedSettlement = await this.dataSource.transaction(
      async (manager) => {
        // Frozen group-ledger identity rule: both settlement parties always
        // resolve via GroupMember, never User — including the caller, who
        // is always a real registered member but is referenced by their
        // GroupMember row here, not their User row directly.
        const settlement = manager.create(Settlement, {
          group,
          fromGroupMember: callerMember,
          toGroupMember: recipientMember,
          amount: dto.amount,
          currency: dto.currency.toUpperCase(),
          status: 'proposed',
          note: dto.note,
        });

        const saved = await manager.save(Settlement, settlement);
        await this.recordSettlementVersion(
          manager,
          saved,
          'proposed',
          callerMember.user,
        );
        return saved;
      },
    );

    void this.writeAuditLog({
      actorUser: callerMember.user,
      action: 'settlement.proposed',
      entityId: savedSettlement.id,
      groupId: group.id,
      metadata: {
        toUserId: recipientMember.user?.id ?? null,
        toContactId: recipientMember.contact?.id ?? null,
        toGroupMemberId: recipientMember.id,
        amount: Number(savedSettlement.amount),
        currency: savedSettlement.currency,
      },
      ip: context?.ip,
      userAgent: context?.userAgent,
    });

    return savedSettlement;
  }

  /**
   * One-step "record a cash payment" between two group members, created
   * directly as `confirmed`. This exists because a non-registered
   * (Contact-backed) member cannot log in to accept a proposed settlement, so
   * their balance could otherwise never be brought to zero.
   *
   * Rules:
   * - Both members must be active/invited in the group; `amount > 0`; currency
   *   must match the group's base currency.
   * - The caller must be one of the two parties OR a group owner/admin.
   * - Allowed only when at least one party is an **unclaimed** (Contact-backed,
   *   `user`-less) member. If both are registered users the propose/accept flow
   *   must be used so both sides consent.
   * - Overpayment is intentionally NOT capped here (Splitwise-style); the client
   *   warns.
   */
  async recordPayment(
    userId: string,
    groupId: string,
    dto: RecordPaymentDto,
    context?: { ip?: string; userAgent?: string },
  ): Promise<Settlement> {
    const callerMember = await this.groupMemberRepository.findOne({
      where: {
        group: { id: groupId },
        user: { id: userId },
        joinStatus: 'active',
      },
      relations: ['user'],
    });
    if (!callerMember) {
      throw new ForbiddenException('You do not have access to this group');
    }

    const group = await this.groupRepository.findOne({
      where: { id: groupId },
    });
    if (!group) {
      throw new NotFoundException('Group not found');
    }
    if (
      group.currency &&
      dto.currency.toUpperCase() !== group.currency.toUpperCase()
    ) {
      throw new BadRequestException({
        errorCode: 'SETTLE_CURRENCY_MISMATCH',
        message: `Settlement currency must match the group's base currency (${group.currency})`,
      });
    }
    if (dto.fromMemberId === dto.toMemberId) {
      throw new BadRequestException('Payer and payee must be different members');
    }

    const [fromMember, toMember] = await Promise.all([
      this.groupMemberRepository.findOne({
        where: {
          id: dto.fromMemberId,
          group: { id: groupId },
          joinStatus: In(['active', 'invited']),
        },
        relations: ['user', 'contact'],
      }),
      this.groupMemberRepository.findOne({
        where: {
          id: dto.toMemberId,
          group: { id: groupId },
          joinStatus: In(['active', 'invited']),
        },
        relations: ['user', 'contact'],
      }),
    ]);
    if (!fromMember || !toMember) {
      throw new BadRequestException(
        'Both payer and payee must be active members of this group',
      );
    }

    // Authorization: a party to the payment, or a group owner/admin.
    const callerIsParty =
      callerMember.id === fromMember.id || callerMember.id === toMember.id;
    const callerIsAdmin =
      callerMember.role === 'owner' || callerMember.role === 'admin';
    if (!callerIsParty && !callerIsAdmin) {
      throw new ForbiddenException({
        errorCode: 'RES_FORBIDDEN',
        message:
          'You must be a party to this payment or a group admin to record it',
      });
    }

    // One-step confirmed is only for a non-registered counterparty. If BOTH
    // sides are registered users, both can consent — require propose/accept.
    if (fromMember.user && toMember.user) {
      throw new BadRequestException({
        errorCode: 'SETTLE_USE_PROPOSE_ACCEPT',
        message:
          'Both members are registered users — use the propose/accept flow so both sides confirm the payment',
      });
    }

    const actorUser = callerMember.user;
    const saved = await this.dataSource.transaction(async (manager) => {
      const settlement = manager.create(Settlement, {
        group,
        fromGroupMember: fromMember,
        toGroupMember: toMember,
        amount: dto.amount,
        currency: dto.currency.toUpperCase(),
        status: 'confirmed',
        settledOn: new Date().toISOString().split('T')[0],
        note: dto.note,
        recordedByUser: actorUser,
      });
      const s = await manager.save(Settlement, settlement);
      await this.recordSettlementVersion(manager, s, 'confirmed', actorUser);
      return s;
    });

    void this.writeAuditLog({
      actorUser,
      action: 'settlement.recorded',
      entityId: saved.id,
      groupId,
      metadata: {
        fromGroupMemberId: fromMember.id,
        toGroupMemberId: toMember.id,
        fromContactId: fromMember.contact?.id ?? null,
        toContactId: toMember.contact?.id ?? null,
        amount: Number(saved.amount),
        currency: saved.currency,
        recordedByUserId: actorUser.id,
      },
      ip: context?.ip,
      userAgent: context?.userAgent,
    });

    return saved;
  }

  async listSettlements(
    userId: string,
    groupId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<Settlement>> {
    // Validate caller active membership
    const callerMember = await this.groupMemberRepository.findOne({
      where: {
        group: { id: groupId },
        user: { id: userId },
        joinStatus: 'active',
      },
    });
    if (!callerMember) {
      throw new ForbiddenException('You do not have access to this group');
    }

    const query = this.settlementRepository
      .createQueryBuilder('settlement')
      .leftJoinAndSelect('settlement.fromUser', 'fromUser')
      .leftJoinAndSelect('settlement.toUser', 'toUser')
      .leftJoinAndSelect('settlement.fromGroupMember', 'fromGroupMember')
      .leftJoinAndSelect('fromGroupMember.user', 'fromMemberUser')
      .leftJoinAndSelect('fromGroupMember.contact', 'fromMemberContact')
      .leftJoinAndSelect('settlement.toGroupMember', 'toGroupMember')
      .leftJoinAndSelect('toGroupMember.user', 'toMemberUser')
      .leftJoinAndSelect('toGroupMember.contact', 'toMemberContact')
      .where('settlement.group = :groupId', { groupId })
      .orderBy('settlement.createdAt', 'DESC');

    const total = await query.getCount();
    const settlements = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return paginate(
      settlements,
      total,
      page,
      limit,
      `/api/v1/groups/${groupId}/settlements`,
    );
  }

  async updateSettlement(
    userId: string,
    groupId: string,
    id: string,
    dto: UpdateSettlementDto,
    context?: { ip?: string; userAgent?: string },
  ): Promise<Settlement> {
    const { savedSettlement, callerUser, action } =
      await this.dataSource.transaction(async (manager) => {
        // Validate caller active membership
        const callerMember = await manager.findOne(GroupMember, {
          where: {
            group: { id: groupId },
            user: { id: userId },
            joinStatus: 'active',
          },
          relations: ['user'],
        });
        if (!callerMember) {
          throw new ForbiddenException('You do not have access to this group');
        }

        const settlement = await manager.findOne(Settlement, {
          where: { id, group: { id: groupId } },
          relations: [
            'fromUser',
            'toUser',
            'fromGroupMember',
            'fromGroupMember.user',
            'toGroupMember',
            'toGroupMember.user',
          ],
        });
        if (!settlement) {
          throw new NotFoundException('Settlement not found');
        }

        // Concurrency control: verify version matches
        if (settlement.version !== dto.version) {
          throw new PreconditionFailedException({
            errorCode: 'CON_VERSION_CONFLICT',
            message:
              'Version conflict: the resource has been modified by another request',
          });
        }

        // A pending (Contact-backed) creditor/debtor has no account and can
        // never be the caller — resolve both sides to a real userId where
        // one exists, so the checks below degrade correctly when one side
        // is pending, instead of throwing on a null dereference.
        const creditorUserId =
          settlement.toUser?.id ?? settlement.toGroupMember?.user?.id ?? null;
        const debtorUserId =
          settlement.fromUser?.id ??
          settlement.fromGroupMember?.user?.id ??
          null;

        let auditAction = '';
        if (dto.status === 'confirmed') {
          // Only the creditor can confirm receipt — unless the creditor is
          // pending (no account, can never be the caller), in which case
          // the debtor confirms on their behalf, since no one else can.
          const canConfirm =
            creditorUserId === userId ||
            (creditorUserId === null && debtorUserId === userId);
          if (!canConfirm) {
            throw new ForbiddenException({
              errorCode: 'RES_FORBIDDEN',
              message:
                'Only the creditor can confirm receipt of the settlement',
            });
          }
          settlement.status = 'confirmed';
          settlement.settledOn =
            dto.settledOn || new Date().toISOString().split('T')[0];
          auditAction = 'settlement.confirmed';
        } else if (dto.status === 'cancelled') {
          // Either debtor or creditor can cancel — a null (pending) side
          // never matches `userId`, so this degrades to "only the debtor"
          // when the creditor is pending, with no special-casing needed.
          if (debtorUserId !== userId && creditorUserId !== userId) {
            throw new ForbiddenException({
              errorCode: 'RES_FORBIDDEN',
              message: 'Only the debtor or creditor can cancel the settlement',
            });
          }
          settlement.status = 'cancelled';
          auditAction = 'settlement.cancelled';
        }

        const updated = await manager.save(Settlement, settlement);
        if (auditAction) {
          await this.recordSettlementVersion(
            manager,
            updated,
            auditAction === 'settlement.confirmed' ? 'confirmed' : 'cancelled',
            callerMember.user,
          );
        }
        return {
          savedSettlement: updated,
          callerUser: callerMember.user,
          action: auditAction,
        };
      });

    if (action) {
      void this.writeAuditLog({
        actorUser: callerUser,
        action,
        entityId: savedSettlement.id,
        groupId,
        metadata: {
          toUserId: savedSettlement.toUser?.id ?? null,
          toGroupMemberId: savedSettlement.toGroupMember?.id ?? null,
          fromUserId: savedSettlement.fromUser?.id ?? null,
          fromGroupMemberId: savedSettlement.fromGroupMember?.id ?? null,
          amount: Number(savedSettlement.amount),
          currency: savedSettlement.currency,
          status: savedSettlement.status,
        },
        ip: context?.ip,
        userAgent: context?.userAgent,
      });
    }

    return savedSettlement;
  }

  /**
   * Calculate aggregated debts and credits with friends across all active groups.
   */
  async calculateFriendsBalances(userId: string) {
    // Household groups never create person-to-person obligations — they track
    // monthly contributions, not debts — so they are excluded from the
    // cross-group friends aggregation.
    const memberships = await this.groupMemberRepository.find({
      where: {
        user: { id: userId },
        joinStatus: 'active',
        group: { groupType: 'normal' },
      },
      relations: ['group'],
    });

    const friendsMap = new Map<
      string,
      {
        friendId: string;
        displayName: string;
        email: string;
        netBalance: number;
        currencyDetails: {
          groupId: string;
          groupName: string;
          amount: number;
          currency: string;
        }[];
      }
    >();

    for (const membership of memberships) {
      const groupId = membership.group.id;
      const groupName = membership.group.name;

      let result;
      try {
        result = await this.calculateGroupBalances(userId, groupId);
      } catch (err) {
        continue;
      }

      // Friends aggregates the all-time (overall) picture across shared groups.
      const { suggestedSettlements } = result.overall;

      for (const s of suggestedSettlements) {
        if (s.fromUserId === userId || s.toUserId === userId) {
          const isDebtor = s.fromUserId === userId;
          const friendId = isDebtor ? s.toUserId : s.fromUserId;
          // FROZEN PRODUCT RULE (Phase 3): Friends aggregates only registered
          // users, by design — not a migration gap. `calculateGroupBalances`
          // already resolves every party via GroupMember (registered or
          // pending), but "Friends" answers a fundamentally different
          // question: "what do I owe this *person*, across every group we
          // share?" That requires a stable identity across groups, which only
          // a User account has. A pending Contact has no such identity — the
          // same real person could be an entirely distinct, unlinked Contact
          // row in each group they're pending in, until they register and
          // each group's Contact is independently claimed. Aggregating those
          // as one "friend" would silently merge unrelated ledger entries.
          // Do NOT "fix" this by keying on GroupMember.id — that would change
          // the feature's semantics and break cross-group aggregation. A
          // pending member's balances remain fully visible in their own
          // group's calculateGroupBalances(); they simply have no place in
          // this cross-group, registered-identity-only view until they claim
          // an account.
          if (!friendId) continue;
          const key = `${friendId}_${s.currency.toUpperCase()}`;

          let entry = friendsMap.get(key);
          if (!entry) {
            const friendMember = await this.groupMemberRepository.findOne({
              where: { group: { id: groupId }, user: { id: friendId } },
              relations: ['user'],
            });
            if (!friendMember || !friendMember.user) continue;

            const rawDisplayName =
              friendMember.user.displayName || friendMember.user.email;
            entry = {
              friendId: key,
              displayName: `${rawDisplayName} (${s.currency.toUpperCase()})`,
              email: friendMember.user.email,
              netBalance: 0,
              currencyDetails: [],
            };
            friendsMap.set(key, entry);
          }

          entry.currencyDetails.push({
            groupId,
            groupName,
            amount: isDebtor ? -s.amount : s.amount,
            currency: s.currency,
          });
        }
      }
    }

    for (const friend of friendsMap.values()) {
      friend.netBalance = friend.currencyDetails.reduce(
        (sum, d) => sum + d.amount,
        0,
      );
      friend.netBalance = Math.round(friend.netBalance * 100) / 100;
    }

    return Array.from(friendsMap.values());
  }
}
