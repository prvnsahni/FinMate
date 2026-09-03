import {
  IsEmail,
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  IsOptional,
  Matches,
} from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Must be a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password!: string;

  @IsString()
  @IsOptional()
  @MaxLength(120, { message: 'Display name cannot exceed 120 characters' })
  displayName?: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'Must be a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password!: string;

  @IsString()
  @IsOptional()
  deviceId?: string;
}

export class RefreshTokenDto {
  // Optional so the cookie transport (BATCH-06) can carry the refresh token in a
  // host-only HttpOnly cookie instead of the body. Presence is enforced in the
  // controller: the legacy path still requires a body token (400 otherwise), and
  // the cookie path reads it from the cookie. Backward-compatible loosening —
  // existing clients keep sending it in the body.
  @IsString()
  @IsOptional()
  refreshToken?: string;
}

export class Verify2FaDto {
  @IsString()
  @IsNotEmpty({ message: '2FA verification code is required' })
  @Matches(/^[0-9]{6}$/, {
    message: 'Verification code must be exactly 6 digits',
  })
  code!: string;
}

/**
 * Change password with the old password known.
 * The client re-derives the master key from the new password and re-wraps the
 * private wrapping key; the server never sees plaintext key material.
 */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Current password is required' })
  currentPassword!: string;

  @IsString()
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  newPassword!: string;

  /** Private wrapping key re-encrypted under the new master key (ciphertext blob). */
  @IsString()
  @IsNotEmpty({
    message: 'Re-wrapped private key is required to preserve encrypted data',
  })
  encryptedPrivateWrappingKey!: string;

  /** Optional: recovery blob re-wrapped so recovery still works after the change. */
  @IsString()
  @IsOptional()
  recoveryWrappedKey?: string;
}

/**
 * Request a password-reset email. The response is always generic (never
 * reveals whether the address is registered) to prevent account enumeration.
 */
export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Must be a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;
}

/**
 * Complete a password reset via emailed token (forgot-password flow).
 * Zero-knowledge: the client unwraps its private wrapping key with the recovery
 * code, re-wraps it under the new master key, and submits the ciphertext. The
 * server only validates the token, swaps the password hash, stores the
 * re-wrapped blob, and revokes all sessions — it never sees plaintext keys.
 */
export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Reset token is required' })
  token!: string;

  @IsString()
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  newPassword!: string;

  /** Private wrapping key re-encrypted under the new master key (ciphertext blob). */
  @IsString()
  @IsNotEmpty({
    message: 'Re-wrapped private key is required to preserve encrypted data',
  })
  encryptedPrivateWrappingKey!: string;
}
