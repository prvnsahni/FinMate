import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

// Local query DTO skeleton for listing/filtering expenses.
export class ListExpensesQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsUUID('4')
  groupId?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  /** Group member (participant via splits) to filter by. Carries a group-member id. */
  @IsOptional()
  @IsUUID('4')
  memberId?: string;

  /** Payer to filter by. Carries a group-member id. */
  @IsOptional()
  @IsUUID('4')
  paidById?: string;

  /** `both` (or omitted) applies no transaction-type filter. */
  @IsOptional()
  @IsIn(['expense', 'refund', 'both'])
  transactionType?: 'expense' | 'refund' | 'both';

  /** Canonical tag ids (comma-separated) — matches ANY (TAG-BATCH-B). */
  @IsOptional()
  @IsString()
  tagIds?: string;
}
