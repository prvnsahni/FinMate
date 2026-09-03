import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/**
 * TAG-BATCH-C5b — restore a deprecated custom tag (`deprecated → active`). Carries
 * ONLY the caller's last-seen optimistic-lock `version`; the encrypted name and
 * group-key version are untouched (the server never inspects the name). A stale
 * value returns the existing `CON_VERSION_CONFLICT`.
 */
export class RestoreCustomTagDto {
  @Type(() => Number)
  @IsInt({ message: 'version must be an integer' })
  @Min(0, { message: 'version must be zero or greater' })
  version!: number;
}
