import { ExpenseSplit, ExpenseTag, getActiveCanonicalTag } from '@finmate/data-models';
import { SelectQueryBuilder } from 'typeorm';

/**
 * A group member resolved to both identifiers it can appear under:
 *  - `groupMemberId` — used for pending (Contact-backed) members and as the
 *    payer of group expenses (`paidByGroupMember`).
 *  - `userId` — used for registered members in expense splits
 *    (`participantUser`) and legacy payer rows (`paidByUser`).
 *
 * Member pickers yield only `groupMemberId`s; the owning service resolves the
 * paired `userId` (null for pending members) before calling the helper.
 */
export interface MemberRef {
  groupMemberId: string;
  userId: string | null;
}

/**
 * The shared filter dimensions applied across the ledger list, analytics,
 * export and (filtered) balances. Centralized so a future filter is a one-line
 * addition here. `transactionType: 'both'` must be normalized to `undefined`
 * by the caller. Category/member/payer are multi-select (match ANY).
 */
export interface GroupExpenseDimensionFilters {
  categories?: string[];
  transactionType?: 'expense' | 'refund';
  paidBy?: MemberRef[];
  member?: MemberRef[];
  minAmount?: number;
  maxAmount?: number;
  /**
   * TAG-BATCH-B — canonical taxonomy tag ids (e.g. `milk`, `grocery`). Multi-select
   * — matches ANY, consistent with the other dimensions. Because ancestors are
   * materialized (milk → dairy → grocery → food), selecting `grocery` already
   * matches milk/bread rows. Unknown/deprecated ids are dropped (like the member
   * filter drops unknown members), so a stale id simply widens nothing.
   */
  tagIds?: string[];
  /**
   * TAG-BATCH-C3 — custom-tag ids (personal/group `custom_tags.id` UUIDs) that
   * the caller has ALREADY been authorized to filter by, resolved server-side
   * (`resolveAccessibleCustomTagIds` — the client-supplied scope is never
   * trusted). Matched in the SAME `EXISTS` as the canonical ids, so the unified
   * `tagIds` namespace keeps OR-within-tags / AND-across-dimensions. Empty when
   * nothing resolved (unknown / inaccessible / deprecated ids are dropped, like
   * the canonical fail-safe), so a stale id simply widens nothing.
   */
  customTagIds?: string[];
}

/**
 * The unified group filter as raw ids (before member resolution), shared by the
 * balances and trash endpoints. Date range plus the same dimensions.
 */
export interface RawGroupExpenseFilter {
  from?: string;
  to?: string;
  categories?: string[];
  memberIds?: string[];
  paidByIds?: string[];
  transactionType?: 'expense' | 'refund';
  minAmount?: number;
  maxAmount?: number;
  tagIds?: string[];
}

