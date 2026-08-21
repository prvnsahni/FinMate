/**
 * The unified group filter object.
 *
 * A single, flat, serializable shape that drives every expense-derived surface
 * of the group page (ledger, analytics, KPIs, charts, export, trash) and the
 * filtered balances. Deliberately flat so new filters plug in without touching
 * the architecture: add one field here, one WHERE clause on the backend, and
 * one control in the drawer.
 *
 * `memberIds`/`paidByIds` carry group-member ids from the member pickers; the
 * backend matches each against BOTH the user column and the group-member column
 * so registered and pending (Contact-backed) members resolve.
 */
export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'this_year'
  | 'last_year'
  | 'all_time'
  | 'custom';

/** `both` (default) applies no transaction-type filter. */
export type TransactionTypeFilter = 'expense' | 'refund' | 'both';

/** Ledger sort field. Ordering only — never counts as an "active filter". */
export type GroupSortBy = 'date' | 'amount';
export type SortOrder = 'asc' | 'desc';

export interface GroupFilterDate {
  preset: DatePreset;
  /** Resolved inclusive bounds (YYYY-MM-DD). Undefined for `all_time`. */
  from?: string;
  to?: string;
}

export interface GroupFilter {
  date: GroupFilterDate;
  /** Categories (exact names). Multi-select — matches ANY. */
  categories?: string[];
  /** Participants (via expense splits) — group-member ids. Matches ANY. */
  memberIds?: string[];
  /** Payers — group-member ids. Matches ANY. */
  paidByIds?: string[];
  transactionType?: TransactionTypeFilter;
  /** Inclusive amount bounds on `amountTotal`. */
  minAmount?: number;
  maxAmount?: number;
  /**
   * Canonical taxonomy tag ids (e.g. `milk`, `grocery`). Multi-select — matches
   * ANY (TAG-BATCH-B). Ancestors are materialized server-side, so selecting
   * `grocery` already matches milk/bread. Descriptive Zone-2 metadata only.
   */
  tagIds?: string[];
  /** Ledger ordering (ledger tab only). Defaults to date/desc server-side. */
  sortBy?: GroupSortBy;
  sortOrder?: SortOrder;
  // ── Reserved future slots (no UI/query yet) ──────────────────────────────
  // search?: string;   // blocked server-side: titles/notes are E2E-encrypted
  // paymentMethod?: string[];
  // createdById?: string[];
}

/** The default view: current month, everything else unset. */
export const DEFAULT_GROUP_FILTER: GroupFilter = {
  date: { preset: 'this_month' },
  transactionType: 'both',
};

/**
 * The single, shared interpretation of the selected time period for the Group
 * module. Every date-driven surface (ledger, analytics, export, balance period
 * card, suggested settlements, household contribution graph) must derive its
 * period from this — never from its own month/date math. `from`/`to` are
 * inclusive `YYYY-MM-DD` bounds (both undefined for `all_time`); `label` is the
 * canonical display string from `formatDateRangeLabel`.
 */
export interface TimeScope {
  from?: string;
  to?: string;
  preset: DatePreset;
  label: string;
}

/**
 * Count of non-default filters — drives the notification badge. The default
 * `this_month` date and `both` transaction type never count, and sort ordering
 * is not a filter, so a freshly opened group shows no badge.
 */
export function countActiveFilters(f: GroupFilter): number {
  let n = 0;
  if (f.date.preset !== 'this_month') n += 1;
  n += f.categories?.length ?? 0;
  n += f.memberIds?.length ?? 0;
  n += f.paidByIds?.length ?? 0;
  n += f.tagIds?.length ?? 0;
  if (f.transactionType && f.transactionType !== 'both') n += 1;
  if (f.minAmount != null || f.maxAmount != null) n += 1;
  return n;
}

