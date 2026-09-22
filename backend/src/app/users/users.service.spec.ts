import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User, Profile } from '@finmate/data-models';
import { Repository, DataSource } from 'typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EncryptionService } from '../encryption/encryption.service';
import { RedisService } from '../redis/redis.service';
import * as argon2 from 'argon2';

jest.mock('argon2');

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: jest.Mocked<Repository<User>>;
  let profileRepository: jest.Mocked<Repository<Profile>>;
  let dataSource: jest.Mocked<DataSource>;
  let encryptionService: jest.Mocked<EncryptionService>;

  beforeEach(async () => {
    const mockUserRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (data) => data),
      create: jest.fn((entity, data) => data),
    };

    const mockProfileRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (data) => data),
      create: jest.fn((entity, data) => data),
    };

    const mockManager = {
      create: jest.fn((entity, data) => data),
      save: jest.fn(async (entity, data) => data),
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(null),
        save: jest.fn(async (data) => data),
      })),
    };

    const mockDataSource = {
      transaction: jest.fn((cb) => cb(mockManager)),
    };

    const mockEncryptionService = {
      encrypt: jest.fn((text) => `encrypted:${text}`),
      decrypt: jest.fn((cipher) => cipher.replace('encrypted:', '')),
    };

    const mockRedisService = {
      scanKeys: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
        {
          provide: getRepositoryToken(Profile),
          useValue: mockProfileRepository,
        },
        { provide: DataSource, useValue: mockDataSource },
        { provide: EncryptionService, useValue: mockEncryptionService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    userRepository = module.get(getRepositoryToken(User));
    profileRepository = module.get(getRepositoryToken(Profile));
    dataSource = module.get(DataSource);
    encryptionService = module.get(EncryptionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createUser', () => {
    it('should throw ConflictException if email already exists', async () => {
      userRepository.findOne.mockResolvedValue({ id: 'existing-id' } as any);

      await expect(
        service.createUser('test@example.com', 'password'),
      ).rejects.toThrow(ConflictException);
    });

    it('should hash password and save user and profile in transaction', async () => {
      userRepository.findOne.mockResolvedValue(null);
      (argon2.hash as jest.Mock).mockResolvedValue('hashed-password');

      const result = await service.createUser(
        'test@example.com',
        'password',
        'Test User',
      );

      expect(argon2.hash).toHaveBeenCalledWith('password');
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.email).toBe('test@example.com');
      expect(result.passwordHash).toBe('hashed-password');
      expect(result.displayName).toBe('Test User');
    });
  });

  describe('findProfileByUserId', () => {
    it('should return null if profile not found', async () => {
      profileRepository.findOne.mockResolvedValue(null);

      const result = await service.findProfileByUserId('user-id');
      expect(result).toBeNull();
    });

    it('should return profile and decrypt avatarUrl if set', async () => {
      const mockProfile = {
        id: 'profile-id',
        avatarUrl: 'encrypted:https://example.com/avatar.png',
      } as any;
      profileRepository.findOne.mockResolvedValue(mockProfile);

      const result = await service.findProfileByUserId('user-id');
      expect(result).toBeDefined();
      expect(result?.avatarUrl).toBe('https://example.com/avatar.png');
      expect(encryptionService.decrypt).toHaveBeenCalledWith(
        'encrypted:https://example.com/avatar.png',
      );
    });
  });

  describe('updateProfile', () => {
    it('should throw NotFoundException if user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.updateProfile('user-id', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if profile not found', async () => {
      userRepository.findOne.mockResolvedValue({ id: 'user-id' } as any);
      profileRepository.findOne.mockResolvedValue(null);

      await expect(service.updateProfile('user-id', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should update user and profile settings, encrypting avatarUrl', async () => {
      const mockUser = {
        id: 'user-id',
        displayName: 'Old Name',
      } as any;

      const mockProfile = {
        id: 'profile-id',
        locale: 'en-IN',
        defaultCurrency: 'INR',
        avatarUrl: undefined,
      } as any;

      userRepository.findOne.mockResolvedValue(mockUser);
      profileRepository.findOne.mockResolvedValue(mockProfile);
      userRepository.save.mockResolvedValue(mockUser);
      profileRepository.save.mockResolvedValue(mockProfile);

      const result = await service.updateProfile('user-id', {
        displayName: 'New Name',
        avatarUrl: 'https://example.com/new.png',
        locale: 'en-US',
        defaultCurrency: 'EUR',
      });

      expect(mockUser.displayName).toBe('New Name');
      expect(mockProfile.locale).toBe('en-US');
      expect(mockProfile.defaultCurrency).toBe('EUR');
      expect(encryptionService.encrypt).toHaveBeenCalledWith(
        'https://example.com/new.png',
      );
      expect(result.user.displayName).toBe('New Name');
      expect(result.profile.avatarUrl).toBe('https://example.com/new.png');
      expect(result.profile.defaultCurrency).toBe('EUR');
    });

    it('CLAIM-1 guard: ignores an injected `email`/`emailVerified` in the payload — email is immutable, so a verified account cannot be re-pointed to an unverified address (REPLACE with a reset-on-change test if an email-change feature is ever added)', async () => {
      const mockUser = {
        id: 'user-id',
        displayName: 'Old Name',
        email: 'original@example.com',
        emailVerified: true,
      } as any;
      const mockProfile = { id: 'profile-id' } as any;
      userRepository.findOne.mockResolvedValue(mockUser);
      profileRepository.findOne.mockResolvedValue(mockProfile);

      // Smuggle email/emailVerified past the type (the DTO has no such fields;
      // the global ValidationPipe whitelist would strip them at the edge).
      await service.updateProfile('user-id', {
        displayName: 'New Name',
        email: 'attacker@example.com',
        emailVerified: false,
      } as any);

      // updateProfile never reads/writes email or emailVerified.
      expect(mockUser.email).toBe('original@example.com');
      expect(mockUser.emailVerified).toBe(true);
      const savedUser = userRepository.save.mock.calls.at(-1)?.[0] as any;
      expect(savedUser.email).toBe('original@example.com');
      expect(savedUser.emailVerified).toBe(true);
    });

    it('should update displayName and aiOptIn on the user entity', async () => {
      const mockUser = {
        id: 'user-id',
        displayName: '',
        aiOptIn: false,
      } as any;
      const mockProfile = { id: 'profile-id' } as any;
      userRepository.findOne.mockResolvedValue(mockUser);
      profileRepository.findOne.mockResolvedValue(mockProfile);

      await service.updateProfile('user-id', {
        displayName: 'Alice',
        aiOptIn: true,
      });

      expect(mockUser.displayName).toBe('Alice');
      expect(mockUser.aiOptIn).toBe(true);
      expect(userRepository.save).toHaveBeenCalledWith(mockUser);
    });

    it('should update timezone and locale on the profile entity', async () => {
      const mockUser = { id: 'user-id' } as any;
      const mockProfile = {
        id: 'profile-id',
        timezone: 'Asia/Kolkata',
        locale: 'en-IN',
      } as any;
      userRepository.findOne.mockResolvedValue(mockUser);
      profileRepository.findOne.mockResolvedValue(mockProfile);

      await service.updateProfile('user-id', {
        timezone: 'America/New_York',
        locale: 'en-US',
      });

      expect(mockProfile.timezone).toBe('America/New_York');
      expect(mockProfile.locale).toBe('en-US');
      expect(profileRepository.save).toHaveBeenCalledWith(mockProfile);
    });

    it('should clear avatarUrl when empty string is passed', async () => {
      const mockUser = { id: 'user-id' } as any;
      const mockProfile = {
        id: 'profile-id',
        avatarUrl: 'encrypted:old-avatar',
      } as any;
      userRepository.findOne.mockResolvedValue(mockUser);
      profileRepository.findOne.mockResolvedValue(mockProfile);

      await service.updateProfile('user-id', { avatarUrl: '' });

      // Empty string → undefined (remove avatar)
      expect(mockProfile.avatarUrl).toBeUndefined();
      expect(encryptionService.encrypt).not.toHaveBeenCalled();
    });

    it('should not touch user entity when only profile fields are sent', async () => {
      const mockUser = { id: 'user-id', displayName: 'Unchanged' } as any;
      const mockProfile = { id: 'profile-id', timezone: 'UTC' } as any;
      userRepository.findOne.mockResolvedValue(mockUser);
      profileRepository.findOne.mockResolvedValue(mockProfile);

      await service.updateProfile('user-id', { timezone: 'Europe/London' });

      expect(userRepository.save).not.toHaveBeenCalled();
      expect(mockProfile.timezone).toBe('Europe/London');
    });

    it('should decrypt avatarUrl on the returned profile', async () => {
      const encryptedUrl = 'encrypted:data:image/png;base64,abc';
      const mockUser = { id: 'user-id' } as any;
      const mockProfile = { id: 'profile-id', avatarUrl: encryptedUrl } as any;
      userRepository.findOne.mockResolvedValue(mockUser);
      profileRepository.findOne.mockResolvedValue(mockProfile);
      profileRepository.save.mockResolvedValue(mockProfile);

      const result = await service.updateProfile('user-id', {});

      // decryptProfile mutates in-place; capture expected value from mock behaviour
      expect(encryptionService.decrypt).toHaveBeenCalledWith(encryptedUrl);
      expect(result.profile.avatarUrl).toBe('data:image/png;base64,abc');
    });
  });

  describe('setRecoveryKey', () => {
    it('throws NotFoundException if user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);
      await expect(service.setRecoveryKey('user-id', 'blob')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('stores the recovery blob and stamps createdAt', async () => {
      const user = { id: 'user-id' } as any;
      userRepository.findOne.mockResolvedValue(user);

      const result = await service.setRecoveryKey('user-id', 'wrapped-blob');

      expect(user.recoveryWrappedKey).toBe('wrapped-blob');
      expect(user.recoveryKeyCreatedAt).toBeInstanceOf(Date);
      expect(userRepository.save).toHaveBeenCalledWith(user);
      expect(result.recoveryKeyCreatedAt).toBeInstanceOf(Date);
    });
  });

  describe('getRecoveryKeyStatus', () => {
    it('reports hasRecoveryKey false when unset', async () => {
      userRepository.findOne.mockResolvedValue({ id: 'user-id' } as any);
      const result = await service.getRecoveryKeyStatus('user-id');
      expect(result.hasRecoveryKey).toBe(false);
      expect(result.recoveryKeyCreatedAt).toBeNull();
    });

    it('reports hasRecoveryKey true when set', async () => {
      const created = new Date();
      userRepository.findOne.mockResolvedValue({
        id: 'user-id',
        recoveryWrappedKey: 'blob',
        recoveryKeyCreatedAt: created,
      } as any);
      const result = await service.getRecoveryKeyStatus('user-id');
      expect(result.hasRecoveryKey).toBe(true);
      expect(result.recoveryKeyCreatedAt).toBe(created);
    });
  });

  describe('deleteAccount', () => {
    it('throws NotFoundException if user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);
      await expect(service.deleteAccount('user-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('anonymizes PII, revokes auth + keys, disables account', async () => {
      const user = {
        id: 'user-id',
        email: 'real@example.com',
        username: 'realuser',
        phoneNumber: '+123456789',
        displayName: 'Real Name',
        passwordHash: 'old-hash',
        twoFactorSecret: 'secret',
        isTwoFactorEnabled: true,
        publicWrappingKey: 'pub',
        encryptedPrivateWrappingKey: 'priv',
        recoveryWrappedKey: 'rec',
        aiOptIn: true,
        status: 'active',
      } as any;
      userRepository.findOne.mockResolvedValue(user);
      (argon2.hash as jest.Mock).mockResolvedValue('random-hash');

      await service.deleteAccount('user-id');

      expect(user.email).toMatch(/^deleted-.*@deleted\.finmate$/);
      expect(user.username).toBeUndefined();
      expect(user.phoneNumber).toBeUndefined();
      expect(user.displayName).toBeUndefined();
      expect(user.twoFactorSecret).toBeUndefined();
      expect(user.isTwoFactorEnabled).toBe(false);
      expect(user.publicWrappingKey).toBeUndefined();
      expect(user.encryptedPrivateWrappingKey).toBeUndefined();
      expect(user.recoveryWrappedKey).toBeUndefined();
      expect(user.aiOptIn).toBe(false);
      expect(user.status).toBe('disabled');
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('removes active sessions from Redis', async () => {
      const user = {
        id: 'user-id',
        email: 'real@example.com',
        status: 'active',
      } as any;
      userRepository.findOne.mockResolvedValue(user);
      (argon2.hash as jest.Mock).mockResolvedValue('random-hash');

      const redis = (service as any).redisService;
      redis.scanKeys.mockResolvedValue([
        'refresh_token:user-id:a',
        'refresh_token:user-id:b',
      ]);

      await service.deleteAccount('user-id');

      expect(redis.scanKeys).toHaveBeenCalledWith('refresh_token:user-id:*');
      expect(redis.del).toHaveBeenCalledTimes(2);
    });
  });
});
