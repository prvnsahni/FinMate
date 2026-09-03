import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { EncryptionService } from '../encryption/encryption.service';
import { EmailService } from '../email/email.service';
import { ContactsService } from '../contacts/contacts.service';
import { AuditLog } from '@finmate/data-models';
import {
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { generateTotp } from './utils/totp.util';
import { createHash } from 'crypto';

jest.mock('argon2');

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;
  let redisService: jest.Mocked<RedisService>;
  let encryptionService: jest.Mocked<EncryptionService>;
  let emailService: {
    sendEmail: jest.Mock;
    sendVerificationEmail: jest.Mock;
    sendPasswordResetEmail: jest.Mock;
  };
  let contactsService: { claimContactsForUser: jest.Mock };
  let auditLogRepo: { save: jest.Mock; create: jest.Mock };

  beforeEach(async () => {
    const mockUsersService = {
      createUser: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      updateUser: jest.fn(),
    };

    const mockJwtService = {
      sign: jest.fn(),
      verifyAsync: jest.fn(),
      decode: jest.fn(),
    };

    const mockRedisService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      getDel: jest.fn(),
      scanKeys: jest.fn().mockResolvedValue([]),
    };

    const mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') return 'secret';
        if (key === 'JWT_REFRESH_SECRET') return 'refresh_secret';
        return null;
      }),
    };

    const mockEncryptionService = {
      encrypt: jest.fn((val) => `encrypted:${val}`),
      decrypt: jest.fn((val) => val.replace('encrypted:', '')),
    };

    const mockAuditLogRepository = {
      save: jest.fn(),
      create: jest.fn(),
    };
    auditLogRepo = mockAuditLogRepository;

    const mockEmailService = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    const mockContactsService = {
      claimContactsForUser: jest
        .fn()
        .mockResolvedValue({ linkedGroupIds: [], claimedContactIds: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: ContactsService, useValue: mockContactsService },
        {
          provide: getRepositoryToken(AuditLog),
          useValue: mockAuditLogRepository,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
    redisService = module.get(RedisService);
    encryptionService = module.get(EncryptionService);
    emailService = module.get(EmailService);
    contactsService = module.get(ContactsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('should register and return serialized user', async () => {
      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        displayName: 'Test User',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        passwordHash: 'hashed',
      } as any;

      usersService.createUser.mockResolvedValue(mockUser);

      const result = await service.register(
        'test@example.com',
        'password',
        'Test User',
      );

      expect(usersService.createUser).toHaveBeenCalledWith(
        'test@example.com',
        'password',
        'Test User',
      );
      expect(result).toEqual({
        id: 'user-id',
        email: 'test@example.com',
        displayName: 'Test User',
        status: 'active',
        createdAt: mockUser.createdAt,
        updatedAt: mockUser.updatedAt,
      });
    });

    it('sends a verification email but never blocks on it — registration succeeds even if sending fails', async () => {
      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
      usersService.createUser.mockResolvedValue(mockUser);
      emailService.sendVerificationEmail.mockRejectedValueOnce(
        new Error('provider down'),
      );

      await expect(
        service.register('test@example.com', 'password'),
      ).resolves.toBeDefined();
    });
  });

  describe('verifyEmail', () => {
    it('confirms the token, marks the user verified, and runs the Contact-claim fan-out', async () => {
      redisService.getDel.mockResolvedValueOnce('user-id');
      usersService.findById.mockResolvedValueOnce({
        id: 'user-id',
        email: 'rahul@gmail.com',
        emailVerified: false,
      } as any);
      contactsService.claimContactsForUser.mockResolvedValueOnce({
        linkedGroupIds: ['group-family', 'group-trip'],
        claimedContactIds: ['contact-1'],
      });

      const result = await service.verifyEmail('good-token');

      expect(redisService.getDel).toHaveBeenCalledWith(
        'email_verify:good-token',
      );
      expect(usersService.updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ emailVerified: true }),
      );
      expect(contactsService.claimContactsForUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-id' }),
      );
      expect(result).toEqual({
        linkedGroupIds: ['group-family', 'group-trip'],
        claimedContactIds: ['contact-1'],
      });
    });

    it('rejects an invalid or expired token without touching any Contact (never auto-claims on an unverified email)', async () => {
      redisService.getDel.mockResolvedValueOnce(null);

      await expect(service.verifyEmail('bad-token')).rejects.toThrow(
        BadRequestException,
      );
      expect(contactsService.claimContactsForUser).not.toHaveBeenCalled();
    });

    it('rejects a second concurrent use of the same token exactly like an expired one (GETDEL closes the race)', async () => {
      // The atomic GETDEL means a token can only ever be read successfully
      // once — a second caller racing the first sees the same null result
      // an already-expired token would produce, never a partial claim.
      redisService.getDel
        .mockResolvedValueOnce('user-id') // first caller: wins
        .mockResolvedValueOnce(null); // second, concurrent caller: loses
      usersService.findById.mockResolvedValueOnce({
        id: 'user-id',
        email: 'rahul@gmail.com',
        emailVerified: false,
      } as any);
      contactsService.claimContactsForUser.mockResolvedValueOnce({
        linkedGroupIds: [],
        claimedContactIds: [],
      });

      await expect(service.verifyEmail('shared-token')).resolves.toBeDefined();
      await expect(service.verifyEmail('shared-token')).rejects.toThrow(
        BadRequestException,
      );

      expect(contactsService.claimContactsForUser).toHaveBeenCalledTimes(1);
    });
  });

  describe('changePassword', () => {
    const baseUser = {
      id: 'user-id',
      email: 'test@example.com',
      passwordHash: 'old-hash',
    } as any;

    it('throws UnauthorizedException if user not found', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(
        service.changePassword('user-id', 'old', 'newpass12', 'wrapped'),
      ).rejects.toThrow('User not found');
    });

    it('throws UnauthorizedException if current password is wrong', async () => {
      usersService.findById.mockResolvedValue({ ...baseUser });
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('user-id', 'wrong', 'newpass12', 'wrapped'),
      ).rejects.toThrow('Current password is incorrect');
    });

    it('swaps password hash, stores re-wrapped key, and revokes all sessions', async () => {
      const user = { ...baseUser };
      usersService.findById.mockResolvedValue(user);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      (argon2.hash as jest.Mock).mockResolvedValue('new-hash');
      redisService.scanKeys.mockResolvedValue([
        'refresh_token:user-id:aaa',
        'refresh_token:user-id:bbb',
      ]);

      await service.changePassword(
        'user-id',
        'oldpass',
        'newpass12',
        'new-wrapped-key',
      );

      expect(user.passwordHash).toBe('new-hash');
      expect(user.encryptedPrivateWrappingKey).toBe('new-wrapped-key');
      expect(usersService.updateUser).toHaveBeenCalledWith(user);
      expect(redisService.scanKeys).toHaveBeenCalledWith(
        'refresh_token:user-id:*',
      );
      expect(redisService.del).toHaveBeenCalledTimes(2);
    });

    it('updates recovery blob when provided', async () => {
      const user = { ...baseUser };
      usersService.findById.mockResolvedValue(user);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      (argon2.hash as jest.Mock).mockResolvedValue('new-hash');

      await service.changePassword(
        'user-id',
        'oldpass',
        'newpass12',
        'new-wrapped-key',
        'new-recovery-blob',
      );

      expect(user.recoveryWrappedKey).toBe('new-recovery-blob');
      expect(user.recoveryKeyCreatedAt).toBeInstanceOf(Date);
    });
  });

  describe('requestPasswordReset', () => {
    it('issues a token and sends the reset email for an active user', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'user-id',
        email: 'test@example.com',
        status: 'active',
      } as any);

      await service.requestPasswordReset('test@example.com');

      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringMatching(/^pwd_reset:/),
        'user-id',
        60 * 60,
      );
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringContaining('/auth/reset-password?token='),
      );
    });

    it('is a silent no-op for an unknown email (no enumeration, no token, no email)', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.requestPasswordReset('nobody@example.com'),
      ).resolves.toBeUndefined();

      expect(redisService.set).not.toHaveBeenCalled();
      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('does not issue a token for a non-active account', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'user-id',
        email: 'test@example.com',
        status: 'disabled',
      } as any);

      await service.requestPasswordReset('test@example.com');

      expect(redisService.set).not.toHaveBeenCalled();
      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('getPasswordResetContext', () => {
    it('returns email + recovery blob for a valid token WITHOUT consuming it', async () => {
      redisService.get.mockResolvedValue('user-id');
      usersService.findById.mockResolvedValue({
        id: 'user-id',
        email: 'test@example.com',
        recoveryWrappedKey: 'recovery-blob',
      } as any);

      const result = await service.getPasswordResetContext('good-token');

      expect(redisService.get).toHaveBeenCalledWith('pwd_reset:good-token');
      expect(redisService.getDel).not.toHaveBeenCalled();
      expect(result).toEqual({
        email: 'test@example.com',
        hasRecoveryKey: true,
        recoveryWrappedKey: 'recovery-blob',
      });
    });

    it('reports hasRecoveryKey false when the user has no recovery blob', async () => {
      redisService.get.mockResolvedValue('user-id');
      usersService.findById.mockResolvedValue({
        id: 'user-id',
        email: 'test@example.com',
        recoveryWrappedKey: undefined,
      } as any);

      const result = await service.getPasswordResetContext('good-token');

      expect(result).toEqual({
        email: 'test@example.com',
        hasRecoveryKey: false,
        recoveryWrappedKey: null,
      });
    });

    it('throws for an invalid or expired token', async () => {
      redisService.get.mockResolvedValue(null);

      await expect(
        service.getPasswordResetContext('bad-token'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resetPassword', () => {
    it('swaps the hash, stores the re-wrapped key, and revokes all sessions', async () => {
      redisService.getDel.mockResolvedValue('user-id');
      const user = {
        id: 'user-id',
        email: 'test@example.com',
        passwordHash: 'old-hash',
      } as any;
      usersService.findById.mockResolvedValue(user);
      (argon2.hash as jest.Mock).mockResolvedValue('new-hash');
      redisService.scanKeys.mockResolvedValue([
        'refresh_token:user-id:aaa',
        'refresh_token:user-id:bbb',
      ]);

      await service.resetPassword('good-token', 'newpass12', 'new-wrapped-key');

      expect(redisService.getDel).toHaveBeenCalledWith('pwd_reset:good-token');
      expect(user.passwordHash).toBe('new-hash');
      expect(user.encryptedPrivateWrappingKey).toBe('new-wrapped-key');
      expect(usersService.updateUser).toHaveBeenCalledWith(user);
      expect(redisService.del).toHaveBeenCalledTimes(2);
    });

    it('rejects an invalid or expired token', async () => {
      redisService.getDel.mockResolvedValue(null);

      await expect(
        service.resetPassword('bad-token', 'newpass12', 'wrapped'),
      ).rejects.toThrow(BadRequestException);
      expect(usersService.updateUser).not.toHaveBeenCalled();
    });

    it('rejects a second concurrent use of the same token (GETDEL closes the race)', async () => {
      redisService.getDel
        .mockResolvedValueOnce('user-id')
        .mockResolvedValueOnce(null);
      usersService.findById.mockResolvedValue({
        id: 'user-id',
        email: 'test@example.com',
      } as any);
      (argon2.hash as jest.Mock).mockResolvedValue('new-hash');

      await expect(
        service.resetPassword('shared', 'newpass12', 'wrapped'),
      ).resolves.toBeUndefined();
      await expect(
        service.resetPassword('shared', 'newpass12', 'wrapped'),
      ).rejects.toThrow(BadRequestException);

      expect(usersService.updateUser).toHaveBeenCalledTimes(1);
    });
  });

  describe('revokeAllSessions', () => {
    it('deletes every matching refresh-token key', async () => {
      redisService.scanKeys.mockResolvedValue([
        'refresh_token:u1:a',
        'refresh_token:u1:b',
        'refresh_token:u1:c',
      ]);

      await service.revokeAllSessions('u1');

      expect(redisService.del).toHaveBeenCalledTimes(3);
    });

    it('is a no-op when there are no sessions', async () => {
      redisService.scanKeys.mockResolvedValue([]);

      await service.revokeAllSessions('u1');

      expect(redisService.del).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('should throw UnauthorizedException if user not found', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login('test@example.com', 'password'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password incorrect', async () => {
      const mockUser = {
        email: 'test@example.com',
        passwordHash: 'hashed',
        status: 'active',
      } as any;

      usersService.findByEmail.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login('test@example.com', 'password'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return token pair and user if credentials are valid and 2FA not enabled', async () => {
      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        displayName: 'Test User',
        status: 'active',
        passwordHash: 'hashed',
        isTwoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;

      usersService.findByEmail.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      jwtService.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');

      const result = await service.login('test@example.com', 'password');

      expect(redisService.set).toHaveBeenCalled();
      expect(usersService.updateUser).toHaveBeenCalled();
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 'user-id',
          email: 'test@example.com',
          displayName: 'Test User',
          status: 'active',
          createdAt: mockUser.createdAt,
          updatedAt: mockUser.updatedAt,
        },
      });
    });

    it('SEC-W7: writes the login audit event without the user email in metadataJson', async () => {
      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        displayName: 'Test User',
        status: 'active',
        passwordHash: 'hashed',
        isTwoFactorEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;

      usersService.findByEmail.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      jwtService.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');

      await service.login('test@example.com', 'password');

      const loginAudit = auditLogRepo.create.mock.calls
        .map((c) => c[0])
        .find((a) => a?.action === 'auth.login_success');
      expect(loginAudit).toBeDefined();
      const meta = loginAudit.metadataJson ?? {};
      expect(meta).not.toHaveProperty('email');
      // the raw email value must not appear anywhere in the persisted metadata
      expect(JSON.stringify(meta)).not.toContain('test@example.com');
    });

    it('should throw ForbiddenException if 2FA is enabled but code is missing', async () => {
      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        status: 'active',
        passwordHash: 'hashed',
        isTwoFactorEnabled: true,
        twoFactorSecret: 'KVKFKRCSN5RHK33O',
      } as any;

      usersService.findByEmail.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login('test@example.com', 'password'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if 2FA is enabled but code is invalid', async () => {
      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        status: 'active',
        passwordHash: 'hashed',
        isTwoFactorEnabled: true,
        twoFactorSecret: 'KVKFKRCSN5RHK33O',
      } as any;

      usersService.findByEmail.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login('test@example.com', 'password', '111111'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should log in successfully if 2FA is enabled and correct code is provided', async () => {
      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        displayName: 'Test User',
        status: 'active',
        passwordHash: 'hashed',
        isTwoFactorEnabled: true,
        twoFactorSecret: 'KVKFKRCSN5RHK33O',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;

      usersService.findByEmail.mockResolvedValue(mockUser);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      jwtService.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');

      const currentStep = Math.floor(Date.now() / 1000 / 30);
      const correctCode = generateTotp('KVKFKRCSN5RHK33O', currentStep);

      const result = await service.login(
        'test@example.com',
        'password',
        correctCode,
      );

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
    });
  });

  describe('2FA Management', () => {
    it('enable2Fa should generate secret and QR URL', async () => {
      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        isTwoFactorEnabled: false,
      } as any;

      const result = await service.enable2Fa(mockUser);

      expect(result.secret).toHaveLength(16);
      expect(result.qrCodeUrl).toContain(
        'otpauth://totp/FinMate:test@example.com',
      );
      expect(usersService.updateUser).toHaveBeenCalled();
    });

    it('verify2Fa should fail with invalid code', async () => {
      const mockUser = {
        id: 'user-id',
        twoFactorSecret: 'KVKFKRCSN5RHK33O',
        isTwoFactorEnabled: false,
      } as any;

      await expect(service.verify2Fa(mockUser, '000000')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('verify2Fa should succeed with valid code and enable 2FA', async () => {
      const mockUser = {
        id: 'user-id',
        twoFactorSecret: 'KVKFKRCSN5RHK33O',
        isTwoFactorEnabled: false,
      } as any;

      const currentStep = Math.floor(Date.now() / 1000 / 30);
      const correctCode = generateTotp('KVKFKRCSN5RHK33O', currentStep);

      const result = await service.verify2Fa(mockUser, correctCode);

      expect(result.success).toBe(true);
      expect(mockUser.isTwoFactorEnabled).toBe(true);
      expect(usersService.updateUser).toHaveBeenCalledWith(mockUser);
    });

    it('disable2Fa should fail with invalid code', async () => {
      const mockUser = {
        id: 'user-id',
        twoFactorSecret: 'KVKFKRCSN5RHK33O',
        isTwoFactorEnabled: true,
      } as any;

      await expect(service.disable2Fa(mockUser, '000000')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('disable2Fa should succeed with valid code and disable 2FA', async () => {
      const mockUser = {
        id: 'user-id',
        twoFactorSecret: 'KVKFKRCSN5RHK33O',
        isTwoFactorEnabled: true,
      } as any;

      const currentStep = Math.floor(Date.now() / 1000 / 30);
      const correctCode = generateTotp('KVKFKRCSN5RHK33O', currentStep);

      const result = await service.disable2Fa(mockUser, correctCode);

      expect(result.success).toBe(true);
      expect(mockUser.isTwoFactorEnabled).toBe(false);
      expect(mockUser.twoFactorSecret).toBeUndefined();
      expect(usersService.updateUser).toHaveBeenCalledWith(mockUser);
    });
  });

  describe('refresh', () => {
    it('should throw UnauthorizedException if refresh token is expired or invalid', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('verify error'));

      await expect(service.refresh('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if token not active in Redis', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        userId: 'user-id',
        refreshId: 'ref-id',
      });
      redisService.get.mockResolvedValue(null);

      await expect(service.refresh('some-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should rotate tokens and store new session in Redis if token is valid', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        userId: 'user-id',
        refreshId: 'ref-id',
      });
      redisService.get.mockResolvedValue('some-argon-hash');
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      (argon2.hash as jest.Mock).mockResolvedValue('new-argon-hash');

      const mockUser = {
        id: 'user-id',
        email: 'test@example.com',
        status: 'active',
      } as any;
      usersService.findById.mockResolvedValue(mockUser);

      jwtService.sign
        .mockReturnValueOnce('new-access-token')
        .mockReturnValueOnce('new-refresh-token');

      const result = await service.refresh('old-token');

      const expectedKey = `refresh_token:user-id:${createHash('sha256').update('ref-id').digest('hex')}`;
      expect(redisService.del).toHaveBeenCalledWith(expectedKey);
      expect(redisService.set).toHaveBeenCalled();
      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });
  });

  describe('logout', () => {
    it('should delete key in Redis', async () => {
      jwtService.decode.mockReturnValue({
        userId: 'user-id',
        refreshId: 'ref-id',
      });

      await service.logout('some-token', 'user-id');

      const expectedKey = `refresh_token:user-id:${createHash('sha256').update('ref-id').digest('hex')}`;
      expect(redisService.del).toHaveBeenCalledWith(expectedKey);
    });

    it('should throw ForbiddenException if user attempts to log out another user', async () => {
      jwtService.decode.mockReturnValue({
        userId: 'other-user-id',
        refreshId: 'ref-id',
      });

      await expect(service.logout('some-token', 'user-id')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
