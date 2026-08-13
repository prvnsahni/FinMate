import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { RedisService } from '../redis/redis.service';
import { EncryptionService } from '../encryption/encryption.service';
import { EmailService } from '../email/email.service';
import { ContactsService } from '../contacts/contacts.service';
import { User, AuditLog } from '@finmate/data-models';
import * as argon2 from 'argon2';
import { randomUUID, createHash } from 'crypto';
import { generateSecret, verifyTotp } from './utils/totp.util';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { redactSensitiveKeys } from '../common/log-redaction.util';

const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;
const PASSWORD_RESET_TTL_SECONDS = 60 * 60;
const PASSWORD_RESET_PREFIX = 'pwd_reset:';

@Injectable()
export class AuthService {
  private readonly jwtSecret: string;
  private readonly jwtRefreshSecret: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly encryptionService: EncryptionService,
    private readonly emailService: EmailService,
    private readonly contactsService: ContactsService,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {
    const jwtSecret = this.configService.get<string>('JWT_SECRET');
    const jwtRefreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET');

    if (!jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
    if (!jwtRefreshSecret) {
      throw new Error('JWT_REFRESH_SECRET environment variable is required');
    }

    this.jwtSecret = jwtSecret;
    this.jwtRefreshSecret = jwtRefreshSecret;
  }

  private getIpHash(ip?: string): string | undefined {
    if (!ip) return undefined;
    return createHash('sha256').update(ip).digest('hex');
  }

  private async writeAuditLog(opts: {
    actorUser: User;
    action: string;
    entityId: string;
    metadata?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    try {
      // SEC-W7: strip known-sensitive keys (email, tokens, secrets) so PII never
      // lands in audit_logs.metadataJson. The actorUser FK already identifies the
      // user, so no legitimate audit value is lost.
      const meta = redactSensitiveKeys(opts.metadata);
      if (opts.userAgent) {
        meta.userAgent = opts.userAgent;
      }
      await this.auditLogRepository.save(
        this.auditLogRepository.create({
          actorUser: opts.actorUser,
          action: opts.action,
          entityType: 'auth',
          entityId: opts.entityId,
          scope: 'personal',
          metadataJson: meta,
          ipHash: this.getIpHash(opts.ip),
        }),
      );
    } catch {
      // Audit log failures should never block primary operations
    }
  }

  async register(email: string, passwordPlain: string, displayName?: string) {
    const savedUser = await this.usersService.createUser(
      email,
      passwordPlain,
      displayName,
    );

    // The account is fully usable immediately — verification gates only the
    // Contact-claim step (see verifyEmail), never login or general app
    // access. Sending the email is best-effort and must never block
    // registration itself.
    this.sendVerificationEmail(savedUser).catch(() => {
      // best-effort — verification can be resent later
    });

    return this.serializeUser(savedUser);
  }

  /**
   * Issues a single-use, 24h verification token for the given user's current
   * email, stored server-side (Redis) rather than as a self-contained JWT so
   * it can be invalidated/single-used on verify. Emails a link; the token
   * itself is never logged or returned to the caller.
   */
  async sendVerificationEmail(user: User): Promise<void> {
    const token = randomUUID();
    await this.redisService.set(
      `email_verify:${token}`,
      user.id,
      EMAIL_VERIFICATION_TTL_SECONDS,
    );
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';
    const verifyUrl = `${frontendUrl}/auth/verify-email?token=${token}`;
    await this.emailService.sendVerificationEmail(user.email, verifyUrl);
  }

  /**
   * Confirms a verification token and, on success, runs the Contact-claim
   * fan-out for this user's now-verified email — linking every GroupMember
   * row from Contacts matching it, in one transaction, with zero new
   * Expense/ExpenseSplit/Settlement rows (see ContactsService.claimContactsForUser).
   * This is the only thing gated on verification; it never touches login.
   */
  async verifyEmail(token: string): Promise<{
    linkedGroupIds: string[];
    claimedContactIds: string[];
  }> {
    const redisKey = `email_verify:${token}`;
    // Atomic read-and-remove: a plain get()+del() lets two concurrent
    // requests for the same token both pass the get() before either
    // deletes it, running the Contact-claim fan-out twice. GETDEL closes
    // that window — a second concurrent caller now sees null, exactly like
    // an already-expired token.
    const userId = await this.redisService.getDel(redisKey);
    if (!userId) {
      throw new BadRequestException({
        errorCode: 'AUTH_VERIFICATION_INVALID',
        message: 'This verification link is invalid or has expired',
      });
    }

    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (!user.emailVerified) {
      user.emailVerified = true;
      await this.usersService.updateUser(user);
    }

    const claimResult = await this.contactsService.claimContactsForUser(user);

    void this.writeAuditLog({
      actorUser: user,
      action: 'auth.email_verified',
      entityId: user.id,
      metadata: {
        linkedGroupIds: claimResult.linkedGroupIds,
        claimedContactIds: claimResult.claimedContactIds,
      },
    });

    return claimResult;
  }

  /**
   * Forgot-password step 1: issue a single-use, 1h reset token for the given
   * email and send the reset link. Always resolves without revealing whether
   * the address is registered (anti-enumeration): unknown emails are a silent
   * no-op, and sending is best-effort. The token maps to the user id in Redis
   * and is never returned to the caller or logged.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user || user.status !== 'active') {
      return;
    }

    const token = randomUUID();
    await this.redisService.set(
      `${PASSWORD_RESET_PREFIX}${token}`,
      user.id,
      PASSWORD_RESET_TTL_SECONDS,
    );

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';
    const resetUrl = `${frontendUrl}/auth/reset-password?token=${token}`;
    await this.emailService.sendPasswordResetEmail(user.email, resetUrl);
  }

  /**
   * Forgot-password step 2 (peek): validates a reset token WITHOUT consuming it
   * and returns just enough for the client to run the zero-knowledge unwrap —
   * the account email (PBKDF2 salt), whether a recovery key exists, and the
   * recovery-wrapped private-key blob (ciphertext; safe to serve). A missing or
   * expired token throws so the reset page can show a generic invalid state.
   */
  async getPasswordResetContext(token: string): Promise<{
    email: string;
    hasRecoveryKey: boolean;
    recoveryWrappedKey: string | null;
  }> {
    const userId = await this.redisService.get(
      `${PASSWORD_RESET_PREFIX}${token}`,
    );
    if (!userId) {
      throw new BadRequestException({
        errorCode: 'AUTH_RESET_INVALID',
        message: 'This password reset link is invalid or has expired',
      });
    }

    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BadRequestException({
        errorCode: 'AUTH_RESET_INVALID',
        message: 'This password reset link is invalid or has expired',
      });
    }

    return {
      email: user.email,
      hasRecoveryKey: !!user.recoveryWrappedKey,
      recoveryWrappedKey: user.recoveryWrappedKey ?? null,
    };
  }

  /**
   * Forgot-password step 3 (consume): atomically single-uses the reset token,
   * swaps the password hash, stores the client-re-wrapped private key so
   * encrypted data stays accessible, and revokes every session (fresh login
   * required). Zero-knowledge — the server never sees plaintext key material.
   * A user with no recovery key cannot reach a valid submission (the client
   * blocks it), so encrypted data is never silently orphaned.
   */
  async resetPassword(
    token: string,
    newPassword: string,
    encryptedPrivateWrappingKey: string,
    context?: { ip?: string; userAgent?: string },
  ): Promise<void> {
    // GETDEL: atomic single-use — a concurrent second submit sees null.
    const userId = await this.redisService.getDel(
      `${PASSWORD_RESET_PREFIX}${token}`,
    );
    if (!userId) {
      throw new BadRequestException({
        errorCode: 'AUTH_RESET_INVALID',
        message: 'This password reset link is invalid or has expired',
      });
    }

    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new BadRequestException({
        errorCode: 'AUTH_RESET_INVALID',
        message: 'This password reset link is invalid or has expired',
      });
    }

    user.passwordHash = await argon2.hash(newPassword);
    user.encryptedPrivateWrappingKey = encryptedPrivateWrappingKey;
    await this.usersService.updateUser(user);

    // Force re-authentication everywhere with the new password.
    await this.revokeAllSessions(user.id);

    void this.writeAuditLog({
      actorUser: user,
      action: 'auth.password_reset',
      entityId: user.id,
      ip: context?.ip,
      userAgent: context?.userAgent,
    });
  }

