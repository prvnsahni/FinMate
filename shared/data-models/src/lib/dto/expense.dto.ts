import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
  Max,
  IsUUID,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
  IsInt,
  IsDateString,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * TAG-BATCH-A — one confirmed DOC-5 taxonomy tag sent with an expense-create
 * payload. Descriptive Zone-2 metadata only; carries a stable canonical `tagId`
 * (never free text) and its DOC-5 authority/provenance. Ancestors and de-dup are
 * resolved server-side by `materializeConfirmedExpenseTags`, so the client may
 * send just the tags it confirmed.
 */
export class ConfirmedExpenseTagDto {
  @IsString()
  @IsNotEmpty({ message: 'tagId is required' })
  @MaxLength(64, { message: 'tagId cannot exceed 64 characters' })
  tagId!: string;

  @IsIn(['INFERRED', 'USER_CORRECTED', 'USER_CONFIRMED'], {
    message: 'authority must be INFERRED, USER_CORRECTED, or USER_CONFIRMED',
  })
  authority!: 'INFERRED' | 'USER_CORRECTED' | 'USER_CONFIRMED';

  @IsIn(['rule_based', 'user', 'model', 'population'], {
    message: 'source must be rule_based, user, model, or population',
  })
  @IsOptional()
  source?: 'rule_based' | 'user' | 'model' | 'population';

  @IsNumber({}, { message: 'confidence must be a number' })
  @Min(0, { message: 'confidence cannot be negative' })
  @Max(1, { message: 'confidence cannot exceed 1' })
  @IsOptional()
  confidence?: number;
}

/** Per-participant wrapped content key for direct_shared expenses. */
export class WrappedContentKeyDto {
  @IsUUID('4')
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  wrappedKey!: string;
}

/** Encrypted attachment metadata sent from the client. */
export class EncryptedAttachmentDto {
  @IsString()
  @IsNotEmpty()
  storageKey!: string;

  @IsString()
  @IsNotEmpty()
  encryptedOriginalName!: string;

  @IsString()
  @IsNotEmpty()
  encryptedFileKey!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @IsNumber()
  @Min(0)
  sizeBytes!: number;
}

export class ExpenseSplitInputDto {
  @IsUUID('4', { message: 'Participant User ID must be a valid UUID v4' })
  @IsOptional()
  participantUserId?: string;

  @IsUUID('4', {
    message: 'Participant Group Member ID must be a valid UUID v4',
  })
  @IsOptional()
  participantGroupMemberId?: string;

  @IsEnum(['equal', 'fixed', 'percent', 'share'], {
    message: 'Invalid split algorithm type',
  })
  @IsNotEmpty({ message: 'Split type is required' })
  splitType!: 'equal' | 'fixed' | 'percent' | 'share';

  @IsNumber(
    {},
    { message: 'Share value must be a valid numeric calculation decimal' },
  )
  @Min(0, { message: 'Share value cannot be negative' })
  shareValue!: number;
}

export class CreateExpenseDto {
  @IsString()
  @IsNotEmpty({ message: 'Expense title is required' })
  @MaxLength(160, { message: 'Expense title cannot exceed 160 characters' })
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber(
    {},
    { message: 'Total amount must be a valid numeric currency value' },
  )
  @Min(0.01, { message: 'Total amount must be greater than zero' })
  amountTotal!: number;

  @IsString()
  @IsNotEmpty({ message: 'Currency code is required' })
  @MaxLength(3, { message: 'Currency code must be exactly 3 characters' })
  currency!: string;

  @IsString()
  @IsNotEmpty({ message: 'Expense category is required' })
  @MaxLength(64, { message: 'Expense category cannot exceed 64 characters' })
  category!: string;

  /**
   * `expense` (default) = money spent; `refund` = money returned to the group.
   * A refund reuses the same paidBy/split model but is treated as a negative
   * expense in every balance and net-spending calculation.
   */
  @IsIn(['expense', 'refund'], {
    message: 'transactionType must be expense or refund',
  })
  @IsOptional()
  transactionType?: 'expense' | 'refund';

  /** Required for personal expenses; for group expenses, this or paidByGroupMemberId. */
  @IsUUID('4', { message: 'Paid-by User ID must be a valid UUID' })
  @IsOptional()
  paidByUserId?: string;

  /** Group expenses only — a pending (Contact-backed) member as payer. */
  @IsUUID('4', { message: 'Paid-by Group Member ID must be a valid UUID' })
  @IsOptional()
  paidByGroupMemberId?: string;

  @IsUUID('4', { message: 'Group ID must be a valid UUID' })
  @IsOptional()
  groupId?: string;

  @IsUUID('4', { message: 'Group key version ID must be a valid UUID' })
  @IsOptional()
  groupKeyVersionId?: string;

