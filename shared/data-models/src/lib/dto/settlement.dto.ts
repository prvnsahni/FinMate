import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsNumber,
  Min,
  IsUUID,
  IsEnum,
  IsInt,
  IsDateString,
} from 'class-validator';

export class ProposeSettlementDto {
  /** Legacy path — resolves the recipient by their User id. */
  @IsUUID('4', { message: 'Recipient User ID must be a valid UUID' })
  @IsOptional()
  toUserId?: string;

  /**
   * Primary path — resolves the recipient by their GroupMember id, whether
   * they are a registered User or a pending Contact. Provide this or
   * `toUserId`.
   */
  @IsUUID('4', { message: 'Recipient GroupMember ID must be a valid UUID' })
  @IsOptional()
  toGroupMemberId?: string;

  @IsNumber(
    {},
    { message: 'Transfer amount must be a valid numeric currency value' },
  )
  @Min(0.01, { message: 'Transfer amount must be greater than zero' })
  amount!: number;

  @IsString()
  @IsNotEmpty({ message: 'Currency code is required' })
  @MaxLength(3, { message: 'Currency code must be exactly 3 characters' })
  currency!: string;

  @IsString()
  @IsOptional()
  note?: string;
}

export class UpdateSettlementDto {
  @IsEnum(['confirmed', 'cancelled'], {
    message: 'Invalid settlement status update option',
  })
  @IsNotEmpty({ message: 'Settlement status update choice is required' })
  status!: 'confirmed' | 'cancelled';

  @IsDateString(
    {},
    {
      message:
        'Settlement confirmation date must be a valid ISO date string (YYYY-MM-DD)',
    },
  )
  @IsOptional()
  settledOn?: string;

  @IsInt({ message: 'Version must be an integer' })
  @IsNotEmpty({ message: 'Version is required to resolve concurrent edits' })
  version!: number;
}

/**
 * One-step "record a cash payment" between two group members, created directly
 * as `confirmed`. Only permitted when at least one party is a non-registered
 * (Contact-backed) member — when both are registered users the propose/accept
 * flow (`ProposeSettlementDto`) must be used instead, so both sides consent.
 */
export class RecordPaymentDto {
  @IsUUID('4', { message: 'Payer GroupMember ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Payer GroupMember ID is required' })
  fromMemberId!: string;

  @IsUUID('4', { message: 'Payee GroupMember ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Payee GroupMember ID is required' })
  toMemberId!: string;

  @IsNumber(
    {},
    { message: 'Payment amount must be a valid numeric currency value' },
  )
  @Min(0.01, { message: 'Payment amount must be greater than zero' })
  amount!: number;

  @IsString()
  @IsNotEmpty({ message: 'Currency code is required' })
  @MaxLength(3, { message: 'Currency code must be exactly 3 characters' })
  currency!: string;

  @IsString()
  @IsOptional()
  note?: string;
}
