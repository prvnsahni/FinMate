import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

/**
 * Query DTO for `GET /expenses/export`.
 *
 * The endpoint returns the caller's expense rows (personal + their share of
 * group expenses) matching these filters. Titles/descriptions come back as
 * ciphertext — decryption happens client-side, preserving the zero-knowledge
 * guarantee. See ExpenseExportQueryService.
 */
export class ExportExpensesQueryDto {
  /**
   * When set, switches to group-ledger mode: the endpoint returns every
   * expense in this group (not just the caller's share), provided the caller
   * is a member. Used by the group-detail export.
   */
  @IsOptional()
  @IsString()
  groupId?: string;

  /** Inclusive lower bound on expense date (YYYY-MM-DD). */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Inclusive upper bound on expense date (YYYY-MM-DD). */
  @IsOptional()
  @IsDateString()
  to?: string;

  /**
   * Which expense kinds to include. `all` (default) returns both the caller's
   * personal expenses and their share of group expenses.
   */
  @IsOptional()
  @IsIn(['personal', 'group', 'all'])
  type?: 'personal' | 'group' | 'all';

  /** Filter to a single category (exact match). */
  @IsOptional()
  @IsString()
  category?: string;

  /**
   * Settlement status. Only meaningful for group shares; personal expenses have
   * no settlement concept and are excluded when a specific status is requested.
   */
  @IsOptional()
  @IsIn(['settled', 'pending'])
  status?: 'settled' | 'pending';

  /** Filter to a single ISO currency code (case-insensitive). */
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  currency?: string;

  // ── Unified group-filter dimensions (group-ledger mode only) ───────────────

  /** Categories (comma-separated) — matches ANY. */
  @IsOptional()
  @Transform(({ value }) => splitCsv(value))
  categories?: string[];

  /** Members (participants via splits) — comma-separated group-member ids. */
  @IsOptional()
  @Transform(({ value }) => splitCsv(value))
  memberIds?: string[];

  /** Payers — comma-separated group-member ids. */
  @IsOptional()
  @Transform(({ value }) => splitCsv(value))
  paidByIds?: string[];

  /** `both` (or omitted) applies no transaction-type filter. */
  @IsOptional()
  @IsIn(['expense', 'refund', 'both'])
  transactionType?: 'expense' | 'refund' | 'both';

  /** Inclusive amount bounds. */
  @IsOptional()
  @Transform(({ value }) => toNum(value))
  @IsNumber()
  minAmount?: number;

  @IsOptional()
  @Transform(({ value }) => toNum(value))
  @IsNumber()
  maxAmount?: number;

  /** TAG-BATCH-B — canonical tag ids (comma-separated) — matches ANY. Filters only. */
  @IsOptional()
  @Transform(({ value }) => splitCsv(value))
  tagIds?: string[];
}

function splitCsv(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.length ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const arr = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? arr : undefined;
}

function toNum(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
