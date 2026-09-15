import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GroupsService } from './groups.service';
import {
  Group,
  GroupKeyVersion,
  GroupMember,
  GroupMemberContribution,
  GroupInvite,
  MemberWrappedGroupKey,
  User,
  AuditLog,
} from '@finmate/data-models';
import { Repository, DataSource } from 'typeorm';
import {
  NotFoundException,
  ForbiddenException,
  PreconditionFailedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';
import { ContactsService } from '../contacts/contacts.service';

jest.mock('argon2');

describe('GroupsService', () => {
  let service: GroupsService;
  let groupRepository: jest.Mocked<Repository<Group>>;
  let groupMemberRepository: jest.Mocked<Repository<GroupMember>>;
  let groupInviteRepository: jest.Mocked<Repository<GroupInvite>>;
  let groupKeyVersionRepository: jest.Mocked<Repository<GroupKeyVersion>>;
  let memberWrappedGroupKeyRepository: jest.Mocked<
    Repository<MemberWrappedGroupKey>
  >;
  let userRepository: any;
  let dataSource: jest.Mocked<DataSource>;
  let contactsService: {
    resolveOrCreateIdentity: jest.Mock;
    claimContactsForUser: jest.Mock;
  };

  beforeEach(async () => {
    const mockGroupRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn((entity, data) => data),
      createQueryBuilder: jest.fn(() => ({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    const mockGroupMemberRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(async (data) => data),
      create: jest.fn((entity, data) => data),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        getOne: jest
          .fn()
          .mockImplementation(() => mockGroupMemberRepository.findOne()),
      })),
    };

    const mockAuditLogRepository = {
      save: jest.fn(),
      create: jest.fn((data) => data),
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      })),
    };

    const mockGroupInviteRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (data) => data),
      create: jest.fn((data) => data),
    };

    const mockGroupKeyVersionRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (data) => data),
      create: jest.fn((data) => data),
    };

    const mockMemberWrappedGroupKeyRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn(async (data) => data),
      create: jest.fn((data) => data),
    };

    const mockManager = {
      create: jest.fn((entity, data) => data),
      save: jest.fn(async (entity, data) => data),
      getRepository: jest.fn((entity) => {
        if (entity === GroupMember) return mockGroupMemberRepository;
        if (entity === GroupMemberContribution) {
          return {
            findOne: jest.fn(),
            create: jest.fn((data) => data),
          };
        }
        return mockUserRepository;
      }),
    };

    const mockUserRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (data) => data),
      create: jest.fn((data) => data),
    };
    userRepository = mockUserRepository;

    const mockDataSource = {
      transaction: jest.fn(async (cb) => cb(mockManager)),
      getRepository: jest.fn((entity) => {
        if (entity === User) return mockUserRepository;
        if (entity === Group) return mockGroupRepository;
        if (entity === GroupMember) return mockGroupMemberRepository;
        if (entity === AuditLog) return mockAuditLogRepository;
        if (entity === GroupKeyVersion) return mockGroupKeyVersionRepository;
        if (entity === MemberWrappedGroupKey)
          return mockMemberWrappedGroupKeyRepository;
        return null;
      }),
    };

    const mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'FRONTEND_URL') return 'http://localhost:4200';
        return null;
      }),
    };

    const mockEmailService = {
      sendInviteEmail: jest.fn().mockResolvedValue(undefined),
      logger: {
        error: jest.fn(),
      },
    };

    const mockContactsService = {
      resolveOrCreateIdentity: jest.fn(),
      // Default: no pending Contact matches this user — a safe no-op so
      // every existing test that reaches joinGroupByToken (which now calls
      // this only on the verified-email path) keeps working unchanged.
      claimContactsForUser: jest.fn().mockResolvedValue({
        linkedGroupIds: [],
        claimedContactIds: [],
        skippedContactIds: [],
      }),
      // Real normalizer behaviour (lowercase/trim) for the Option-C gate.
      normalizeEmail: jest.fn((email?: string | null) => {
        const t = email?.trim().toLowerCase();
        return t ? t : undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupsService,
        { provide: getRepositoryToken(Group), useValue: mockGroupRepository },
        {
          provide: getRepositoryToken(GroupMember),
          useValue: mockGroupMemberRepository,
        },
        {
          provide: getRepositoryToken(AuditLog),
          useValue: mockAuditLogRepository,
        },
        {
          provide: getRepositoryToken(GroupInvite),
          useValue: mockGroupInviteRepository,
        },
        {
          provide: getRepositoryToken(GroupKeyVersion),
          useValue: mockGroupKeyVersionRepository,
        },
        {
          provide: getRepositoryToken(MemberWrappedGroupKey),
          useValue: mockMemberWrappedGroupKeyRepository,
        },
        { provide: DataSource, useValue: mockDataSource },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: ContactsService, useValue: mockContactsService },
      ],
    }).compile();

    service = module.get<GroupsService>(GroupsService);
    groupRepository = module.get(getRepositoryToken(Group));
    groupMemberRepository = module.get(getRepositoryToken(GroupMember));
    groupInviteRepository = module.get(getRepositoryToken(GroupInvite));
    groupKeyVersionRepository = module.get(getRepositoryToken(GroupKeyVersion));
    memberWrappedGroupKeyRepository = module.get(
      getRepositoryToken(MemberWrappedGroupKey),
    );
    dataSource = module.get(DataSource);
    contactsService = module.get(ContactsService);

    groupKeyVersionRepository.findOne.mockResolvedValue({
      id: 'active-version-id',
      version: 1,
      status: 'ACTIVE',
      group: { id: 'group-id' },
    } as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createGroup', () => {
    it('should create group and owner member in transaction', async () => {
      const owner = { id: 'owner-id', email: 'owner@example.com' } as User;
      const dto = { name: 'Goa Trip', description: 'Fun trip' };

      const result = await service.createGroup(owner, dto);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.name).toBe('Goa Trip');
    });
  });

  describe('listGroups', () => {
    it('should query and return paginated list of groups', async () => {
      const result = await service.listGroups('user-id', 1, 20);

      expect(result).toBeDefined();
      expect(result.data).toEqual([]);
      expect(result.meta.currentPage).toBe(1);
    });
  });

  describe('findGroupById', () => {
    it('should throw ForbiddenException if user is not a member', async () => {
      groupMemberRepository.findOne.mockResolvedValue(null);
      groupRepository.findOne.mockResolvedValue({ id: 'group-id' } as any);

      await expect(
        service.findGroupById('user-id', 'group-id'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return group if user is an active member', async () => {
      groupMemberRepository.findOne.mockResolvedValue({
        id: 'member-id',
      } as any);
      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        name: 'Goa Trip',
      } as any);

      const result = await service.findGroupById('user-id', 'group-id');

      expect(result).toBeDefined();
      expect(result.name).toBe('Goa Trip');
    });
  });

  describe('updateGroup', () => {
    it('should throw ForbiddenException if user is not owner/admin', async () => {
      groupMemberRepository.findOne.mockResolvedValue({
        id: 'member-id',
        role: 'member',
      } as any);

      await expect(
        service.updateGroup('user-id', 'group-id', {
          version: 1,
          name: 'New Name',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw PreconditionFailedException on version conflict', async () => {
      groupMemberRepository.findOne.mockResolvedValue({
        id: 'member-id',
        role: 'owner',
      } as any);
      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        version: 2,
      } as any);

      await expect(
        service.updateGroup('user-id', 'group-id', {
          version: 1,
          name: 'New Name',
        }),
      ).rejects.toThrow(PreconditionFailedException);
    });

    it('should successfully update group if role is owner/admin and version matches', async () => {
      const mockGroup = { id: 'group-id', version: 1, name: 'Old Name' } as any;
      groupMemberRepository.findOne.mockResolvedValue({
        id: 'member-id',
        role: 'owner',
      } as any);
      groupRepository.findOne.mockResolvedValue(mockGroup);
      groupRepository.save.mockResolvedValue(mockGroup);

      const result = await service.updateGroup('user-id', 'group-id', {
        version: 1,
        name: 'New Name',
      });

      expect(mockGroup.name).toBe('New Name');
      expect(result).toBeDefined();
    });
  });

  describe('checkGroupWriteAccess', () => {
    it('should throw ForbiddenException if group is archived', async () => {
      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        isArchived: true,
      } as any);

      await expect(service.checkGroupWriteAccess('group-id')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should pass if group is not archived', async () => {
      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        isArchived: false,
      } as any);

      await expect(
        service.checkGroupWriteAccess('group-id'),
      ).resolves.not.toThrow();
    });
  });

  describe('archiveGroup', () => {
    const mockOwnerMembership = { id: 'member-id', role: 'owner' } as any;
    const mockAdminMembership = { id: 'member-id', role: 'admin' } as any;
    const mockEditorMembership = { id: 'member-id', role: 'member' } as any;
    const mockViewerMembership = { id: 'member-id', role: 'viewer' } as any;
    const mockGroup = {
      id: 'group-id',
      name: 'Goa Trip',
      isArchived: false,
      inviteToken: 'some-token',
    } as any;

    beforeEach(() => {
      // Default: transaction runs the callback immediately
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) => {
        const manager = {
          save: jest.fn(async (_entity: any, data: any) => data),
          getRepository: jest.fn(() => ({
            createQueryBuilder: jest.fn(() => ({
              update: jest.fn().mockReturnThis(),
              set: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              execute: jest.fn().mockResolvedValue(undefined),
            })),
          })),
        };
        return cb(manager);
      });
      (dataSource.getRepository as jest.Mock).mockReturnValue({
        findOne: jest.fn().mockResolvedValue({ id: 'user-id' } as any),
      });
    });

    it('should archive when caller is the owner', async () => {
      groupMemberRepository.findOne.mockResolvedValue(mockOwnerMembership);
      groupRepository.findOne.mockResolvedValue({ ...mockGroup });
      groupRepository.save.mockResolvedValue({
        ...mockGroup,
        isArchived: true,
      });

      const result = await service.archiveGroup('user-id', 'group-id');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.isArchived).toBe(true);
    });

    it('should throw ForbiddenException when caller is an admin', async () => {
      groupMemberRepository.findOne.mockResolvedValue(mockAdminMembership);

      await expect(service.archiveGroup('user-id', 'group-id')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when caller is a member/editor', async () => {
      groupMemberRepository.findOne.mockResolvedValue(mockEditorMembership);

      await expect(service.archiveGroup('user-id', 'group-id')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when caller is a viewer', async () => {
      groupMemberRepository.findOne.mockResolvedValue(mockViewerMembership);

      await expect(service.archiveGroup('user-id', 'group-id')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when caller has no membership', async () => {
      groupMemberRepository.findOne.mockResolvedValue(null);

      await expect(service.archiveGroup('user-id', 'group-id')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ConflictException if group is already archived', async () => {
      groupMemberRepository.findOne.mockResolvedValue(mockOwnerMembership);
      groupRepository.findOne.mockResolvedValue({
        ...mockGroup,
        isArchived: true,
      });

      await expect(service.archiveGroup('user-id', 'group-id')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw NotFoundException if group does not exist', async () => {
      groupMemberRepository.findOne.mockResolvedValue(mockOwnerMembership);
      groupRepository.findOne.mockResolvedValue(null);

      await expect(service.archiveGroup('user-id', 'group-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should include reason in archive metadata when provided', async () => {
      groupMemberRepository.findOne.mockResolvedValue(mockOwnerMembership);
      const savedGroup = { ...mockGroup, isArchived: true };
      groupRepository.findOne.mockResolvedValue({ ...mockGroup });
      groupRepository.save.mockResolvedValue(savedGroup);

      const result = await service.archiveGroup(
        'user-id',
        'group-id',
        'no longer needed',
      );

      expect(result.isArchived).toBe(true);
      // Verify the transaction ran (audit is fire-and-forget inside transaction callback)
      expect(dataSource.transaction).toHaveBeenCalled();
    });
  });

  describe('inviteMember', () => {
    it('should throw ForbiddenException if caller is not owner/admin', async () => {
      groupMemberRepository.findOne.mockResolvedValue({
        id: 'member-id',
        role: 'member',
      } as any);

      await expect(
        service.inviteMember('user-id', 'group-id', {
          email: 'test@example.com',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates a pending Contact-backed member if target email does not match a User', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-id',
        role: 'owner',
        user: {
          id: 'owner-id',
          email: 'owner@example.com',
          displayName: 'Owner',
        },
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({ id: 'group-id' } as any);
      userRepository.findOne.mockResolvedValueOnce(null);
      contactsService.resolveOrCreateIdentity.mockResolvedValueOnce({
        type: 'contact',
        contact: { id: 'new-contact-id', email: 'new@example.com' },
      });
      groupMemberRepository.findOne.mockResolvedValueOnce(null);
      groupMemberRepository.save.mockResolvedValueOnce({
        id: 'new-member-id',
      } as any);

      const result = await service.inviteMember('owner-id', 'group-id', {
        email: 'new@example.com',
        role: 'member',
      });

      expect(contactsService.resolveOrCreateIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@example.com' }),
      );
      expect(groupMemberRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contact: { id: 'new-contact-id', email: 'new@example.com' },
          user: undefined,
        }),
      );
      // No shadow User is ever created for a pending member.
      expect(userRepository.save).not.toHaveBeenCalled();
      expect(result).toBeDefined();
      expect((result as any).memberType).toBe('contact');
    });

    it('should throw ConflictException if user is already a member', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-id',
        role: 'owner',
        user: {
          id: 'owner-id',
          email: 'owner@example.com',
          displayName: 'Owner',
        },
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({ id: 'group-id' } as any);
      userRepository.findOne.mockResolvedValueOnce({
        id: 'target-user-id',
      } as any);
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'existing-member-id',
        joinStatus: 'active',
        user: { id: 'target-user-id' },
      } as any);

      await expect(
        service.inviteMember('owner-id', 'group-id', {
          email: 'target@example.com',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should re-invite user if they had left/been removed', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-id',
        role: 'owner',
        user: {
          id: 'owner-id',
          email: 'owner@example.com',
          displayName: 'Owner',
        },
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({ id: 'group-id' } as any);
      userRepository.findOne.mockResolvedValueOnce({
        id: 'target-user-id',
        email: 'target@example.com',
      } as any);

      const existingMember = {
        id: 'existing-member-id',
        joinStatus: 'left',
        user: { id: 'target-user-id', email: 'target@example.com' },
      } as any;
      groupMemberRepository.findOne.mockResolvedValueOnce(existingMember);
      groupMemberRepository.save.mockResolvedValueOnce(existingMember);

      const result = await service.inviteMember('owner-id', 'group-id', {
        email: 'target@example.com',
        role: 'viewer',
      });

      expect(existingMember.joinStatus).toBe('invited');
      expect(existingMember.role).toBe('viewer');
      expect(result).toBeDefined();
    });
  });

  describe('listMembers', () => {
    it('should throw ForbiddenException if caller is not in group', async () => {
      groupMemberRepository.findOne.mockResolvedValue(null);

      await expect(service.listMembers('user-id', 'group-id')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should list all members if caller is in group', async () => {
      groupMemberRepository.findOne.mockResolvedValue({
        id: 'caller-id',
      } as any);
      groupMemberRepository.find.mockResolvedValue([
        { id: 'member-1' },
        { id: 'member-2' },
      ] as any);

      const result = await service.listMembers('user-id', 'group-id');
      expect(result.length).toBe(2);
    });
  });

  describe('invite expiry handling', () => {
    it('should mark pending invite expired and reject invite details', async () => {
      const expiredInvite = {
        id: 'invite-id',
        inviteToken: 'invite-token',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
        group: {
          id: 'group-id',
          ownerUser: { email: 'owner@example.com' },
        },
      } as any;

      groupInviteRepository.findOne.mockResolvedValue(expiredInvite);

      await expect(service.getInviteDetails('invite-token')).rejects.toThrow(
        NotFoundException,
      );
      expect(groupInviteRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'expired' }),
      );
    });

    it('should mark pending invite expired and reject join by token', async () => {
      const expiredInvite = {
        id: 'invite-id',
        inviteToken: 'invite-token',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
        group: { id: 'group-id' },
      } as any;

      groupInviteRepository.findOne.mockResolvedValue(expiredInvite);

      await expect(
        service.joinGroupByToken('user-id', 'invite-token'),
      ).rejects.toThrow(NotFoundException);
      expect(groupInviteRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'expired' }),
      );
    });
  });

  describe('joinGroupByToken', () => {
    // All these tests use the group.inviteToken fallback path (no durable
    // GroupInvite row), which is the path GroupsService.inviteMember's
    // Contact-backed branch actually sends invitees down (see
    // docs/changes/invite-claim-fix.md) — this is where the duplicate-member
    // bug lived and where the fix (claiming pending Contacts before
    // resolving membership by user id) takes effect.
    const registeredUser = {
      id: 'joining-user-id',
      email: 'joiner@example.com',
      emailVerified: true,
    } as any;

    beforeEach(() => {
      // No durable GroupInvite — every test here falls back to group.inviteToken.
      groupInviteRepository.findOne.mockResolvedValue(null);
      groupRepository.findOne.mockResolvedValue({
        id: 'group-id',
        inviteToken: 'the-invite-token',
      } as any);
      userRepository.findOne.mockResolvedValue(registeredUser);
    });

    it('activates an already-active-track existing user membership in place — no duplicate, role preserved (regression: already-working path)', async () => {
      const existingUserBackedMember = {
        id: 'existing-member-id',
        joinStatus: 'invited',
        role: 'admin',
        user: { id: registeredUser.id },
      } as any;
      groupMemberRepository.findOne.mockResolvedValueOnce(
        existingUserBackedMember,
      );

      const result = await service.joinGroupByToken(
        registeredUser.id,
        'the-invite-token',
      );

      expect(contactsService.claimContactsForUser).toHaveBeenCalledWith(
        registeredUser,
      );
      expect(groupMemberRepository.create).not.toHaveBeenCalled();
      expect(existingUserBackedMember.joinStatus).toBe('active');
      expect(existingUserBackedMember.role).toBe('admin');
      expect((result as any).member.id).toBe('existing-member-id');
    });

    it('claims the existing Contact-backed membership instead of creating a duplicate, for an invitee who registered before accepting', async () => {
      // Simulates ContactsService.claimContactsForUser (tested independently
      // in contacts.service.spec.ts) having already linked the Contact-backed
      // row to this user and activated it, by the time GroupsService's own
      // existing-membership query runs.
      const claimedMember = {
        id: 'contact-backed-member-id',
        joinStatus: 'active',
        role: 'admin',
        user: { id: registeredUser.id },
        contact: { id: 'original-contact-id' },
      } as any;
      groupMemberRepository.findOne.mockResolvedValueOnce(claimedMember);

      const result = await service.joinGroupByToken(
        registeredUser.id,
        'the-invite-token',
      );

      expect(contactsService.claimContactsForUser).toHaveBeenCalledWith(
        registeredUser,
      );
      expect(groupMemberRepository.create).not.toHaveBeenCalled();
      expect((result as any).member.id).toBe('contact-backed-member-id');
      expect((result as any).member.role).toBe('admin');
    });

    it('calls claimContactsForUser before resolving existing membership, so a not-yet-linked Contact-backed row is claimed within the same join call (covers registering during acceptance)', async () => {
      const claimedMember = {
        id: 'contact-backed-member-id',
        joinStatus: 'active',
        role: 'member',
        user: { id: registeredUser.id },
      } as any;
      groupMemberRepository.findOne.mockResolvedValueOnce(claimedMember);

      await service.joinGroupByToken(registeredUser.id, 'the-invite-token');

      const claimCallOrder =
        contactsService.claimContactsForUser.mock.invocationCallOrder[0];
      const existingMemberQueryOrder = (
        groupMemberRepository.createQueryBuilder as jest.Mock
      ).mock.invocationCallOrder[0];
      expect(claimCallOrder).toBeLessThan(existingMemberQueryOrder);
    });

    it.each([
      ['admin', 'admin'],
      ['member', 'member'],
      ['spectator', 'spectator'],
    ])(
      'preserves the %s role granted at invite time when a Contact-backed invitee joins',
      async (invitedRole, expectedRole) => {
        const claimedMember = {
          id: 'contact-backed-member-id',
          joinStatus: 'active',
          role: invitedRole,
          user: { id: registeredUser.id },
        } as any;
        groupMemberRepository.findOne.mockResolvedValueOnce(claimedMember);

        const result = await service.joinGroupByToken(
          registeredUser.id,
          'the-invite-token',
        );

        expect(contactsService.claimContactsForUser).toHaveBeenCalledWith(
          registeredUser,
        );
        expect((result as any).member.role).toBe(expectedRole);
        expect(groupMemberRepository.create).not.toHaveBeenCalled();
      },
    );

    it('preserves the original GroupMember id when claiming a Contact-backed invitee, so history already attached to it (expenses, splits, settlements) stays correctly linked', async () => {
      const originalMemberId = 'member-id-with-expense-history';
      const claimedMember = {
        id: originalMemberId,
        joinStatus: 'active',
        role: 'member',
        user: { id: registeredUser.id },
      } as any;
      groupMemberRepository.findOne.mockResolvedValueOnce(claimedMember);

      const result = await service.joinGroupByToken(
        registeredUser.id,
        'the-invite-token',
      );

      // Same id as the pre-existing row — nothing was replaced, so any
      // Expense/ExpenseSplit/Settlement row referencing this GroupMember.id
      // still resolves to the same member, not an orphan.
      expect(contactsService.claimContactsForUser).toHaveBeenCalledWith(
        registeredUser,
      );
      expect((result as any).member.id).toBe(originalMemberId);
      expect(groupMemberRepository.create).not.toHaveBeenCalled();
    });

    it('creates a new active member only when no prior invite or contact claim resolves any membership for this group (regression: cold join via permanent link)', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce(null);
      groupMemberRepository.save.mockResolvedValueOnce({
        id: 'brand-new-member-id',
        role: 'member',
        joinStatus: 'active',
        user: registeredUser,
      } as any);

      const result = await service.joinGroupByToken(
        registeredUser.id,
        'the-invite-token',
      );

      expect(contactsService.claimContactsForUser).toHaveBeenCalledWith(
        registeredUser,
      );
      expect(groupMemberRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'member', joinStatus: 'active' }),
      );
      expect((result as any).member.id).toBe('brand-new-member-id');
    });

    // ── Fix C (Option C) — unverified joins ──────────────────────────────────
    it('rejects an UNVERIFIED user with 403 GROUP_JOIN_EMAIL_UNVERIFIED when a matching pending Contact-backed member exists in the group, creating no rows and never claiming', async () => {
      const unverifiedUser = {
        id: 'unverified-user-id',
        email: 'Joiner@Example.com',
        emailVerified: false,
      } as any;
      userRepository.findOne.mockResolvedValue(unverifiedUser);
      // Option-C gate query: a pending Contact-backed member matches this email.
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'pending-contact-member',
      } as any);

      const err = await service
        .joinGroupByToken(unverifiedUser.id, 'the-invite-token')
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({
        errorCode: 'GROUP_JOIN_EMAIL_UNVERIFIED',
      });

      expect(contactsService.claimContactsForUser).not.toHaveBeenCalled();
      expect(groupMemberRepository.create).not.toHaveBeenCalled();
      expect(groupMemberRepository.save).not.toHaveBeenCalled();
    });

    it('lets an UNVERIFIED user join normally (no claim) when NO matching pending Contact exists in the group', async () => {
      const unverifiedUser = {
        id: 'unverified-user-id',
        email: 'newcomer@example.com',
        emailVerified: false,
      } as any;
      userRepository.findOne.mockResolvedValue(unverifiedUser);
      // First getOne → Option-C gate: no pending match. Second getOne →
      // existing-membership lookup: none → create a fresh user-backed member.
      groupMemberRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      groupMemberRepository.save.mockResolvedValueOnce({
        id: 'fresh-member-id',
        role: 'member',
        joinStatus: 'active',
        user: unverifiedUser,
      } as any);

      const result = await service.joinGroupByToken(
        unverifiedUser.id,
        'the-invite-token',
      );

      expect(contactsService.claimContactsForUser).not.toHaveBeenCalled();
      expect(groupMemberRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'member', joinStatus: 'active' }),
      );
      expect((result as any).member.id).toBe('fresh-member-id');
    });
  });

  describe('updateMember', () => {
    it('should throw ForbiddenException if caller does not have access', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.updateMember('user-id', 'group-id', 'member-id', {
          joinStatus: 'active',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject a member changing their own role', async () => {
      const selfMember = {
        id: 'caller-id',
        joinStatus: 'active',
        role: 'member',
        user: { id: 'user-id' },
      } as any;
      groupMemberRepository.findOne.mockResolvedValueOnce(selfMember);
      groupMemberRepository.findOne.mockResolvedValueOnce(selfMember);

      await expect(
        service.updateMember('user-id', 'group-id', 'caller-id', {
          role: 'admin',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(selfMember.role).toBe('member');
    });

    it('should allow self-update to accept invitation', async () => {
      const selfMember = {
        id: 'caller-id',
        joinStatus: 'invited',
        role: 'member',
        user: { id: 'user-id' },
      } as any;
      groupMemberRepository.findOne.mockResolvedValueOnce(selfMember);
      groupMemberRepository.findOne.mockResolvedValueOnce(selfMember);
      groupMemberRepository.save.mockResolvedValueOnce(selfMember);

      const result = await service.updateMember(
        'user-id',
        'group-id',
        'caller-id',
        { joinStatus: 'active' },
      );

      expect(selfMember.joinStatus).toBe('active');
      expect(selfMember.joinedAt).toBeDefined();
      expect(result).toBeDefined();
    });

    it('should throw BadRequestException if owner tries to leave without transferring ownership', async () => {
      const selfMember = {
        id: 'caller-id',
        joinStatus: 'active',
        role: 'owner',
        user: { id: 'user-id' },
      } as any;
      groupMemberRepository.findOne.mockResolvedValueOnce(selfMember);
      groupMemberRepository.findOne.mockResolvedValueOnce(selfMember);

      await expect(
        service.updateMember('user-id', 'group-id', 'caller-id', {
          joinStatus: 'left',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow self-update to leave group', async () => {
      const selfMember = {
        id: 'caller-id',
        joinStatus: 'active',
        role: 'member',
        user: { id: 'user-id' },
      } as any;
      groupMemberRepository.findOne.mockResolvedValueOnce(selfMember);
      groupMemberRepository.findOne.mockResolvedValueOnce(selfMember);
      groupMemberRepository.save.mockResolvedValueOnce(selfMember);

      const result = await service.updateMember(
        'user-id',
        'group-id',
        'caller-id',
        { joinStatus: 'left' },
      );

      expect(selfMember.joinStatus).toBe('left');
      expect(selfMember.leftAt).toBeDefined();
      expect(result).toBeDefined();
    });

    it('should reject role changes from callers who are not owner or admin (GRP-001)', async () => {
      const caller = {
        id: 'caller-id',
        joinStatus: 'active',
        role: 'member',
        user: { id: 'caller-user-id' },
      } as any;
      const target = {
        id: 'target-id',
        joinStatus: 'active',
        role: 'member',
        user: { id: 'target-user-id' },
      } as any;

      groupMemberRepository.findOne.mockResolvedValueOnce(caller);
      groupMemberRepository.findOne.mockResolvedValueOnce(target);

      await expect(
        service.updateMember('caller-user-id', 'group-id', 'target-id', {
          role: 'owner',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(target.role).toBe('member');
    });

    it('should reject an admin changing the role of the owner or another admin', async () => {
      const caller = {
        id: 'caller-id',
        joinStatus: 'active',
        role: 'admin',
        user: { id: 'caller-user-id' },
      } as any;
      const target = {
        id: 'target-id',
        joinStatus: 'active',
        role: 'owner',
        user: { id: 'target-user-id' },
      } as any;

      groupMemberRepository.findOne.mockResolvedValueOnce(caller);
      groupMemberRepository.findOne.mockResolvedValueOnce(target);

      await expect(
        service.updateMember('caller-user-id', 'group-id', 'target-id', {
          role: 'admin',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(target.role).toBe('owner');
    });

    it('should reject an admin promoting anyone to owner', async () => {
      const caller = {
        id: 'caller-id',
        joinStatus: 'active',
        role: 'admin',
        user: { id: 'caller-user-id' },
      } as any;
      const target = {
        id: 'target-id',
        joinStatus: 'active',
        role: 'member',
        user: { id: 'target-user-id' },
      } as any;

      groupMemberRepository.findOne.mockResolvedValueOnce(caller);
      groupMemberRepository.findOne.mockResolvedValueOnce(target);

      await expect(
        service.updateMember('caller-user-id', 'group-id', 'target-id', {
          role: 'owner',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(target.role).toBe('member');
    });

    it('should allow an admin to change a regular member role', async () => {
      const caller = {
        id: 'caller-id',
        joinStatus: 'active',
        role: 'admin',
        user: { id: 'caller-user-id' },
      } as any;
      const target = {
        id: 'target-id',
        joinStatus: 'active',
        role: 'member',
        user: { id: 'target-user-id' },
      } as any;

      groupMemberRepository.findOne.mockResolvedValueOnce(caller);
      groupMemberRepository.findOne.mockResolvedValueOnce(target);
      groupMemberRepository.save.mockResolvedValueOnce(target);

      const result = await service.updateMember(
        'caller-user-id',
        'group-id',
        'target-id',
        { role: 'viewer' },
      );

      expect(target.role).toBe('viewer');
      expect(result).toBeDefined();
    });

    it('should allow owner to transfer ownership in transaction', async () => {
      const caller = {
        id: 'caller-id',
        joinStatus: 'active',
        role: 'owner',
        user: { id: 'caller-user-id' },
      } as any;
      const target = {
        id: 'target-id',
        joinStatus: 'active',
        role: 'admin',
        user: { id: 'target-user-id' },
      } as any;

      groupMemberRepository.findOne.mockResolvedValueOnce(caller);
      groupMemberRepository.findOne.mockResolvedValueOnce(target);

      const result = await service.updateMember(
        'caller-user-id',
        'group-id',
        'target-id',
        { role: 'owner' },
      );

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('removeMember', () => {
    it('should allow self-remove (leaving) if not owner', async () => {
      const selfMember = {
        id: 'caller-id',
        joinStatus: 'active',
        role: 'member',
        user: { id: 'user-id' },
      } as any;
      groupMemberRepository.findOne.mockResolvedValueOnce(selfMember);
      groupMemberRepository.findOne.mockResolvedValueOnce(selfMember);

      await service.removeMember('user-id', 'group-id', 'caller-id');

      expect(selfMember.joinStatus).toBe('left');
      expect(selfMember.leftAt).toBeDefined();
    });

    it('should allow admin caller to remove member target', async () => {
      const caller = {
        id: 'caller-id',
        joinStatus: 'active',
        role: 'admin',
        user: { id: 'caller-user-id' },
      } as any;
      const target = {
        id: 'target-id',
        joinStatus: 'active',
        role: 'member',
        user: { id: 'target-user-id' },
      } as any;

      groupMemberRepository.findOne.mockResolvedValueOnce(caller);
      groupMemberRepository.findOne.mockResolvedValueOnce(target);

      await service.removeMember('caller-user-id', 'group-id', 'target-id');

      expect(target.joinStatus).toBe('removed');
      expect(target.leftAt).toBeDefined();
    });
  });

  describe('group key versioning', () => {
    it('should not overwrite existing wrapped key for active version during provisioning', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member-id',
        role: 'owner',
        joinStatus: 'active',
        user: { id: 'owner-id' },
        group: { id: 'group-id' },
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({ id: 'group-id' } as any);

      const existingWrappedKey = {
        id: 'wrapped-key-id',
        wrappedGroupKey: 'existing-ciphertext',
      };

      const managerGroupKeyVersionRepo = {
        findOne: jest.fn().mockResolvedValue({
          id: 'active-version-id',
          version: 1,
          status: 'ACTIVE',
          group: { id: 'group-id' },
        }),
        save: jest.fn(),
        create: jest.fn((data) => data),
      };

      const managerMemberWrappedRepo = {
        findOne: jest.fn().mockResolvedValue(existingWrappedKey),
        save: jest.fn(),
        create: jest.fn((data) => data),
      };

      const managerGroupMemberRepo = {
        findOne: jest.fn().mockResolvedValue({
          id: 'target-member-id',
          user: { id: 'target-user-id' },
          group: { id: 'group-id' },
          joinStatus: 'active',
        }),
      };

      dataSource.transaction.mockImplementationOnce(async (cb: any) =>
        cb({
          getRepository: (entity: unknown) => {
            if (entity === GroupKeyVersion) return managerGroupKeyVersionRepo;
            if (entity === MemberWrappedGroupKey)
              return managerMemberWrappedRepo;
            if (entity === GroupMember) return managerGroupMemberRepo;
            return null;
          },
        }),
      );

      await service.provisionGroupKeys('owner-id', 'group-id', [
        { userId: 'target-user-id', wrappedKey: 'new-ciphertext' },
      ]);

      expect(managerMemberWrappedRepo.findOne).toHaveBeenCalled();
      expect(managerMemberWrappedRepo.save).not.toHaveBeenCalled();
    });

    it('lets a member replace their OWN wrapped key (legacy master-key -> RSA migration)', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member-id',
        role: 'member',
        joinStatus: 'active',
        user: { id: 'owner-id' },
        group: { id: 'group-id' },
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({ id: 'group-id' } as any);

      const existingWrappedKey = {
        id: 'wrapped-key-id',
        wrappedGroupKey: 'legacy:master-wrapped',
      };

      const managerGroupKeyVersionRepo = {
        findOne: jest.fn().mockResolvedValue({
          id: 'active-version-id',
          version: 1,
          status: 'ACTIVE',
          group: { id: 'group-id' },
        }),
        save: jest.fn(),
        create: jest.fn((data) => data),
      };

      const managerMemberWrappedRepo = {
        findOne: jest.fn().mockResolvedValue(existingWrappedKey),
        save: jest.fn(async (data) => data),
        create: jest.fn((data) => data),
      };

      const managerGroupMemberRepo = {
        findOne: jest.fn().mockResolvedValue({
          id: 'self-member-id',
          user: { id: 'owner-id' },
          group: { id: 'group-id' },
          joinStatus: 'active',
        }),
      };

      dataSource.transaction.mockImplementationOnce(async (cb: any) =>
        cb({
          getRepository: (entity: unknown) => {
            if (entity === GroupKeyVersion) return managerGroupKeyVersionRepo;
            if (entity === MemberWrappedGroupKey)
              return managerMemberWrappedRepo;
            if (entity === GroupMember) return managerGroupMemberRepo;
            return null;
          },
        }),
      );

      // Caller re-provisions for THEMSELVES (owner-id === owner-id).
      await service.provisionGroupKeys('owner-id', 'group-id', [
        { userId: 'owner-id', wrappedKey: 'rsa-wrapped' },
      ]);

      expect(managerMemberWrappedRepo.save).toHaveBeenCalledTimes(1);
      expect(existingWrappedKey.wrappedGroupKey).toBe('rsa-wrapped');
    });

    it('should rotate group key by superseding current active and creating next active version', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member-id',
        role: 'owner',
        joinStatus: 'active',
        user: { id: 'owner-id' },
        group: { id: 'group-id' },
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({ id: 'group-id' } as any);

      const activeVersion = {
        id: 'version-1-id',
        version: 1,
        status: 'ACTIVE',
      } as any;
      const createdVersion = {
        id: 'version-2-id',
        version: 2,
        status: 'ACTIVE',
      } as any;

      const managerGroupKeyVersionRepo = {
        findOne: jest
          .fn()
          .mockResolvedValueOnce(activeVersion)
          .mockResolvedValueOnce({ id: 'version-1-id', version: 1 }),
        save: jest
          .fn()
          .mockResolvedValueOnce({ ...activeVersion, status: 'SUPERSEDED' })
          .mockResolvedValueOnce(createdVersion),
        create: jest.fn((data) => data),
      };

      const managerGroupMemberRepo = {
        findOne: jest.fn().mockResolvedValue({
          id: 'target-member-id',
          user: { id: 'target-user-id' },
          group: { id: 'group-id' },
          joinStatus: 'active',
        }),
      };

      const managerMemberWrappedRepo = {
        save: jest.fn(async (data) => data),
        create: jest.fn((data) => data),
      };

      dataSource.transaction.mockImplementationOnce(async (cb: any) =>
        cb({
          getRepository: (entity: unknown) => {
            if (entity === GroupKeyVersion) return managerGroupKeyVersionRepo;
            if (entity === GroupMember) return managerGroupMemberRepo;
            if (entity === MemberWrappedGroupKey)
              return managerMemberWrappedRepo;
            return null;
          },
        }),
      );

      const result = await service.rotateGroupKey('owner-id', 'group-id', {
        reason: 'scheduled-rotation',
        keys: [{ userId: 'target-user-id', wrappedKey: 'ciphertext-v2' }],
      });

      expect(result.groupKeyVersion).toBe(2);
      expect(result.status).toBe('ACTIVE');
      expect(managerGroupKeyVersionRepo.save).toHaveBeenCalledTimes(2);
      expect(managerMemberWrappedRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('getMyGroupKey', () => {
    const activeMember = {
      id: 'member-id',
      joinStatus: 'active',
      user: { id: 'user-id' },
      group: { id: 'group-id' },
    } as any;

    it('should serve the requested key version when versionId is provided', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce(activeMember);
      groupKeyVersionRepository.findOne.mockResolvedValueOnce({
        id: 'version-1-id',
        version: 1,
        status: 'SUPERSEDED',
        group: { id: 'group-id' },
      } as any);
      memberWrappedGroupKeyRepository.findOne.mockResolvedValueOnce({
        wrappedGroupKey: 'ciphertext-v1',
      } as any);
      memberWrappedGroupKeyRepository.count.mockResolvedValueOnce(2);

      const result = await service.getMyGroupKey(
        'user-id',
        'group-id',
        'version-1-id',
      );

      expect(groupKeyVersionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'version-1-id', group: { id: 'group-id' } },
      });
      expect(result.groupKeyVersionId).toBe('version-1-id');
      expect(result.groupKeyVersion).toBe(1);
      expect(result.wrappedKey).toBe('ciphertext-v1');
      expect(result.hasActiveKeys).toBe(true);
    });

    it('should serve the active version when no versionId is provided', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce(activeMember);
      memberWrappedGroupKeyRepository.findOne.mockResolvedValueOnce({
        wrappedGroupKey: 'ciphertext-active',
      } as any);
      memberWrappedGroupKeyRepository.count.mockResolvedValueOnce(1);

      const result = await service.getMyGroupKey('user-id', 'group-id');

      expect(groupKeyVersionRepository.findOne).toHaveBeenCalledWith({
        where: { group: { id: 'group-id' }, status: 'ACTIVE' },
        relations: ['group'],
        order: { version: 'DESC' },
      });
      expect(result.groupKeyVersionId).toBe('active-version-id');
      expect(result.wrappedKey).toBe('ciphertext-active');
    });

    it('should reject a versionId that does not belong to the group', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce(activeMember);
      groupKeyVersionRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.getMyGroupKey('user-id', 'group-id', 'other-group-version-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject a revoked key version', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce(activeMember);
      groupKeyVersionRepository.findOne.mockResolvedValueOnce({
        id: 'revoked-version-id',
        version: 1,
        status: 'REVOKED',
        group: { id: 'group-id' },
      } as any);

      await expect(
        service.getMyGroupKey('user-id', 'group-id', 'revoked-version-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listGroupKeyVersions', () => {
    it('should list all versions (metadata only) for an active member', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'member-id',
        joinStatus: 'active',
        user: { id: 'user-id' },
        group: { id: 'group-id' },
      } as any);
      (groupKeyVersionRepository as any).find = jest.fn().mockResolvedValue([
        {
          id: 'v2-id',
          version: 2,
          status: 'ACTIVE',
          algorithm: 'AES-256-GCM',
          createdAt: new Date('2026-07-01'),
          rotatedAt: null,
        },
        {
          id: 'v1-id',
          version: 1,
          status: 'SUPERSEDED',
          algorithm: 'AES-256-GCM',
          createdAt: new Date('2026-06-01'),
          rotatedAt: new Date('2026-07-01'),
          rotationReason: 'scheduled',
        },
      ]);

      const result = await service.listGroupKeyVersions('user-id', 'group-id');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          groupKeyVersionId: 'v2-id',
          groupKeyVersion: 2,
          status: 'ACTIVE',
        }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({
          groupKeyVersionId: 'v1-id',
          status: 'SUPERSEDED',
          rotationReason: 'scheduled',
        }),
      );
      expect(result[0]).not.toHaveProperty('wrappedKey');
    });
  });
});
