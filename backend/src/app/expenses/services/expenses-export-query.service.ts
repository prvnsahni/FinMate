import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CustomTag,
  EncryptedExpenseKey,
  Expense,
  ExpenseSplit,
  GroupMember,
  getActiveCanonicalTag,
} from '@finmate/data-models';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import {
  MemberRef,
  applyExpenseDimensionFilters,
} from '../group-expense-filters.util';

/** Upper bound on rows a single export may return, to bound memory/response size. */
export const MAX_EXPORT_ROWS = 10000;

export interface ExportFilter {
  from?: string;
  to?: string;
  type?: 'personal' | 'group' | 'all';
  category?: string;
  status?: 'settled' | 'pending';
  currency?: string;
  /**
   * When set, the export switches to group-ledger mode: every expense in this
   * group (subject to the other filters), not just the caller's share. The
   * caller must be a member of the group.
   */
  groupId?: string;
  // ── Unified group-filter dimensions (group-ledger mode only) ───────────────
  /** Categories (exact names) — matches ANY. */
  categories?: string[];
  /** Group-member ids (participants via splits) — matches ANY. */
  memberIds?: string[];
  /** Group-member ids (payers) — matches ANY. */
  paidByIds?: string[];
  /** `both`/undefined applies no transaction-type filter. */
  transactionType?: 'expense' | 'refund' | 'both';
  /** Inclusive amount bounds. */
  minAmount?: number;
  maxAmount?: number;
  /** TAG-BATCH-B — canonical tag ids (match ANY). Filters only; no new columns. */
  tagIds?: string[];
}

/**
 * A single export row. `title`/`description` are ciphertext (the server is
 * zero-knowledge and cannot decrypt them); the client decrypts them with its
 * scope key before writing the workbook. Everything else is server-readable
 * metadata.
 */
export interface ExportRow {
  id: string;
  expenseDate: string;
  createdAt: Date;
  // ── Encrypted (client decrypts) ──────────────────────────────────────────
  title: string;
  description: string | null;
  encryptionScope: 'personal' | 'group' | 'direct_shared';
  groupId: string | null;
  groupKeyVersionId: string | null;
  wrappedContentKeys: Array<{ userId: string; wrappedKey: string }>;
  // ── Plaintext metadata ───────────────────────────────────────────────────
  amountTotal: number;
  myShare: number;
  /** `expense` (default) or `refund` — a refund is a negative expense. */
  transactionType: 'expense' | 'refund';
  currency: string;
  category: string;
  expenseType: 'PERSONAL' | 'GROUP_SHARE';
  groupName: string | null;
  paidByDisplayName: string | null;
  splitType: string | null;
  isSettled: boolean;
  status: string;
}

/**
 * Backend source of truth for export permissions and filtering.
 *
 * Returns the caller's personal expenses PLUS their share of group expenses
 * (via ExpenseSplit), scoped exactly like `ExpensesService.listMyExpenses` —
 * a user only has splits in groups they belong to, so this never exposes
 * another user's private data. Workbook generation lives entirely on the
 * client (see the frontend `ExpenseExportService`), keeping filtering separate
 * from file formatting so CSV/PDF can be added without touching this logic.
 */
@Injectable()
export class ExpenseExportQueryService {
  constructor(
    @InjectRepository(Expense)
    private readonly expenseRepository: Repository<Expense>,
    @InjectRepository(ExpenseSplit)
    private readonly expenseSplitRepository: Repository<ExpenseSplit>,
    @InjectRepository(EncryptedExpenseKey)
    private readonly encryptedExpenseKeyRepository: Repository<EncryptedExpenseKey>,
    @InjectRepository(GroupMember)
    private readonly groupMemberRepository: Repository<GroupMember>,
    @InjectRepository(CustomTag)
    private readonly customTagRepository: Repository<CustomTag>,
  ) {}

  /**
   * TAG-BATCH-C3 — of the requested filter `tagIds`, which are custom-tag ids the
   * export may filter by. The group ledger export is always scoped to one group
   * with membership already verified, so only that group's ACTIVE group custom
   * tags qualify; everything else (canonical ids, personal customs, other groups',
   * deprecated, unknown) is dropped here. Never reads the encrypted name — the
   * export filters on the opaque id only and adds no tag column.
   */
  private async resolveGroupCustomTagIds(
    groupId: string,
    tagIds: string[] | undefined,
  ): Promise<string[]> {
    if (!tagIds?.length) return [];
    const candidates = tagIds.filter((id) => !getActiveCanonicalTag(id));
    if (!candidates.length) return [];
    const rows = await this.customTagRepository.find({
      where: {
        id: In(candidates),
        status: 'active',
        scopeType: 'group',
        group: { id: groupId },
      },
    });
    return rows.map((r) => r.id);
  }