  @IsDateString(
    {},
    { message: 'Expense date must be a valid ISO date string (YYYY-MM-DD)' },
  )
  @IsNotEmpty({ message: 'Expense date is required' })
  expenseDate!: string;

  @IsEnum(['draft', 'posted', 'void'], {
    message: 'Invalid expense status option',
  })
  @IsOptional()
  status?: 'draft' | 'posted' | 'void';

  @IsArray({ message: 'Splits must be a valid collection array' })
  @ValidateNested({ each: true })
  @Type(() => ExpenseSplitInputDto)
  splits!: ExpenseSplitInputDto[];

  @IsArray({ message: 'Attachment keys must be an array of strings' })
  @IsString({
    each: true,
    message: 'Each attachment storage key must be a string',
  })
  @IsOptional()
  attachmentKeys?: string[];

  @IsIn(['personal', 'group', 'direct_shared'], {
    message: 'encryptionScope must be personal, group, or direct_shared',
  })
  @IsOptional()
  encryptionScope?: 'personal' | 'group' | 'direct_shared';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WrappedContentKeyDto)
  @IsOptional()
  wrappedContentKeys?: WrappedContentKeyDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EncryptedAttachmentDto)
  @IsOptional()
  encryptedAttachments?: EncryptedAttachmentDto[];

  /**
   * TAG-BATCH-A — confirmed DOC-5 taxonomy tags to persist against the new
   * expense (descriptive Zone-2 metadata only; never touches finance). Present
   * only when the expense was created from a confirmed document/receipt draft or
   * explicit user selection. Absent for total-only receipts and manual creation.
   * Deliberately NOT on `UpdateExpenseDto`: an ordinary edit must not
   * reclassify or destroy confirmed tags.
   */
  @IsArray({ message: 'tags must be an array' })
  @ArrayMaxSize(200, { message: 'tags cannot exceed 200 entries' })
  @ValidateNested({ each: true })
  @Type(() => ConfirmedExpenseTagDto)
  @IsOptional()
  tags?: ConfirmedExpenseTagDto[];
}

export class UpdateExpenseDto {
  @IsString()
  @IsOptional()
  @MaxLength(160, { message: 'Expense title cannot exceed 160 characters' })
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber(
    {},
    { message: 'Total amount must be a valid numeric currency value' },
  )
  @Min(0.01, { message: 'Total amount must be greater than zero' })
  amountTotal?: number;

  @IsString()
  @IsOptional()
  @MaxLength(3, { message: 'Currency code must be exactly 3 characters' })
  currency?: string;

  @IsString()
  @IsOptional()
  @MaxLength(64, { message: 'Expense category cannot exceed 64 characters' })
  category?: string;

  @IsIn(['expense', 'refund'], {
    message: 'transactionType must be expense or refund',
  })
  @IsOptional()
  transactionType?: 'expense' | 'refund';

  @IsUUID('4', { message: 'Paid-by User ID must be a valid UUID' })
  @IsOptional()
  paidByUserId?: string;

  /** Group expenses only — a pending (Contact-backed) member as payer. */
  @IsUUID('4', { message: 'Paid-by Group Member ID must be a valid UUID' })
  @IsOptional()
  paidByGroupMemberId?: string;

  @IsUUID('4', { message: 'Group key version ID must be a valid UUID' })
  @IsOptional()
  groupKeyVersionId?: string;

  @IsDateString(
    {},
    { message: 'Expense date must be a valid ISO date string (YYYY-MM-DD)' },
  )
  @IsOptional()
  expenseDate?: string;

  @IsEnum(['draft', 'posted', 'void'], {
    message: 'Invalid expense status option',
  })
  @IsOptional()
  status?: 'draft' | 'posted' | 'void';

  @IsArray({ message: 'Splits must be a valid collection array' })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ExpenseSplitInputDto)
  splits?: ExpenseSplitInputDto[];

  @IsArray({ message: 'Attachment keys must be an array of strings' })
  @IsString({
    each: true,
    message: 'Each attachment storage key must be a string',
  })
  @IsOptional()
  attachmentKeys?: string[];

  @IsIn(['personal', 'group', 'direct_shared'], {
    message: 'encryptionScope must be personal, group, or direct_shared',
  })
  @IsOptional()
  encryptionScope?: 'personal' | 'group' | 'direct_shared';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WrappedContentKeyDto)
  @IsOptional()
  wrappedContentKeys?: WrappedContentKeyDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EncryptedAttachmentDto)
  @IsOptional()
  encryptedAttachments?: EncryptedAttachmentDto[];

  @IsInt({ message: 'Version must be an integer' })
  @IsNotEmpty({ message: 'Version is required to resolve concurrent edits' })
  version!: number;
}