  async login(
    email: string,
    passwordPlain: string,
    mfaCode?: string,
    context?: { ip?: string; userAgent?: string },
  ) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('User account is not active');
    }

    const isPasswordCorrect = await argon2.verify(
      user.passwordHash,
      passwordPlain,
    );
    if (!isPasswordCorrect) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check Multi-Factor Authentication
    if (user.isTwoFactorEnabled) {
      if (!mfaCode) {
        throw new ForbiddenException({
          errorCode: 'AUTH_MFA_REQUIRED',
          message: 'MFA verification required',
        });
      }

      const decryptedSecret = user.twoFactorSecret
        ? this.encryptionService.decrypt(user.twoFactorSecret)
        : '';
      const isMfaValid = verifyTotp(decryptedSecret, mfaCode);
      if (!isMfaValid) {
        throw new BadRequestException({
          errorCode: 'AUTH_MFA_INVALID',
          message: 'The provided 2FA verification code is invalid',
        });
      }
    }

    const refreshId = randomUUID();
    const accessToken = this.generateAccessToken(user.id, user.email);
    const refreshToken = this.generateRefreshToken(user.id, refreshId);

    // Hash active refresh token IDs stored in Redis using Argon2 before check/saving
    const sha256Id = createHash('sha256').update(refreshId).digest('hex');
    const redisKey = `refresh_token:${user.id}:${sha256Id}`;
    const argonHash = await argon2.hash(refreshId);

    // Save active session in Redis (7 days TTL)
    const sevenDaysInSeconds = 7 * 24 * 60 * 60;
    await this.redisService.set(redisKey, argonHash, sevenDaysInSeconds);

    // Update last login
    user.lastLoginAt = new Date();
    await this.usersService.updateUser(user);

    void this.writeAuditLog({
      actorUser: user,
      action: 'auth.login_success',
      entityId: user.id,
      // SEC-W7: email removed — actorUser FK already identifies the user
      ip: context?.ip,
      userAgent: context?.userAgent,
    });

    return {
      accessToken,
      refreshToken,
      user: this.serializeUser(user),
    };
  }

  async enable2Fa(user: User, context?: { ip?: string; userAgent?: string }) {
    const secret = generateSecret();
    user.twoFactorSecret = this.encryptionService.encrypt(secret);
    user.isTwoFactorEnabled = false; // pending verification
    await this.usersService.updateUser(user);

    void this.writeAuditLog({
      actorUser: user,
      action: 'auth.mfa_enabled_pending',
      entityId: user.id,
      ip: context?.ip,
      userAgent: context?.userAgent,
    });

    const qrCodeUrl = `otpauth://totp/FinMate:${user.email}?secret=${secret}&issuer=FinMate`;
    return {
      secret,
      qrCodeUrl,
    };
  }

  async verify2Fa(
    user: User,
    code: string,
    context?: { ip?: string; userAgent?: string },
  ) {
    if (!user.twoFactorSecret) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: '2FA setup not initiated',
      });
    }

    const decryptedSecret = this.encryptionService.decrypt(
      user.twoFactorSecret,
    );
    const isValid = verifyTotp(decryptedSecret, code);
    if (!isValid) {
      throw new BadRequestException({
        errorCode: 'AUTH_MFA_INVALID',
        message: 'The provided 6-digit TOTP code failed verification',
      });
    }

    user.isTwoFactorEnabled = true;
    await this.usersService.updateUser(user);

    void this.writeAuditLog({
      actorUser: user,
      action: 'auth.mfa_verified',
      entityId: user.id,
      ip: context?.ip,
      userAgent: context?.userAgent,
    });

    return { success: true };
  }

  async disable2Fa(
    user: User,
    code: string,
    context?: { ip?: string; userAgent?: string },
  ) {
    if (!user.isTwoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException({
        errorCode: 'VAL_INVALID_INPUT',
        message: '2FA is not enabled on this account',
      });
    }

    const decryptedSecret = this.encryptionService.decrypt(
      user.twoFactorSecret,
    );
    const isValid = verifyTotp(decryptedSecret, code);
    if (!isValid) {
      throw new BadRequestException({
        errorCode: 'AUTH_MFA_INVALID',
        message: 'The provided 6-digit TOTP code failed verification',
      });
    }

    user.isTwoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    await this.usersService.updateUser(user);

    void this.writeAuditLog({
      actorUser: user,
      action: 'auth.mfa_disabled',
      entityId: user.id,
      ip: context?.ip,
      userAgent: context?.userAgent,
    });

    return { success: true };
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.jwtRefreshSecret,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Token expired');
      }
      throw new UnauthorizedException('Invalid token');
    }

    if (!payload || !payload.userId || !payload.refreshId) {
      throw new UnauthorizedException('Invalid token');
    }

    const { userId, refreshId } = payload;
    const sha256Id = createHash('sha256').update(refreshId).digest('hex');
    const redisKey = `refresh_token:${userId}:${sha256Id}`;
    const storedHash = await this.redisService.get(redisKey);

    if (!storedHash) {
      throw new UnauthorizedException('Invalid token');
    }

    const isTokenValid = await argon2.verify(storedHash, refreshId);
    if (!isTokenValid) {
      throw new UnauthorizedException('Invalid token');
    }

    // Revoke old refresh token (token rotation)
    await this.redisService.del(redisKey);

    // Get user details
    const user = await this.usersService.findById(userId);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid token');
    }

    // Generate new token pair
    const newRefreshId = randomUUID();
    const newAccessToken = this.generateAccessToken(user.id, user.email);
    const newRefreshToken = this.generateRefreshToken(user.id, newRefreshId);

    // Store new active refresh token
    const newSha256Id = createHash('sha256').update(newRefreshId).digest('hex');
    const newRedisKey = `refresh_token:${user.id}:${newSha256Id}`;
    const newArgonHash = await argon2.hash(newRefreshId);
    const sevenDaysInSeconds = 7 * 24 * 60 * 60;
    await this.redisService.set(newRedisKey, newArgonHash, sevenDaysInSeconds);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Revokes every active refresh-token session for a user by deleting all
   * `refresh_token:${userId}:*` keys from Redis.
   */
  async revokeAllSessions(userId: string): Promise<void> {
    const keys = await this.redisService.scanKeys(`refresh_token:${userId}:*`);
    await Promise.all(keys.map((k) => this.redisService.del(k)));
  }

  /**
   * Change password when the current password is known.
   * Zero-knowledge: the client re-derives the master key from the new password
   * and re-wraps the private wrapping key (and optionally the recovery blob);
   * the server only verifies the old password, swaps the hash, stores the
   * re-wrapped ciphertext, and revokes all sessions so a fresh login is required.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    encryptedPrivateWrappingKey: string,
    recoveryWrappedKey?: string,
    context?: { ip?: string; userAgent?: string },
  ): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isCurrentValid = await argon2.verify(
      user.passwordHash,
      currentPassword,
    );
    if (!isCurrentValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    user.passwordHash = await argon2.hash(newPassword);
    user.encryptedPrivateWrappingKey = encryptedPrivateWrappingKey;
    if (recoveryWrappedKey !== undefined) {
      user.recoveryWrappedKey = recoveryWrappedKey;
      user.recoveryKeyCreatedAt = new Date();
    }
    await this.usersService.updateUser(user);

    // Force re-authentication everywhere
    await this.revokeAllSessions(userId);

    void this.writeAuditLog({
      actorUser: user,
      action: 'auth.password_changed',
      entityId: user.id,
      ip: context?.ip,
      userAgent: context?.userAgent,
    });
  }

  async logout(refreshToken: string, currentUserId: string) {
    let payload: JwtPayload | null = null;
    try {
      const decoded = this.jwtService.decode(refreshToken);
      payload =
        typeof decoded === 'object' && decoded !== null
          ? (decoded as JwtPayload)
          : null;
    } catch (err) {
      // ignore parsing error
    }

    if (payload && payload.userId && payload.refreshId) {
      if (payload.userId !== currentUserId) {
        throw new ForbiddenException('Cannot log out another user session');
      }
      const sha256Id = createHash('sha256')
        .update(payload.refreshId)
        .digest('hex');
      await this.redisService.del(
        `refresh_token:${payload.userId}:${sha256Id}`,
      );
    }
  }

  private generateAccessToken(userId: string, email: string): string {
    return this.jwtService.sign(
      { userId, email },
      {
        secret: this.jwtSecret,
        expiresIn: '15m',
      },
    );
  }

  private generateRefreshToken(userId: string, refreshId: string): string {
    return this.jwtService.sign(
      { userId, refreshId },
      {
        secret: this.jwtRefreshSecret,
        expiresIn: '7d',
      },
    );
  }

  private serializeUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
