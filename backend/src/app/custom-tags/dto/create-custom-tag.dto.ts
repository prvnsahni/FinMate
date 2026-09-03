import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IsCiphertext } from '../../common/decorators/is-ciphertext.decorator';

/**
 * TAG-BATCH-C2 — create a PERSONAL custom tag.
 *
 * The scope (`personal`) and the owner (the authenticated user) are derived
 * from the route + JWT, NEVER from the body, so a caller cannot inject a group
 * scope or a foreign owner. The server receives ONLY the client-produced E2EE
 * ciphertext of the name (`iv:ciphertext`, same shape as `expense.title`) and
 * never a plaintext/normalized/hash name — it stores it opaquely and never
 * decrypts it.
 */
export class CreatePersonalCustomTagDto {
  @IsString()
  @IsNotEmpty({ message: 'encryptedName is required' })
  @MaxLength(4096, { message: 'encryptedName is too large' })
  @IsCiphertext({
    message: 'Tag name could not be processed securely. Please try again.',
  })
  encryptedName!: string;
}

/**
 * TAG-BATCH-C2 — create a GROUP custom tag.
 *
 * The scope (`group`) and the target group come from the route; membership is
 * enforced server-side. As with expenses, an optional `groupKeyVersionId`
 * records the group-key version the client encrypted the name under (SEC-KI1
 * version discipline); when omitted the group's current ACTIVE version is used.
 * The server still never decrypts the name.
 */
export class CreateGroupCustomTagDto {
  @IsString()
  @IsNotEmpty({ message: 'encryptedName is required' })
  @MaxLength(4096, { message: 'encryptedName is too large' })
  @IsCiphertext({
    message: 'Tag name could not be processed securely. Please try again.',
  })
  encryptedName!: string;

  @IsUUID('4', { message: 'groupKeyVersionId must be a valid UUID v4' })
  @IsOptional()
  groupKeyVersionId?: string;
}
