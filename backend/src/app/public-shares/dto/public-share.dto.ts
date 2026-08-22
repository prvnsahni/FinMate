import { IsDateString, IsOptional } from 'class-validator';

/**
 * PUBLIC-1B — request body for creating/regenerating a group's public share.
 * Only an OPTIONAL future `expiresAt` is accepted; scope/role/group are NEVER
 * taken from the body (group comes from the route, role is enforced server-side).
 */
export class CreatePublicShareDto {
  @IsOptional()
  @IsDateString({}, { message: 'expiresAt must be a valid ISO date string' })
  expiresAt?: string;
}

/**
 * PUBLIC-1B — the create/regenerate response. Carries the RAW capability token
 * exactly once (password-equivalent secret: never returned by GET, never stored,
 * never logged). It deliberately excludes `tokenHash`, `groupId`, and every
 * internal user/member id, E2EE field, and finance field.
 */
export interface PublicShareSecretResponse {
  /** The raw high-entropy capability token — shown ONCE, never persisted. */
  token: string;
  status: 'active';
  expiresAt: string | null;
  createdAt: Date;
  revokedAt: Date | null;
}

/**
 * PUBLIC-1B — the owner/admin status response. NEVER contains the raw token or
 * the token hash (nor group/user ids). `active` accounts for both status and
 * expiry.
 */
export interface PublicShareStatusResponse {
  active: boolean;
  status: 'active' | 'revoked' | null;
  expiresAt: string | null;
  createdAt: Date | null;
  revokedAt: Date | null;
}
