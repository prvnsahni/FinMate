import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { IsCiphertext } from '../../common/decorators/is-ciphertext.decorator';

/**
 * TAG-BATCH-C2 — rename a custom tag (personal or group), resolved by id.
 *
 * A rename simply REPLACES the opaque E2EE payload — the server never inspects
 * the old or new name. `version` carries the caller's last-seen optimistic-lock
 * value and is checked exactly like the group update flow
 * (`CON_VERSION_CONFLICT`) to prevent a silent overwrite. For a group tag the
 * client may pass the current `groupKeyVersionId` it re-encrypted under; this
 * reuses the existing group-key version discipline and invents no
 * re-encryption flow.
 */
export class UpdateCustomTagDto {
  @IsString()
  @IsNotEmpty({ message: 'encryptedName is required' })
  @MaxLength(4096, { message: 'encryptedName is too large' })
  @IsCiphertext({
    message: 'Tag name could not be processed securely. Please try again.',
  })
  encryptedName!: string;

  @Type(() => Number)
  @IsInt({ message: 'version must be an integer' })
  @Min(0, { message: 'version must be zero or greater' })
  version!: number;

  @IsUUID('4', { message: 'groupKeyVersionId must be a valid UUID v4' })
  @IsOptional()
  groupKeyVersionId?: string;
}
