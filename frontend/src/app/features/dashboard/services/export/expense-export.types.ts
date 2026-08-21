/**
 * Export domain types, shared across formats.
 *
 * The column mapping lives here (format-agnostic) so every workbook builder —
 * xlsx today, csv/pdf later — renders the same business data. Builders decide
 * only how to serialize; they never decide what a column means.
 */

export type ExportFormat = 'xlsx' | 'csv';

/** Filters posted to `GET /expenses/export`. Dates are `YYYY-MM-DD`. */
export interface ExportFilter {
  from: string;
  to: string;
  type?: 'personal' | 'group' | 'all';
  category?: string;
  status?: 'settled' | 'pending';
  currency?: string;
  /**
   * When set, switches to group-ledger mode: the export contains every expense
   * in this group (with the caller's own share surfaced per row), not just the
   * caller's share. Used by the group-detail export.
   */
  groupId?: string;
  // ── Unified group-filter dimensions (group-ledger mode only) ───────────────
  /** Categories (exact names) — matches ANY. */
  categories?: string[];
  /** Group-member ids (participants via splits) — matches ANY. */
  memberIds?: string[];
  /** Group-member ids (payers) — matches ANY. */
  paidByIds?: string[];
  /** Omit or 'both' to apply no transaction-type filter. */
  transactionType?: 'expense' | 'refund' | 'both';
  /** Inclusive amount bounds. */
  minAmount?: number;
  maxAmount?: number;
  /** Canonical tag ids — matches ANY (TAG-BATCH-B). Filters rows only; no new column. */
  tagIds?: string[];
}

/**
 * A row as returned by the backend. `title`/`description` arrive as ciphertext
 * and are decrypted in place by the existing expense decryption pipeline before
 * a workbook is built (the shape is compatible with `DecryptableExpense`).
 */
export interface ExportRow {
  id: string;
  expenseDate: string;
  createdAt: string;
  title: string;
  description: string | null;
  encryptionScope?: 'personal' | 'group' | 'direct_shared';
  groupId?: string | null;
  groupKeyVersionId?: string | null;
  wrappedContentKeys?: Array<{ userId: string; wrappedKey: string }>;
  amountTotal: number;
  myShare: number;
  /** `expense` (default) or `refund` — a refund is a negative expense. */
  transactionType?: 'expense' | 'refund';
  currency: string;
  category: string;
  expenseType: 'PERSONAL' | 'GROUP_SHARE';
  groupName: string | null;
  paidByDisplayName: string | null;
  splitType: string | null;
  isSettled: boolean;
  status: string;
}

export type CellType = 'text' | 'number' | 'date';

export interface ExportColumn {
  header: string;
  type: CellType;
  value: (row: ExportRow) => string | number | null;
}

/** Format a `YYYY-MM-DD` (or ISO) date string as `YYYY-MM-DD`. */
function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 10);
}

/** Format an ISO timestamp as `YYYY-MM-DD HH:mm` in local time. */
function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function statusLabel(row: ExportRow): string {
  if (row.expenseType === 'PERSONAL') return 'N/A';
  return row.isSettled ? 'Settled' : 'Pending';
}

/**
 * The exported columns, in order. The expense entity carries `title` (the
 * primary label) and `description` (secondary free text); these map to the
 * "Description" and "Notes" columns respectively.
 */
export const EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'Date', type: 'date', value: (r) => formatDate(r.expenseDate) },
  { header: 'Description', type: 'text', value: (r) => r.title ?? '' },
  { header: 'Amount', type: 'number', value: (r) => r.amountTotal },
  {
    header: 'Type',
    type: 'text',
    value: (r) => (r.transactionType === 'refund' ? 'Refund' : 'Expense'),
  },
  { header: 'Currency', type: 'text', value: (r) => r.currency },
  { header: 'Category', type: 'text', value: (r) => r.category },
  {
    header: 'Expense Type',
    type: 'text',
    value: (r) => (r.expenseType === 'GROUP_SHARE' ? 'Group' : 'Personal'),
  },
  { header: 'Group Name', type: 'text', value: (r) => r.groupName ?? '' },
  { header: 'Paid By', type: 'text', value: (r) => r.paidByDisplayName ?? '' },
  { header: 'Split Type', type: 'text', value: (r) => r.splitType ?? '' },
  { header: 'Your Share', type: 'number', value: (r) => r.myShare },
  { header: 'Status', type: 'text', value: statusLabel },
  { header: 'Notes', type: 'text', value: (r) => r.description ?? '' },
  {
    header: 'Created At',
    type: 'date',
    value: (r) => formatDateTime(r.createdAt),
  },
];

/**
 * Suggested download filename, e.g.
 * `finmate-expenses-2026-01-01_to_2026-03-31.xlsx`.
 */
export function buildExportFilename(
  filter: Pick<ExportFilter, 'from' | 'to'>,
  extension: string,
): string {
  const from = filter.from || 'start';
  const to = filter.to || 'end';
  return `finmate-expenses-${from}_to_${to}.${extension}`;
}

/** Context describing a single export run, rendered onto the info sheet. */
export interface ExportMeta {
  filter: ExportFilter;
  total: number;
  exportedOn: Date;
}

/** Format a Date as `YYYY-MM-DD HH:mm UTC`. */
export function formatUtcTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
}

const TYPE_LABELS: Record<NonNullable<ExportFilter['type']>, string> = {
  all: 'All',
  personal: 'Personal',
  group: 'Group',
};

/**
 * Rows for the "Export Information" cover sheet (a `[label, value]` matrix).
 * Format-agnostic so any builder can render it — a second worksheet for xlsx,
 * a header block or sidecar for a future CSV/PDF builder.
 */
export function buildExportInfoMatrix(meta: ExportMeta): (string | number)[][] {
  const { filter, total, exportedOn } = meta;
  const statusLabel = filter.status
    ? filter.status === 'settled'
      ? 'Settled'
      : 'Pending'
    : 'All';

  const rows: (string | number)[][] = [
    ['Export Information'],
    [],
    ['Generated By', 'FinMate'],
    ['Exported On', formatUtcTimestamp(exportedOn)],
    ['From', filter.from],
    ['To', filter.to],
    [],
    ['Filters'],
    ['Type', TYPE_LABELS[filter.type ?? 'all']],
    ['Status', statusLabel],
  ];
  if (filter.category) rows.push(['Category', filter.category]);
  if (filter.currency) rows.push(['Currency', filter.currency]);
  rows.push([], ['Total Transactions', total]);

  return rows;
}