/** Parse raw query strings (comma-separated arrays, numbers) into a filter. */
export function parseRawGroupExpenseFilter(q: {
  from?: string;
  to?: string;
  categories?: string;
  memberIds?: string;
  paidByIds?: string;
  transactionType?: string;
  minAmount?: string;
  maxAmount?: string;
  tagIds?: string;
}): RawGroupExpenseFilter {
  const csv = (v?: string): string[] | undefined => {
    if (!v) return undefined;
    const arr = v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return arr.length ? arr : undefined;
  };
  const num = (v?: string): number | undefined => {
    if (v == null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    from: q.from || undefined,
    to: q.to || undefined,
    categories: csv(q.categories),
    memberIds: csv(q.memberIds),
    paidByIds: csv(q.paidByIds),
    transactionType:
      q.transactionType === 'expense' || q.transactionType === 'refund'
        ? q.transactionType
        : undefined,
    minAmount: num(q.minAmount),
    maxAmount: num(q.maxAmount),
    tagIds: csv(q.tagIds),
  };
}

/**
 * Apply the shared expense-dimension filters to a query builder whose root
 * alias is an `Expense`. References entity relation *properties* (never raw
 * physical column names) so TypeORM maps them to the correct FK columns
 * regardless of the naming strategy, and so the same helper works for the
 * ledger, analytics, export and balances builders alike.
 *
 * The `member` filter uses a correlated `EXISTS` subquery over `expense_splits`
 * rather than a JOIN, so it never multiplies rows — `getCount()`, pagination
 * and the scope-wide totals all stay correct.
 */
export function applyExpenseDimensionFilters<T>(
  qb: SelectQueryBuilder<T>,
  filter: GroupExpenseDimensionFilters,
  alias = 'expense',
): void {
  if (filter.categories?.length) {
    qb.andWhere(`${alias}.category IN (:...gefCats)`, {
      gefCats: filter.categories,
    });
  }

  if (filter.transactionType) {
    qb.andWhere(`${alias}.transactionType = :gefTxType`, {
      gefTxType: filter.transactionType,
    });
  }

  if (filter.minAmount != null) {
    qb.andWhere(`${alias}.amountTotal >= :gefMinAmount`, {
      gefMinAmount: filter.minAmount,
    });
  }
  if (filter.maxAmount != null) {
    qb.andWhere(`${alias}.amountTotal <= :gefMaxAmount`, {
      gefMaxAmount: filter.maxAmount,
    });
  }

  if (filter.paidBy?.length) {
    const gmIds = filter.paidBy.map((p) => p.groupMemberId);
    const userIds = filter.paidBy
      .map((p) => p.userId)
      .filter((u): u is string => !!u);
    const clauses = [`${alias}.paidByGroupMember IN (:...gefPaidGm)`];
    const params: Record<string, unknown> = { gefPaidGm: gmIds };
    if (userIds.length) {
      clauses.push(`${alias}.paidByUser IN (:...gefPaidUser)`);
      params.gefPaidUser = userIds;
    }
    qb.andWhere(`(${clauses.join(' OR ')})`, params);
  }

  if (filter.member?.length) {
    const gmIds = filter.member.map((m) => m.groupMemberId);
    const userIds = filter.member
      .map((m) => m.userId)
      .filter((u): u is string => !!u);
    qb.andWhere((sub) => {
      const cond = userIds.length
        ? '(gefSplit.participantGroupMember IN (:...gefMemGm) OR gefSplit.participantUser IN (:...gefMemUser))'
        : 'gefSplit.participantGroupMember IN (:...gefMemGm)';
      const inner = sub
        .subQuery()
        .select('1')
        .from(ExpenseSplit, 'gefSplit')
        .where(`gefSplit.expense = ${alias}.id`)
        .andWhere('gefSplit.deletedAt IS NULL')
        .andWhere(cond)
        .getQuery();
      return `EXISTS ${inner}`;
    });
    qb.setParameter('gefMemGm', gmIds);
    if (userIds.length) qb.setParameter('gefMemUser', userIds);
  }

  // TAG-BATCH-B — canonical-tag filter (match ANY). Correlated EXISTS over
  // `expense_tags` (never a JOIN), so it never multiplies rows — counts,
  // pagination and scope-wide totals stay correct. Descriptive Zone-2 metadata
  // only; it selects WHICH expenses match and never reads any financial column.
  // Unknown/deprecated ids are dropped so a stale selection can never widen the
  // result or resurrect a deprecated tag as a filter.
  // TAG-BATCH-C3 — the unified tag dimension now matches canonical ids AND the
  // pre-authorized custom-tag ids in the SAME correlated EXISTS (still one
  // namespace, still match-ANY). Canonical ids are re-validated here (active
  // only); custom ids arrive already authorized server-side. Scope of the outer
  // query (owner / group membership) still bounds every match, so a custom id
  // can never surface another user's/group's rows.
  if (filter.tagIds?.length || filter.customTagIds?.length) {
    const activeTagIds = (filter.tagIds ?? []).filter(
      (id) => !!getActiveCanonicalTag(id),
    );
    const matchIds = [...activeTagIds, ...(filter.customTagIds ?? [])];
    if (matchIds.length) {
      qb.andWhere((sub) => {
        const inner = sub
          .subQuery()
          .select('1')
          .from(ExpenseTag, 'gefTag')
          .where(`gefTag.expense = ${alias}.id`)
          .andWhere('gefTag.tagId IN (:...gefTagIds)')
          .getQuery();
        return `EXISTS ${inner}`;
      });
      qb.setParameter('gefTagIds', matchIds);
    }
  }
}
