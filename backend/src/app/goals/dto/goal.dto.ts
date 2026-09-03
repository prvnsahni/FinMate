import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { IsCiphertext } from '../../common/decorators/is-ciphertext.decorator';

/**
 * Goals-v2 request DTOs. `title` is CLIENT CIPHERTEXT (born-E2EE) and
 * `encryptedContentKey` is the owner's RSA-wrapped per-goal content key — the
 * server validates/stores them opaquely and NEVER decrypts.
 */
export class CreateGoalDto {
  /** E2EE ciphertext of the title — opaque to the server. */
  @IsString()
  @IsNotEmpty({ message: 'Encrypted title is required' })
  @IsCiphertext({
    message: 'Goal title could not be processed securely. Please try again.',
  })
  title!: string;

  /** Owner's RSA-wrapped content key (required so every goal is born-E2EE). */
  @IsString()
  @IsNotEmpty({ message: 'encryptedContentKey is required (born-E2EE)' })
  encryptedContentKey!: string;

  @IsNumber()
  @IsPositive({ message: 'targetAmount must be greater than zero' })
  targetAmount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  savedAmount?: number;

  @IsString()
  @Length(3, 3, { message: 'currency must be a 3-letter ISO code' })
  currency!: string;

  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'targetDate must be a valid date' })
  targetDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class UpdateGoalDto {
  /** Optimistic-lock version the client last saw. */
  @IsInt()
  version!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsCiphertext({
    message: 'Goal title could not be processed securely. Please try again.',
  })
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  encryptedContentKey?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  targetAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  savedAmount?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsISO8601({ strict: false })
  targetDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsIn(['active', 'achieved', 'paused', 'cancelled'])
  status?: 'active' | 'achieved' | 'paused' | 'cancelled';
}