/** Deep-ish clone adequate for the flat filter shape (used for draft copies). */
export function cloneFilter(f: GroupFilter): GroupFilter {
  return {
    ...f,
    date: { ...f.date },
    categories: f.categories ? [...f.categories] : undefined,
    memberIds: f.memberIds ? [...f.memberIds] : undefined,
    paidByIds: f.paidByIds ? [...f.paidByIds] : undefined,
    tagIds: f.tagIds ? [...f.tagIds] : undefined,
  };
}

// ── URL (de)serialization ──────────────────────────────────────────────────
// Query-param keys are kept short and stable; `null` clears a param under
// Angular's `queryParamsHandling: 'merge'`. Arrays serialize comma-joined.

export interface GroupFilterQueryParams {
  datePreset?: string | null;
  from?: string | null;
  to?: string | null;
  categories?: string | null;
  memberIds?: string | null;
  paidByIds?: string | null;
  tagIds?: string | null;
  txType?: string | null;
  minAmount?: string | null;
  maxAmount?: string | null;
  sortBy?: string | null;
  sortOrder?: string | null;
}

const csv = (a?: string[]): string | null =>
  a && a.length ? a.join(',') : null;

export function filterToQueryParams(f: GroupFilter): GroupFilterQueryParams {
  const isCustom = f.date.preset === 'custom';
  return {
    datePreset: f.date.preset === 'this_month' ? null : f.date.preset,
    from: isCustom ? f.date.from || null : null,
    to: isCustom ? f.date.to || null : null,
    categories: csv(f.categories),
    memberIds: csv(f.memberIds),
    paidByIds: csv(f.paidByIds),
    tagIds: csv(f.tagIds),
    txType:
      f.transactionType && f.transactionType !== 'both'
        ? f.transactionType
        : null,
    minAmount: f.minAmount != null ? String(f.minAmount) : null,
    maxAmount: f.maxAmount != null ? String(f.maxAmount) : null,
    sortBy: f.sortBy ?? null,
    sortOrder: f.sortBy ? (f.sortOrder ?? 'desc') : null,
  };
}

const DATE_PRESETS: readonly DatePreset[] = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'this_month',
  'last_month',
  'last_3_months',
  'last_6_months',
  'this_year',
  'last_year',
  'all_time',
  'custom',
];

const parseCsv = (v?: string): string[] | undefined => {
  if (!v) return undefined;
  const arr = v.split(',').filter(Boolean);
  return arr.length ? arr : undefined;
};

const parseNum = (v?: string): number | undefined => {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Rebuild a filter from raw URL params, falling back to the default. */
export function filterFromQueryParams(
  params: Record<string, string | undefined>,
): GroupFilter {
  const rawPreset = params['datePreset'];
  const preset: DatePreset = DATE_PRESETS.includes(rawPreset as DatePreset)
    ? (rawPreset as DatePreset)
    : 'this_month';

  const txRaw = params['txType'];
  const transactionType: TransactionTypeFilter =
    txRaw === 'expense' || txRaw === 'refund' ? txRaw : 'both';

  const sortByRaw = params['sortBy'];
  const sortBy: GroupSortBy | undefined =
    sortByRaw === 'date' || sortByRaw === 'amount' ? sortByRaw : undefined;

  return {
    date: {
      preset,
      from: preset === 'custom' ? params['from'] || undefined : undefined,
      to: preset === 'custom' ? params['to'] || undefined : undefined,
    },
    categories: parseCsv(params['categories']),
    memberIds: parseCsv(params['memberIds']),
    paidByIds: parseCsv(params['paidByIds']),
    tagIds: parseCsv(params['tagIds']),
    transactionType,
    minAmount: parseNum(params['minAmount']),
    maxAmount: parseNum(params['maxAmount']),
    sortBy,
    sortOrder: sortBy
      ? params['sortOrder'] === 'asc'
        ? 'asc'
        : 'desc'
      : undefined,
  };
}

/** Toggle a value in an array field (add if absent, remove if present). */
export function toggleInArray(
  arr: string[] | undefined,
  value: string,
): string[] | undefined {
  const set = new Set(arr ?? []);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return set.size ? [...set] : undefined;
}