  private static readonly DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  private assertValidDate(value: string | undefined, label: string): void {
    if (value && !ExpenseExportQueryService.DATE_RE.test(value)) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: `${label} must use YYYY-MM-DD format`,
      });
    }
  }

  /**
   * Resolve the filtered export rows for a user. Newest expense first.
   * Throws EXP_EXPORT_TOO_LARGE if the result would exceed MAX_EXPORT_ROWS.
   */
  async getExportRows(
    userId: string,
    filter: ExportFilter,
  ): Promise<ExportRow[]> {
    this.assertValidDate(filter.from, 'from');
    this.assertValidDate(filter.to, 'to');
    if (filter.from && filter.to && filter.from > filter.to) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: '`from` date must not be after `to` date',
      });
    }

    const type = filter.type ?? 'all';
    const currency = filter.currency?.toUpperCase();

    // Group-ledger mode: return the whole group's ledger (all members'
    // expenses), not just the caller's share. Everything else — personal +
    // the caller's own group shares — flows through the per-caller queries.
    if (filter.groupId) {
      const rows = await this.buildGroupLedgerRows(
        userId,
        filter.groupId,
        filter,
        currency,
      );
      return this.finalizeRows(rows);
    }

    // A specific settlement status only applies to group shares — personal
    // expenses have no settlement concept, so exclude them when it's set.
    const includePersonal =
      (type === 'all' || type === 'personal') && !filter.status;
    const includeGroup = type === 'all' || type === 'group';

    const rows: ExportRow[] = [];
    const seen = new Set<string>();

    if (includePersonal) {
      const personal = await this.buildPersonalQuery(
        userId,
        filter,
        currency,
      ).getMany();
      for (const exp of personal) {
        if (seen.has(exp.id)) continue;
        seen.add(exp.id);
        rows.push({
          id: exp.id,
          expenseDate: exp.expenseDate,
          createdAt: exp.createdAt,
          title: exp.title,
          description: exp.description ?? null,
          encryptionScope: exp.encryptionScope ?? 'personal',
          groupId: null,
          groupKeyVersionId: exp.groupKeyVersion?.id ?? null,
          wrappedContentKeys: [],
          amountTotal: Number(exp.amountTotal),
          myShare: Number(exp.amountTotal),
          transactionType: exp.transactionType ?? 'expense',
          currency: exp.currency,
          category: exp.category,
          expenseType: 'PERSONAL',
          groupName: null,
          paidByDisplayName:
            exp.paidByUser?.displayName ?? exp.paidByUser?.email ?? null,
          splitType: null,
          isSettled: false,
          status: exp.status,
        });
      }
    }

    if (includeGroup) {
      const splits = await this.buildGroupSplitQuery(
        userId,
        filter,
        currency,
      ).getMany();
      for (const split of splits) {
        const exp = split.expense;
        if (!exp || seen.has(exp.id)) continue;
        seen.add(exp.id);
        rows.push({
          id: exp.id,
          expenseDate: exp.expenseDate,
          createdAt: exp.createdAt,
          title: exp.title,
          description: exp.description ?? null,
          encryptionScope: exp.encryptionScope ?? 'group',
          groupId: exp.group?.id ?? null,
          groupKeyVersionId: exp.groupKeyVersion?.id ?? null,
          wrappedContentKeys: [],
          amountTotal: Number(exp.amountTotal),
          myShare: Number(split.amountOwed),
          transactionType: exp.transactionType ?? 'expense',
          currency: exp.currency,
          category: exp.category,
          expenseType: 'GROUP_SHARE',
          groupName: exp.group?.name ?? null,
          // Frozen rule: a group expense's payer resolves via paidByGroupMember;
          // paidByUser is only ever populated for legacy, pre-migration rows.
          paidByDisplayName:
            exp.paidByUser?.displayName ??
            exp.paidByUser?.email ??
            exp.paidByGroupMember?.user?.displayName ??
            exp.paidByGroupMember?.user?.email ??
            exp.paidByGroupMember?.contact?.displayName ??
            exp.paidByGroupMember?.contact?.email ??
            null,
          splitType: split.splitType ?? null,
          isSettled: split.isSettled ?? false,
          status: exp.status,
        });
      }

      // Household expenses the caller paid — full amount, no settlement concept
      // (so excluded when a settlement `status` filter is active, like personal).
      if (!filter.status) {
        const householdPaid = await this.buildHouseholdPaidQuery(
          userId,
          filter,
          currency,
        ).getMany();
        for (const exp of householdPaid) {
          if (seen.has(exp.id)) continue;
          seen.add(exp.id);
          rows.push({
            id: exp.id,
            expenseDate: exp.expenseDate,
            createdAt: exp.createdAt,
            title: exp.title,
            description: exp.description ?? null,
            encryptionScope: exp.encryptionScope ?? 'group',
            groupId: exp.group?.id ?? null,
            groupKeyVersionId: exp.groupKeyVersion?.id ?? null,
            wrappedContentKeys: [],
            amountTotal: Number(exp.amountTotal),
            // Household: the caller's line is the full amount they paid.
            myShare: Number(exp.amountTotal),
            transactionType: exp.transactionType ?? 'expense',
            currency: exp.currency,
            category: exp.category,
            expenseType: 'GROUP_SHARE',
            groupName: exp.group?.name ?? null,
            paidByDisplayName:
              exp.paidByUser?.displayName ??
              exp.paidByUser?.email ??
              exp.paidByGroupMember?.user?.displayName ??
              exp.paidByGroupMember?.user?.email ??
              exp.paidByGroupMember?.contact?.displayName ??
              exp.paidByGroupMember?.contact?.email ??
              null,
            splitType: null,
            isSettled: false,
            status: exp.status,
          });
        }
      }
    }

    return this.finalizeRows(rows);
  }

  /**
   * Shared tail for every export path: enforce the row cap, attach wrapped
   * content keys for direct-shared rows, and sort newest-first.
   */
  private async finalizeRows(rows: ExportRow[]): Promise<ExportRow[]> {
    if (rows.length > MAX_EXPORT_ROWS) {
      throw new BadRequestException({
        errorCode: 'EXP_EXPORT_TOO_LARGE',
        message: `Export exceeds the ${MAX_EXPORT_ROWS.toLocaleString()}-record limit. Narrow the date range or filters and try again.`,
      });
    }

    // Attach wrapped content keys for any direct_shared rows so the client can
    // unwrap the per-expense content key. Group/personal scopes never need them.
    await this.attachWrappedKeys(rows);

    // Newest expense first (ties broken by createdAt) for a stable ordering.
    rows.sort((a, b) => {
      const byDate = String(b.expenseDate).localeCompare(String(a.expenseDate));
      if (byDate !== 0) return byDate;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return rows;
  }

  /**
   * Build the full group ledger: every non-deleted expense in the group
   * (subject to date/category/currency filters), with the caller's own split
   * amount surfaced as `myShare`. Requires the caller to be a group member.
   */
  private async buildGroupLedgerRows(
    userId: string,
    groupId: string,
    filter: ExportFilter,
    currency: string | undefined,
  ): Promise<ExportRow[]> {
    const membership = await this.groupMemberRepository.findOne({
      where: {
        group: { id: groupId },
        user: { id: userId },
        joinStatus: In(['active', 'invited']),
      },
    });
    if (!membership) {
      throw new ForbiddenException({
        errorCode: 'GRP_FORBIDDEN',
        message: 'You do not have access to this group',
      });
    }

    const qb = this.expenseRepository
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.paidByUser', 'paidByUser')
      .leftJoinAndSelect('expense.paidByGroupMember', 'paidByGroupMember')
      .leftJoinAndSelect('paidByGroupMember.user', 'paidByGroupMemberUser')
      .leftJoinAndSelect(
        'paidByGroupMember.contact',
        'paidByGroupMemberContact',
      )
      .leftJoinAndSelect('expense.group', 'group')
      .leftJoinAndSelect('expense.groupKeyVersion', 'gkv')
      .where('group.id = :groupId', { groupId })
      .andWhere('expense.deletedAt IS NULL');

    this.applyExpenseFilters(qb, filter, currency);

    // Unified group-filter dimensions (categories / members / payers / type / amount).
    const [member, paidBy, exportCustomTagIds] = await Promise.all([
      this.resolveGroupMemberRefs(filter.memberIds, groupId),
      this.resolveGroupMemberRefs(filter.paidByIds, groupId),
      this.resolveGroupCustomTagIds(groupId, filter.tagIds),
    ]);
    applyExpenseDimensionFilters(qb, {
      categories: filter.categories,
      transactionType:
        filter.transactionType === 'expense' ||
        filter.transactionType === 'refund'
          ? filter.transactionType
          : undefined,
      member,
      paidBy,
      minAmount: filter.minAmount,
      maxAmount: filter.maxAmount,
      tagIds: filter.tagIds,
      customTagIds: exportCustomTagIds,
    });

    const expenses = await qb.take(MAX_EXPORT_ROWS + 1).getMany();

    const myShareByExpense = await this.loadCallerShares(
      userId,
      expenses.map((e) => e.id),
    );

    return expenses.map((exp) => {
      const mine = myShareByExpense.get(exp.id);
      // Household groups track actual contribution, not cost-sharing: the
      // caller's line is the full amount when they are the payer, otherwise 0 —
      // never the equal-split share, and no settlement concept applies. This
      // mirrors the per-caller export and the personal-dashboard read paths.
      const isHousehold = exp.group?.groupType === 'household';
      const callerIsPayer =
        exp.paidByUser?.id === userId ||
        exp.paidByGroupMember?.user?.id === userId;
      const myShare = isHousehold
        ? callerIsPayer
          ? Number(exp.amountTotal)
          : 0
        : mine
          ? mine.amount
          : 0;
      return {
        id: exp.id,
        expenseDate: exp.expenseDate,
        createdAt: exp.createdAt,
        title: exp.title,
        description: exp.description ?? null,
        encryptionScope: exp.encryptionScope ?? 'group',
        groupId: exp.group?.id ?? groupId,
        groupKeyVersionId: exp.groupKeyVersion?.id ?? null,
        wrappedContentKeys: [],
        amountTotal: Number(exp.amountTotal),
        myShare,
        transactionType: exp.transactionType ?? 'expense',
        currency: exp.currency,
        category: exp.category,
        expenseType: 'GROUP_SHARE',
        groupName: exp.group?.name ?? null,
        // Frozen rule: a group expense's payer resolves via paidByGroupMember;
        // paidByUser is only ever populated for legacy, pre-migration rows.
        paidByDisplayName:
          exp.paidByUser?.displayName ??
          exp.paidByUser?.email ??
          exp.paidByGroupMember?.user?.displayName ??
          exp.paidByGroupMember?.user?.email ??
          exp.paidByGroupMember?.contact?.displayName ??
          exp.paidByGroupMember?.contact?.email ??
          null,
        splitType: isHousehold ? null : (mine?.splitType ?? null),
        isSettled: isHousehold ? false : (mine?.isSettled ?? false),
        status: exp.status,
      };
    });
  }

  /**
   * Map of expenseId → the caller's own split (amount owed, settlement,
   * split type) for the given expenses. Expenses the caller does not
   * participate in are simply absent from the map.
   */
  /**
   * Resolve a group-member id (from the member/payer filter) to both ids it can
   * appear under — its own id and the backing user's id (null for pending
   * members). Returns undefined when it's not a member of the group.
   */
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

  private async loadCallerShares(
    userId: string,
    expenseIds: string[],
  ): Promise<
    Map<
      string,
      { amount: number; isSettled: boolean; splitType: string | null }
    >
  > {
    const byExpense = new Map<
      string,
      { amount: number; isSettled: boolean; splitType: string | null }
    >();
    if (expenseIds.length === 0) return byExpense;

    const splits = await this.expenseSplitRepository
      .createQueryBuilder('split')
      .innerJoinAndSelect('split.expense', 'expense')
      .leftJoin('split.participantGroupMember', 'groupMember')
      .where('expense.id IN (:...expenseIds)', { expenseIds })
      .andWhere(
        '(split.participantUser = :userId OR groupMember.user_id = :userId)',
        { userId },
      )
      .getMany();

    for (const split of splits) {
      const eid = split.expense?.id;
      if (!eid) continue;
      byExpense.set(eid, {
        amount: Number(split.amountOwed),
        isSettled: split.isSettled ?? false,
        splitType: split.splitType ?? null,
      });
    }
    return byExpense;
  }

  private buildPersonalQuery(
    userId: string,
    filter: ExportFilter,
    currency: string | undefined,
  ): SelectQueryBuilder<Expense> {
    const qb = this.expenseRepository
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.paidByUser', 'paidByUser')
      .leftJoinAndSelect('expense.ownerUser', 'ownerUser')
      .leftJoinAndSelect('expense.groupKeyVersion', 'gkv')
      .where('expense.group IS NULL')
      .andWhere('ownerUser.id = :userId', { userId })
      .andWhere('expense.deletedAt IS NULL');

    this.applyExpenseFilters(qb, filter, currency);
    return qb.take(MAX_EXPORT_ROWS + 1);
  }

  private buildGroupSplitQuery(
    userId: string,
    filter: ExportFilter,
    currency: string | undefined,
  ): SelectQueryBuilder<ExpenseSplit> {
    const qb = this.expenseSplitRepository
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
      .andWhere('expense.group IS NOT NULL')
      // Household spending is attributed to the payer at full amount
      // (buildHouseholdPaidQuery), never split, so exclude it here.
      .andWhere("group.group_type != 'household'")
      .andWhere(
        '(split.participantUser = :userId OR groupMember.user_id = :userId)',
        {
          userId,
        },
      );

    this.applyExpenseFilters(qb, filter, currency);

    if (filter.status) {
      qb.andWhere('split.isSettled = :isSettled', {
        isSettled: filter.status === 'settled',
      });
    }

    return qb.take(MAX_EXPORT_ROWS + 1);
  }

  /**
   * Household expenses the caller PAID. Household groups track actual
   * contribution rather than cost-sharing, so the caller's export line is the
   * full amount they paid — never an equal-split share. No settlement concept
   * applies, mirroring personal expenses.
   */
  private buildHouseholdPaidQuery(
    userId: string,
    filter: ExportFilter,
    currency: string | undefined,
  ): SelectQueryBuilder<Expense> {
    const qb = this.expenseRepository
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.paidByUser', 'paidByUser')
      .leftJoinAndSelect('expense.paidByGroupMember', 'paidByGroupMember')
      .leftJoinAndSelect('paidByGroupMember.user', 'paidByGroupMemberUser')
      .leftJoinAndSelect(
        'paidByGroupMember.contact',
        'paidByGroupMemberContact',
      )
      .leftJoinAndSelect('expense.group', 'group')
      .leftJoinAndSelect('expense.groupKeyVersion', 'gkv')
      .where('expense.deletedAt IS NULL')
      .andWhere("group.group_type = 'household'")
      .andWhere(
        '(paidByUser.id = :userId OR paidByGroupMemberUser.id = :userId)',
        { userId },
      );

    this.applyExpenseFilters(qb, filter, currency);
    return qb.take(MAX_EXPORT_ROWS + 1);
  }

  /** Date-range / category / currency filters, shared by both queries. */
  private applyExpenseFilters(
    qb: SelectQueryBuilder<Expense | ExpenseSplit>,
    filter: ExportFilter,
    currency: string | undefined,
  ): void {
    if (filter.from) {
      qb.andWhere('expense.expenseDate >= :from', { from: filter.from });
    }
    if (filter.to) {
      qb.andWhere('expense.expenseDate <= :to', { to: filter.to });
    }
    if (filter.category) {
      qb.andWhere('expense.category = :category', {
        category: filter.category,
      });
    }
    if (currency) {
      qb.andWhere('UPPER(expense.currency) = :currency', { currency });
    }
  }

  private async attachWrappedKeys(rows: ExportRow[]): Promise<void> {
    const directIds = rows
      .filter((r) => r.encryptionScope === 'direct_shared')
      .map((r) => r.id);
    if (directIds.length === 0) return;

    const keys = await this.encryptedExpenseKeyRepository.find({
      where: { expense: { id: In(directIds) } },
      relations: ['expense', 'user'],
    });

    const byExpenseId = new Map<
      string,
      Array<{ userId: string; wrappedKey: string }>
    >();
    for (const key of keys) {
      const eid = key.expense.id;
      const arr = byExpenseId.get(eid) ?? [];
      arr.push({ userId: key.user.id, wrappedKey: key.wrappedKey });
      byExpenseId.set(eid, arr);
    }

    for (const row of rows) {
      const wrapped = byExpenseId.get(row.id);
      if (wrapped) row.wrappedContentKeys = wrapped;
    }
  }
}
