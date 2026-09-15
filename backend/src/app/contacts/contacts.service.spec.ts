import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditLog,
  Contact,
  GroupMember,
  GroupInvite,
  User,
} from '@finmate/data-models';
import { ContactsService } from './contacts.service';

describe('ContactsService', () => {
  let service: ContactsService;
  let contactRepository: Record<string, jest.Mock>;
  let userRepository: Record<string, jest.Mock>;
  let groupMemberRepository: Record<string, jest.Mock>;
  let groupInviteRepository: Record<string, jest.Mock>;
  let auditLogRepository: Record<string, jest.Mock>;
  let auditLogQueryBuilder: Record<string, jest.Mock>;
  let mockManager: {
    query: jest.Mock;
    getRepository: jest.Mock;
  };

  beforeEach(async () => {
    contactRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (data) => ({
        id: data.id ?? 'new-contact-id',
        ...data,
      })),
      create: jest.fn((data) => data),
      update: jest.fn(),
    };
    userRepository = {
      findOne: jest.fn(),
    };
    groupMemberRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      update: jest.fn(),
      save: jest.fn(async (data) => data),
    };
    groupInviteRepository = {
      update: jest.fn(),
    };
    auditLogQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    auditLogRepository = {
      save: jest.fn(async (data) => data),
      create: jest.fn((data) => data),
      // Always returns the SAME query-builder instance so tests can
      // configure/assert on it before the service ever calls it.
      createQueryBuilder: jest.fn(() => auditLogQueryBuilder),
    };

    mockManager = {
      query: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn((entity) => {
        if (entity === Contact) return contactRepository;
        if (entity === User) return userRepository;
        if (entity === GroupMember) return groupMemberRepository;
        if (entity === GroupInvite) return groupInviteRepository;
        if (entity === AuditLog) return auditLogRepository;
        throw new Error(`Unexpected repository requested: ${entity}`);
      }),
    };

    const mockDataSource = {
      transaction: jest.fn(async (cb: any) => cb(mockManager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: getRepositoryToken(Contact), useValue: contactRepository },
        { provide: getRepositoryToken(User), useValue: userRepository },
        {
          provide: getRepositoryToken(GroupMember),
          useValue: groupMemberRepository,
        },
        {
          provide: getRepositoryToken(GroupInvite),
          useValue: groupInviteRepository,
        },
        {
          provide: getRepositoryToken(AuditLog),
          useValue: auditLogRepository,
        },
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get(ContactsService);
  });

  describe('normalization', () => {
    it('lowercases and trims email', () => {
      expect(service.normalizeEmail('  Rahul@Example.com ')).toBe(
        'rahul@example.com',
      );
    });

    it('strips whitespace/dashes from phone', () => {
      expect(service.normalizePhone('+91 98765-43210')).toBe('+919876543210');
    });

    it('returns undefined for empty/absent values', () => {
      expect(service.normalizeEmail(undefined)).toBeUndefined();
      expect(service.normalizePhone('')).toBeUndefined();
    });
  });

  describe('resolveOrCreateIdentity', () => {
    const owner = { id: 'alice-id' } as User;

    it('throws when neither email nor phone is provided', async () => {
      await expect(
        service.resolveOrCreateIdentity({ createdByUser: owner }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns the existing User as the permanent backstop, never creating a Contact', async () => {
      userRepository.findOne.mockResolvedValueOnce({
        id: 'existing-user-id',
        email: 'rahul@gmail.com',
      });

      const result = await service.resolveOrCreateIdentity({
        email: 'rahul@gmail.com',
        createdByUser: owner,
      });

      expect(result).toEqual({
        type: 'user',
        user: { id: 'existing-user-id', email: 'rahul@gmail.com' },
      });
      expect(contactRepository.save).not.toHaveBeenCalled();
    });

    it('reuses an existing pending Contact for the same normalized email instead of creating a duplicate', async () => {
      userRepository.findOne.mockResolvedValueOnce(null);
      contactRepository.findOne.mockResolvedValueOnce({
        id: 'existing-contact-id',
        email: 'rahul@gmail.com',
        status: 'pending',
      });

      const result = await service.resolveOrCreateIdentity({
        email: 'Rahul@Gmail.com', // different casing — must still match
        createdByUser: owner,
      });

      expect(result).toEqual({
        type: 'contact',
        contact: {
          id: 'existing-contact-id',
          email: 'rahul@gmail.com',
          status: 'pending',
        },
      });
      expect(contactRepository.save).not.toHaveBeenCalled();
    });

    it('creates a new pending Contact only when no User or Contact matches', async () => {
      userRepository.findOne.mockResolvedValueOnce(null);
      contactRepository.findOne.mockResolvedValueOnce(null);

      const result = await service.resolveOrCreateIdentity({
        email: 'newperson@example.com',
        displayName: 'Rahul',
        createdByUser: owner,
      });

      expect(contactRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'newperson@example.com',
          displayName: 'Rahul',
          status: 'pending',
          createdByUser: owner,
        }),
      );
      expect(result.type).toBe('contact');
    });

    it('writes a contact.created audit event when a new Contact is created', async () => {
      userRepository.findOne.mockResolvedValueOnce(null);
      contactRepository.findOne.mockResolvedValueOnce(null);
      contactRepository.save.mockResolvedValueOnce({
        id: 'new-contact-id',
        email: 'newperson@example.com',
      });

      await service.resolveOrCreateIdentity({
        email: 'newperson@example.com',
        createdByUser: owner,
      });

      expect(auditLogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'contact.created',
          entityType: 'contact',
          entityId: 'new-contact-id',
          actorUser: owner,
        }),
      );
    });

    it('writes a contact.linked audit event when an existing pending Contact is reused', async () => {
      userRepository.findOne.mockResolvedValueOnce(null);
      contactRepository.findOne.mockResolvedValueOnce({
        id: 'existing-contact-id',
        email: 'rahul@gmail.com',
        status: 'pending',
      });

      await service.resolveOrCreateIdentity({
        email: 'rahul@gmail.com',
        createdByUser: owner,
      });

      expect(auditLogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'contact.linked',
          entityType: 'contact',
          entityId: 'existing-contact-id',
        }),
      );
    });

    it('acquires the Postgres identity lock before checking for an existing pending Contact (hardening A)', async () => {
      userRepository.findOne.mockResolvedValueOnce(null);
      const callOrder: string[] = [];
      mockManager.query.mockImplementation(async () => {
        callOrder.push('lock');
      });
      contactRepository.findOne.mockImplementation(async () => {
        callOrder.push('find');
        return null;
      });
      contactRepository.save.mockImplementation(async (data: any) => {
        callOrder.push('save');
        return { id: 'created-id', ...data };
      });

      await service.resolveOrCreateIdentity({
        email: 'race@example.com',
        createdByUser: owner,
      });

      expect(callOrder).toEqual(['lock', 'find', 'save']);
      expect(mockManager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock($1)',
        [expect.any(String)],
      );
    });

    it('on a unique-constraint race, re-fetches and returns the winning row instead of throwing (defense-in-depth backstop)', async () => {
      userRepository.findOne.mockResolvedValueOnce(null);
      contactRepository.findOne
        .mockResolvedValueOnce(null) // first check inside the lock: nothing yet
        .mockResolvedValueOnce({ id: 'winner-id', email: 'race@example.com' }); // re-fetch after conflict
      contactRepository.save.mockRejectedValueOnce({ code: '23505' });

      const result = await service.resolveOrCreateIdentity({
        email: 'race@example.com',
        createdByUser: owner,
      });

      expect(result).toEqual({
        type: 'contact',
        contact: { id: 'winner-id', email: 'race@example.com' },
      });
    });

    // ── Fix B — resolve a previously-known person (claimed / merged) before
    // creating a fresh pending Contact, so re-adding the same email/phone never
    // duplicates them. Order: User → claimed Contact → merged Contact → pending.
    describe('claimed / merged resolution (Fix B)', () => {
      const owner = { id: 'alice-id' } as User;
      /** In-memory contact store the mocked repo walks for merge chains. */
      let store: Record<string, any>;

      beforeEach(() => {
        userRepository.findOne.mockResolvedValue(null); // no User backstop
        store = {};
        contactRepository.findOne.mockImplementation(
          async ({ where }: any) => (where.id ? (store[where.id] ?? null) : null),
        );
      });

      it('folds a CLAIMED Contact matching the identifier to its claimedByUser (no duplicate)', async () => {
        contactRepository.find.mockResolvedValueOnce([
          {
            id: 'C1',
            status: 'claimed',
            email: 'rahul@gmail.com',
            claimedByUser: { id: 'U9', email: 'rahul@gmail.com' },
            mergedIntoContact: null,
          },
        ]);

        const result = await service.resolveOrCreateIdentity({
          email: 'Rahul@Gmail.com',
          createdByUser: owner,
        });

        expect(result).toEqual({
          type: 'user',
          user: { id: 'U9', email: 'rahul@gmail.com' },
        });
        expect(contactRepository.save).not.toHaveBeenCalled();
      });

      it('follows a MERGED (archived) Contact to its surviving pending Contact', async () => {
        store['B'] = { id: 'B', status: 'pending', mergedIntoContact: null };
        contactRepository.find.mockResolvedValueOnce([
          {
            id: 'A',
            status: 'archived',
            phoneNumber: '+919876543210',
            mergedIntoContact: { id: 'B' },
            claimedByUser: null,
          },
        ]);

        const result = await service.resolveOrCreateIdentity({
          phone: '+91 98765-43210',
          createdByUser: owner,
        });

        expect(result).toEqual({
          type: 'contact',
          contact: { id: 'B', status: 'pending', mergedIntoContact: null },
        });
        expect(contactRepository.save).not.toHaveBeenCalled();
      });

      it('follows a MERGED Contact whose survivor is itself CLAIMED through to the User', async () => {
        store['B'] = {
          id: 'B',
          status: 'claimed',
          mergedIntoContact: null,
          claimedByUser: { id: 'U9', email: 'rahul@gmail.com' },
        };
        contactRepository.find.mockResolvedValueOnce([
          {
            id: 'A',
            status: 'archived',
            email: 'rahul@gmail.com',
            mergedIntoContact: { id: 'B' },
            claimedByUser: null,
          },
        ]);

        const result = await service.resolveOrCreateIdentity({
          email: 'rahul@gmail.com',
          createdByUser: owner,
        });

        expect(result).toEqual({
          type: 'user',
          user: { id: 'U9', email: 'rahul@gmail.com' },
        });
      });

      it('resolves a multi-hop merge chain A→B→C to the terminal pending Contact', async () => {
        store['B'] = {
          id: 'B',
          status: 'archived',
          mergedIntoContact: { id: 'C' },
        };
        store['C'] = { id: 'C', status: 'pending', mergedIntoContact: null };
        contactRepository.find.mockResolvedValueOnce([
          {
            id: 'A',
            status: 'archived',
            email: 'rahul@gmail.com',
            mergedIntoContact: { id: 'B' },
            claimedByUser: null,
          },
        ]);

        const result = await service.resolveOrCreateIdentity({
          email: 'rahul@gmail.com',
          createdByUser: owner,
        });

        expect(result.type).toBe('contact');
        expect(result.contact?.id).toBe('C');
      });

      it('does not hang on a merge cycle A→B→A; falls through to create a new pending Contact', async () => {
        store['A'] = {
          id: 'A',
          status: 'archived',
          mergedIntoContact: { id: 'B' },
        };
        store['B'] = {
          id: 'B',
          status: 'archived',
          mergedIntoContact: { id: 'A' },
        };
        contactRepository.find.mockResolvedValueOnce([store['A']]);
        contactRepository.save.mockResolvedValueOnce({
          id: 'fresh-id',
          email: 'rahul@gmail.com',
        });

        const result = await service.resolveOrCreateIdentity({
          email: 'rahul@gmail.com',
          createdByUser: owner,
        });

        // Unresolvable cycle → safe fallback: a brand-new pending Contact.
        expect(result.type).toBe('contact');
        expect(contactRepository.save).toHaveBeenCalled();
      });

      it('ignores claimed/merged rows and reuses a pending Contact when that is the only match', async () => {
        // No non-pending match; the existing pending resolve-or-create path runs.
        contactRepository.find.mockResolvedValueOnce([]);
        contactRepository.findOne.mockResolvedValueOnce({
          id: 'P1',
          email: 'rahul@gmail.com',
          status: 'pending',
        });

        const result = await service.resolveOrCreateIdentity({
          email: 'rahul@gmail.com',
          createdByUser: owner,
        });

        expect(result).toEqual({
          type: 'contact',
          contact: { id: 'P1', email: 'rahul@gmail.com', status: 'pending' },
        });
        expect(contactRepository.save).not.toHaveBeenCalled();
      });
    });
  });

  describe('claimContactsForUser', () => {
    it('links every GroupMember across every group referencing a matching pending Contact, in one transaction', async () => {
      const newUser = {
        id: 'new-user-id',
        email: 'rahul@gmail.com',
        emailVerified: true,
      } as User;
      const pendingContact = {
        id: 'contact-1',
        email: 'rahul@gmail.com',
        status: 'pending',
      };
      contactRepository.find.mockResolvedValueOnce([pendingContact]);
      groupMemberRepository.find.mockResolvedValueOnce([
        {
          id: 'member-family',
          group: { id: 'group-family' },
          joinStatus: 'invited',
        },
        {
          id: 'member-trip',
          group: { id: 'group-trip' },
          joinStatus: 'invited',
        },
      ]);

      const result = await service.claimContactsForUser(newUser);

      expect(contactRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'contact-1',
          status: 'claimed',
          claimedByUser: newUser,
        }),
      );
      expect(groupMemberRepository.save).toHaveBeenCalledTimes(2);
      expect(groupMemberRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'member-family',
          user: newUser,
          joinStatus: 'active',
        }),
      );
      expect(groupMemberRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'member-trip',
          user: newUser,
          joinStatus: 'active',
        }),
      );
      expect(result.linkedGroupIds.sort()).toEqual(
        ['group-family', 'group-trip'].sort(),
      );
      expect(result.claimedContactIds).toEqual(['contact-1']);
    });

    it('writes a contact.claimed audit event for each claimed Contact', async () => {
      const newUser = {
        id: 'new-user-id',
        email: 'rahul@gmail.com',
        emailVerified: true,
      } as User;
      contactRepository.find.mockResolvedValueOnce([
        { id: 'contact-1', email: 'rahul@gmail.com', status: 'pending' },
      ]);
      groupMemberRepository.find.mockResolvedValueOnce([]);

      await service.claimContactsForUser(newUser);

      expect(auditLogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'contact.claimed',
          entityType: 'contact',
          entityId: 'contact-1',
          actorUser: newUser,
        }),
      );
    });

    it('NEVER claims by phone — looks up pending Contacts by the verified email only (Fix C: phone claiming removed)', async () => {
      const newUser = {
        id: 'new-user-id',
        email: 'unrelated@example.com',
        phoneNumber: '+919876543210',
        emailVerified: true,
      } as User;
      contactRepository.find.mockResolvedValueOnce([]); // no email match

      const result = await service.claimContactsForUser(newUser);

      // The Contact lookup is by email + pending only — phone is never queried.
      const whereArg = contactRepository.find.mock.calls[0][0].where;
      expect(whereArg).toEqual({
        email: 'unrelated@example.com',
        status: 'pending',
      });
      expect(JSON.stringify(whereArg).toLowerCase()).not.toContain('phone');
      expect(result.claimedContactIds).toEqual([]);
      expect(contactRepository.save).not.toHaveBeenCalled();
    });

    it('is a no-op (queries nothing) when the user email is UNVERIFIED (Fix C: claim gated on verified email)', async () => {
      const newUser = {
        id: 'new-user-id',
        email: 'rahul@gmail.com',
        emailVerified: false,
      } as User;

      const result = await service.claimContactsForUser(newUser);

      expect(contactRepository.find).not.toHaveBeenCalled();
      expect(contactRepository.save).not.toHaveBeenCalled();
      expect(result).toEqual({
        linkedGroupIds: [],
        claimedContactIds: [],
        skippedContactIds: [],
      });
    });

    it('SKIP-AND-FLAG: skips a Contact (leaves it pending, no row changes) when claiming it would collide with an existing (group,user) membership, and warns', async () => {
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);
      const newUser = {
        id: 'new-user-id',
        email: 'rahul@gmail.com',
        emailVerified: true,
      } as User;
      contactRepository.find.mockResolvedValueOnce([
        { id: 'contact-1', email: 'rahul@gmail.com', status: 'pending' },
      ]);
      groupMemberRepository.find
        // the Contact's memberships
        .mockResolvedValueOnce([
          { id: 'gm-contact', group: { id: 'group-family' } },
        ])
        // the user is ALREADY a member of group-family → collision
        .mockResolvedValueOnce([{ id: 'gm-existing-user' }]);

      const result = await service.claimContactsForUser(newUser);

      expect(result.skippedContactIds).toEqual(['contact-1']);
      expect(result.claimedContactIds).toEqual([]);
      // Not closed out, not repointed, not archived — nothing written.
      expect(contactRepository.save).not.toHaveBeenCalled();
      expect(groupMemberRepository.save).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('does nothing and creates no rows when no pending Contact matches', async () => {
      contactRepository.find.mockResolvedValueOnce([]);

      const result = await service.claimContactsForUser({
        id: 'new-user-id',
        email: 'nobody-added-me@example.com',
        emailVerified: true,
      } as User);

      expect(contactRepository.save).not.toHaveBeenCalled();
      expect(groupMemberRepository.save).not.toHaveBeenCalled();
      expect(result).toEqual({
        linkedGroupIds: [],
        claimedContactIds: [],
        skippedContactIds: [],
      });
    });

    it('is idempotent: a second run finds no pending Contact and changes nothing', async () => {
      const newUser = {
        id: 'new-user-id',
        email: 'rahul@gmail.com',
        emailVerified: true,
      } as User;
      // First run claims contact-1; second run finds nothing pending.
      contactRepository.find
        .mockResolvedValueOnce([
          { id: 'contact-1', email: 'rahul@gmail.com', status: 'pending' },
        ])
        .mockResolvedValueOnce([]);
      groupMemberRepository.find.mockResolvedValueOnce([]); // contact has no members

      const first = await service.claimContactsForUser(newUser);
      expect(first.claimedContactIds).toEqual(['contact-1']);

      contactRepository.save.mockClear();
      groupMemberRepository.save.mockClear();

      const second = await service.claimContactsForUser(newUser);
      expect(second.claimedContactIds).toEqual([]);
      expect(contactRepository.save).not.toHaveBeenCalled();
      expect(groupMemberRepository.save).not.toHaveBeenCalled();
    });

    it('never touches a Contact already claimed/merged by someone else (excluded by the pending filter) — no claim, no crash', async () => {
      const newUser = {
        id: 'new-user-id',
        email: 'rahul@gmail.com',
        emailVerified: true,
      } as User;
      // The only Contact for this email was already claimed by another user, so
      // the status='pending' lookup returns nothing.
      contactRepository.find.mockResolvedValueOnce([]);

      const result = await service.claimContactsForUser(newUser);

      expect(result).toEqual({
        linkedGroupIds: [],
        claimedContactIds: [],
        skippedContactIds: [],
      });
      expect(contactRepository.save).not.toHaveBeenCalled();
      expect(groupMemberRepository.save).not.toHaveBeenCalled();
    });

    it('AFTER VERIFICATION: activates the invitee’s existing Contact-backed membership IN PLACE (same GroupMember id), so a previously-rejected unverified user is auto-added with no duplicate row', async () => {
      const verifiedUser = {
        id: 'joiner-id',
        email: 'joiner@example.com',
        emailVerified: true,
      } as User;
      contactRepository.find.mockResolvedValueOnce([
        { id: 'contact-1', email: 'joiner@example.com', status: 'pending' },
      ]);
      groupMemberRepository.find
        .mockResolvedValueOnce([
          {
            id: 'existing-contact-backed-member',
            group: { id: 'group-1' },
            joinStatus: 'invited',
          },
        ]) // the Contact's existing membership
        .mockResolvedValueOnce([]); // no (group,user) collision

      const result = await service.claimContactsForUser(verifiedUser);

      // The SAME membership row is activated & linked — not a new one.
      expect(groupMemberRepository.save).toHaveBeenCalledTimes(1);
      expect(groupMemberRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'existing-contact-backed-member',
          user: verifiedUser,
          joinStatus: 'active',
        }),
      );
      expect(result.linkedGroupIds).toEqual(['group-1']);
      expect(result.claimedContactIds).toEqual(['contact-1']);
      expect(result.skippedContactIds).toEqual([]);
    });
  });

  describe('listAddressBook', () => {
    it('returns a deduplicated entry for a pending contact shared across multiple groups', async () => {
      groupMemberRepository.find
        .mockResolvedValueOnce([
          { group: { id: 'g1' } },
          { group: { id: 'g2' } },
        ]) // caller's own active memberships
        .mockResolvedValueOnce([
          {
            contact: {
              id: 'contact-1',
              status: 'pending',
              displayName: 'Alice',
              email: 'alice@x.com',
              phoneNumber: null,
            },
            group: { id: 'g1', name: 'Group One' },
          },
          {
            contact: {
              id: 'contact-1',
              status: 'pending',
              displayName: 'Alice',
              email: 'alice@x.com',
              phoneNumber: null,
            },
            group: { id: 'g2', name: 'Group Two' },
          },
        ]); // shared members across both groups

      const result = await service.listAddressBook('caller-id');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        contactId: 'contact-1',
        displayName: 'Alice',
        email: 'alice@x.com',
      });
      expect(result[0].sharedGroups).toEqual([
        { groupId: 'g1', groupName: 'Group One' },
        { groupId: 'g2', groupName: 'Group Two' },
      ]);
    });

    it('excludes claimed contacts (already visible via member/friends views)', async () => {
      groupMemberRepository.find
        .mockResolvedValueOnce([{ group: { id: 'g1' } }])
        .mockResolvedValueOnce([
          {
            contact: { id: 'contact-2', status: 'claimed', displayName: 'Bob' },
            group: { id: 'g1', name: 'Group One' },
          },
        ]);

      const result = await service.listAddressBook('caller-id');

      expect(result).toEqual([]);
    });

    it('excludes archived (merged) contacts defensively, even if a stale reference somehow existed', async () => {
      groupMemberRepository.find
        .mockResolvedValueOnce([{ group: { id: 'g1' } }])
        .mockResolvedValueOnce([
          {
            contact: {
              id: 'contact-3',
              status: 'archived',
              displayName: 'Carol',
            },
            group: { id: 'g1', name: 'Group One' },
          },
        ]);

      const result = await service.listAddressBook('caller-id');

      expect(result).toEqual([]);
    });

    it('excludes registered co-members (memberships with no contact)', async () => {
      groupMemberRepository.find
        .mockResolvedValueOnce([{ group: { id: 'g1' } }])
        .mockResolvedValueOnce([
          {
            contact: undefined,
            user: { id: 'other-user' },
            group: { id: 'g1', name: 'Group One' },
          },
        ]);

      const result = await service.listAddressBook('caller-id');

      expect(result).toEqual([]);
    });

    it('scopes the lookup to only the groups the caller is an active member of', async () => {
      groupMemberRepository.find
        .mockResolvedValueOnce([
          { group: { id: 'g1' } },
          { group: { id: 'g2' } },
        ])
        .mockResolvedValueOnce([]);

      await service.listAddressBook('caller-id');

      const secondCallArgs = groupMemberRepository.find.mock.calls[1][0];
      expect(secondCallArgs.where.group.id.value).toEqual(['g1', 'g2']);
    });

    it('returns an empty array when the caller has no active group memberships', async () => {
      groupMemberRepository.find.mockResolvedValueOnce([]);

      const result = await service.listAddressBook('caller-id');

      expect(result).toEqual([]);
      expect(groupMemberRepository.find).toHaveBeenCalledTimes(1);
    });
  });

  describe('computeMergeConfidence', () => {
    it('scores HIGH for a shared email', () => {
      const result = service.computeMergeConfidence(
        { email: 'a@x.com' } as Contact,
        { email: 'A@X.com' } as Contact,
      );
      expect(result.confidence).toBe('HIGH');
    });

    it('scores HIGH for a shared phone', () => {
      const result = service.computeMergeConfidence(
        { phoneNumber: '+911234567890' } as Contact,
        { phoneNumber: '+91 1234 567890' } as Contact,
      );
      expect(result.confidence).toBe('HIGH');
    });

    it('scores MEDIUM for a shared display name only', () => {
      const result = service.computeMergeConfidence(
        { displayName: 'Rahul' } as Contact,
        { displayName: 'rahul' } as Contact,
      );
      expect(result.confidence).toBe('MEDIUM');
    });

    it('scores LOW when nothing matches', () => {
      const result = service.computeMergeConfidence(
        { displayName: 'Rahul', email: 'a@x.com' } as Contact,
        { displayName: 'Priya', email: 'b@x.com' } as Contact,
      );
      expect(result.confidence).toBe('LOW');
    });
  });

  describe('resolveMergeRedirect', () => {
    it('resolves a multi-hop chain to the final non-archived Contact, not one hop (hardening D)', async () => {
      const c: Record<string, any> = {
        A: { id: 'A', status: 'archived' },
        B: { id: 'B', status: 'archived' },
        C: { id: 'C', status: 'claimed' },
      };
      c.A.mergedIntoContact = { id: 'B' };
      c.B.mergedIntoContact = { id: 'C' };
      contactRepository.findOne.mockImplementation(async ({ where }: any) =>
        c[where.id] ? { ...c[where.id] } : null,
      );

      const result = await service.resolveMergeRedirect(c.A as Contact);

      expect(result.id).toBe('C');
    });

    it('returns the Contact unchanged if it was never merged', async () => {
      const result = await service.resolveMergeRedirect({
        id: 'solo',
        status: 'pending',
      } as Contact);
      expect(result.id).toBe('solo');
    });
  });

  describe('mergeContacts', () => {
    const admin = { id: 'admin-id' } as User;

    it('acquires both advisory locks before reading either contact (hardening: concurrent-merge race)', async () => {
      const callOrder: string[] = [];
      mockManager.query.mockImplementation(async () => {
        callOrder.push('lock');
      });
      contactRepository.findOne.mockImplementation(async () => {
        callOrder.push('find');
        return { id: 'x', email: 'a@x.com', status: 'pending' };
      });
      contactRepository.save.mockImplementation(async (data: any) => {
        callOrder.push('save');
        return data;
      });

      await service.mergeContacts({
        survivingContactId: 'surviving',
        losingContactId: 'losing',
        mergedByUser: admin,
      });

      // Both locks acquired first, in order, before any read/write happens.
      expect(callOrder.slice(0, 2)).toEqual(['lock', 'lock']);
      expect(mockManager.query).toHaveBeenCalledTimes(2);
    });

    it('acquires the two locks in the same canonical order regardless of which contact is "surviving" vs "losing"', async () => {
      contactRepository.findOne.mockResolvedValue({
        id: 'x',
        email: 'a@x.com',
        status: 'pending',
      });
      contactRepository.save.mockImplementation(async (data: any) => data);

      await service.mergeContacts({
        survivingContactId: 'aaaa',
        losingContactId: 'bbbb',
        mergedByUser: admin,
      });
      const firstOrderCalls = mockManager.query.mock.calls.map((c) => c[1]);

      mockManager.query.mockClear();

      await service.mergeContacts({
        survivingContactId: 'bbbb',
        losingContactId: 'aaaa',
        mergedByUser: admin,
      });
      const reversedOrderCalls = mockManager.query.mock.calls.map((c) => c[1]);

      // Same two lock ids, acquired in the same order, no matter which
      // contact was passed as surviving vs losing — this is what prevents a
      // deadlock between merge(A,B) and merge(B,A) run concurrently.
      expect(firstOrderCalls).toEqual(reversedOrderCalls);
    });

    it('merges a HIGH-confidence pair: archives the loser, stamps merge fields, repoints memberships', async () => {
      contactRepository.findOne
        .mockResolvedValueOnce({
          id: 'surviving',
          email: 'a@x.com',
          status: 'pending',
        })
        .mockResolvedValueOnce({
          id: 'losing',
          email: 'a@x.com',
          status: 'pending',
        });
      groupMemberRepository.find
        .mockResolvedValueOnce([{ id: 'gm-losing', group: { id: 'group-1' } }]) // losing's memberships
        .mockResolvedValueOnce([]); // surviving's memberships (no collision)

      const result = await service.mergeContacts({
        survivingContactId: 'surviving',
        losingContactId: 'losing',
        mergedByUser: admin,
      });

      expect(result.id).toBe('surviving');
      expect(contactRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'losing',
          status: 'archived',
          mergedIntoContact: expect.objectContaining({ id: 'surviving' }),
          mergedByUser: admin,
        }),
      );
      expect(groupMemberRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'gm-losing',
          contact: expect.objectContaining({ id: 'surviving' }),
        }),
      );
    });

    it('writes a contact.merged audit event, keyed to the losing Contact, when an actual merge happens', async () => {
      contactRepository.findOne
        .mockResolvedValueOnce({
          id: 'surviving',
          email: 'a@x.com',
          status: 'pending',
        })
        .mockResolvedValueOnce({
          id: 'losing',
          email: 'a@x.com',
          status: 'pending',
        });
      groupMemberRepository.find.mockResolvedValue([]);

      await service.mergeContacts({
        survivingContactId: 'surviving',
        losingContactId: 'losing',
        mergedByUser: admin,
      });

      expect(auditLogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'contact.merged',
          entityType: 'contact',
          entityId: 'losing',
          actorUser: admin,
          metadataJson: expect.objectContaining({
            survivingContactId: 'surviving',
          }),
        }),
      );
    });

    it('rejects a LOW-confidence pair even with confirmed:true (hardening B — cannot merge unrelated identities)', async () => {
      contactRepository.findOne
        .mockResolvedValueOnce({
          id: 'surviving',
          email: 'a@x.com',
          displayName: 'Alice',
        })
        .mockResolvedValueOnce({
          id: 'losing',
          email: 'b@x.com',
          displayName: 'Bob',
        });

      await expect(
        service.mergeContacts({
          survivingContactId: 'surviving',
          losingContactId: 'losing',
          mergedByUser: admin,
          confirmed: true,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(contactRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a MEDIUM-confidence pair without explicit confirmation', async () => {
      contactRepository.findOne
        .mockResolvedValueOnce({ id: 'surviving', displayName: 'Rahul' })
        .mockResolvedValueOnce({ id: 'losing', displayName: 'Rahul' });

      await expect(
        service.mergeContacts({
          survivingContactId: 'surviving',
          losingContactId: 'losing',
          mergedByUser: admin,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a MEDIUM-confidence pair when the caller explicitly confirms', async () => {
      contactRepository.findOne
        .mockResolvedValueOnce({ id: 'surviving', displayName: 'Rahul' })
        .mockResolvedValueOnce({ id: 'losing', displayName: 'Rahul' });
      groupMemberRepository.find.mockResolvedValue([]);

      const result = await service.mergeContacts({
        survivingContactId: 'surviving',
        losingContactId: 'losing',
        mergedByUser: admin,
        confirmed: true,
      });

      expect(result.id).toBe('surviving');
    });

    it('is idempotent: retrying a merge against an already-archived Contact returns the surviving Contact without error (hardening E)', async () => {
      contactRepository.findOne
        .mockResolvedValueOnce({ id: 'surviving', status: 'pending' }) // initial fetch: surviving
        .mockResolvedValueOnce({
          id: 'losing',
          status: 'archived',
          mergedIntoContact: { id: 'surviving' },
        }) // initial fetch: losing
        .mockResolvedValueOnce({ id: 'surviving', status: 'pending' }); // redirect-chain lookup for losing -> surviving

      const result = await service.mergeContacts({
        survivingContactId: 'surviving',
        losingContactId: 'losing',
        mergedByUser: admin,
      });

      expect(result.id).toBe('surviving');
      // Already merged — no re-archiving, no re-authorization needed.
      expect(contactRepository.save).not.toHaveBeenCalled();
    });

    it('does not write a contact.merged audit event on the idempotent no-op path', async () => {
      contactRepository.findOne
        .mockResolvedValueOnce({ id: 'surviving', status: 'pending' })
        .mockResolvedValueOnce({
          id: 'losing',
          status: 'archived',
          mergedIntoContact: { id: 'surviving' },
        })
        .mockResolvedValueOnce({ id: 'surviving', status: 'pending' });

      await service.mergeContacts({
        survivingContactId: 'surviving',
        losingContactId: 'losing',
        mergedByUser: admin,
      });

      expect(auditLogRepository.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when either contact does not exist', async () => {
      contactRepository.findOne.mockResolvedValueOnce(null);
      await expect(
        service.mergeContacts({
          survivingContactId: 'missing',
          losingContactId: 'also-missing',
          mergedByUser: admin,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects merging a Contact into itself', async () => {
      await expect(
        service.mergeContacts({
          survivingContactId: 'same',
          losingContactId: 'same',
          mergedByUser: admin,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a same-group merge (409) and changes no data, instead of closing out the losing membership (Fix M.1)', async () => {
      contactRepository.findOne
        .mockResolvedValueOnce({ id: 'surviving', email: 'a@x.com' })
        .mockResolvedValueOnce({ id: 'losing', email: 'a@x.com' });
      groupMemberRepository.find
        .mockResolvedValueOnce([
          { id: 'gm-losing-family', group: { id: 'group-family', name: 'Family' } },
        ]) // losing's memberships
        .mockResolvedValueOnce([
          {
            id: 'gm-surviving-family',
            group: { id: 'group-family', name: 'Family' },
          },
        ]); // surviving already in the SAME group → merge unsupported

      await expect(
        service.mergeContacts({
          survivingContactId: 'surviving',
          losingContactId: 'losing',
          mergedByUser: admin,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      // Rejected BEFORE any write: loser not archived, no membership touched,
      // no audit — so no balance is stranded on a `removed` row.
      expect(contactRepository.save).not.toHaveBeenCalled();
      expect(groupMemberRepository.save).not.toHaveBeenCalled();
      expect(auditLogRepository.save).not.toHaveBeenCalled();
    });

    it('still merges across DIFFERENT groups, repointing the losing membership (no close-out, balances preserved)', async () => {
      contactRepository.findOne
        .mockResolvedValueOnce({ id: 'surviving', email: 'a@x.com' })
        .mockResolvedValueOnce({ id: 'losing', email: 'a@x.com' });
      groupMemberRepository.find
        .mockResolvedValueOnce([
          { id: 'gm-losing-trip', group: { id: 'group-trip', name: 'Trip' } },
        ]) // losing is in group-trip
        .mockResolvedValueOnce([
          { id: 'gm-surviving-flat', group: { id: 'group-flat', name: 'Flat' } },
        ]); // surviving is in a DIFFERENT group → no clash

      const result = await service.mergeContacts({
        survivingContactId: 'surviving',
        losingContactId: 'losing',
        mergedByUser: admin,
      });

      expect(result.id).toBe('surviving');
      // The losing membership is repointed to the survivor (never closed out),
      // so its historical splits/settlements keep resolving to a live member.
      expect(groupMemberRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'gm-losing-trip',
          contact: expect.objectContaining({ id: 'surviving' }),
        }),
      );
      expect(groupMemberRepository.save).not.toHaveBeenCalledWith(
        expect.objectContaining({ joinStatus: 'removed' }),
      );
    });
  });

  describe('getTimeline', () => {
    it('returns paginated, ordered timeline events for a contact with no merge history', async () => {
      contactRepository.findOne.mockResolvedValueOnce({
        id: 'c1',
        status: 'pending',
      });
      contactRepository.find.mockResolvedValueOnce([]); // no merge ancestors
      groupMemberRepository.find.mockResolvedValueOnce([
        { group: { id: 'g1' } },
      ]); // caller's own memberships
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'shared-member',
      }); // shares a group with c1

      const log = {
        id: 'log-1',
        action: 'contact.created',
        actorUser: { id: 'u1', displayName: 'Alice' },
        metadataJson: { email: 'x@y.com' },
        createdAt: new Date('2026-01-01'),
      };
      const qb = auditLogQueryBuilder;
      qb.getManyAndCount.mockResolvedValueOnce([[log], 1]);

      const result = await service.getTimeline('caller-id', 'c1', 1, 20);

      expect(result.data).toEqual([
        {
          id: 'log-1',
          action: 'contact.created',
          actorUserId: 'u1',
          actorDisplayName: 'Alice',
          metadata: { email: 'x@y.com' },
          createdAt: log.createdAt,
        },
      ]);
      expect(result.meta.totalItems).toBe(1);
      expect(qb.where).toHaveBeenCalledWith('log.entityType = :entityType', {
        entityType: 'contact',
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'log.entityId IN (:...allContactIds)',
        { allContactIds: ['c1'] },
      );
      expect(qb.orderBy).toHaveBeenCalledWith('log.createdAt', 'DESC');
    });

    it('aggregates ancestor history across a multi-hop merge chain (C merged into B merged into A)', async () => {
      contactRepository.findOne.mockResolvedValueOnce({
        id: 'A',
        status: 'pending',
      });
      contactRepository.find
        .mockResolvedValueOnce([{ id: 'B' }]) // merged into A
        .mockResolvedValueOnce([{ id: 'C' }]) // merged into B
        .mockResolvedValueOnce([]); // nothing merged into C
      groupMemberRepository.find.mockResolvedValueOnce([
        { group: { id: 'g1' } },
      ]);
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'shared-member',
      });
      const qb = auditLogQueryBuilder;
      qb.getManyAndCount.mockResolvedValueOnce([[], 0]);

      await service.getTimeline('caller-id', 'A', 1, 20);

      expect(qb.andWhere).toHaveBeenCalledWith(
        'log.entityId IN (:...allContactIds)',
        { allContactIds: ['A', 'B', 'C'] },
      );
    });

    it('transparently redirects to the survivor when queried by an archived (merged) contact id', async () => {
      contactRepository.findOne
        .mockResolvedValueOnce({
          id: 'B',
          status: 'archived',
          mergedIntoContact: { id: 'A' },
        }) // initial lookup by the archived id
        .mockResolvedValueOnce({ id: 'A', status: 'pending' }); // redirect chase
      contactRepository.find
        .mockResolvedValueOnce([{ id: 'B' }]) // merged into A
        .mockResolvedValueOnce([]); // nothing merged into B
      groupMemberRepository.find.mockResolvedValueOnce([
        { group: { id: 'g1' } },
      ]);
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'shared-member',
      });
      const qb = auditLogQueryBuilder;
      qb.getManyAndCount.mockResolvedValueOnce([[], 0]);

      const result = await service.getTimeline('caller-id', 'B', 1, 20);

      expect(qb.andWhere).toHaveBeenCalledWith(
        'log.entityId IN (:...allContactIds)',
        { allContactIds: ['A', 'B'] },
      );
      expect(result.links.first).toContain('/contacts/A/timeline');
    });

    it('throws ForbiddenException when the caller shares no group with the contact', async () => {
      contactRepository.findOne.mockResolvedValueOnce({
        id: 'c1',
        status: 'pending',
      });
      contactRepository.find.mockResolvedValueOnce([]);
      groupMemberRepository.find.mockResolvedValueOnce([
        { group: { id: 'g1' } },
      ]);
      groupMemberRepository.findOne.mockResolvedValueOnce(null); // no overlap

      await expect(
        service.getTimeline('caller-id', 'c1', 1, 20),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when the caller has no active group memberships at all', async () => {
      contactRepository.findOne.mockResolvedValueOnce({
        id: 'c1',
        status: 'pending',
      });
      contactRepository.find.mockResolvedValueOnce([]);
      groupMemberRepository.find.mockResolvedValueOnce([]);

      await expect(
        service.getTimeline('caller-id', 'c1', 1, 20),
      ).rejects.toThrow(ForbiddenException);
      expect(groupMemberRepository.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the contact does not exist', async () => {
      contactRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.getTimeline('caller-id', 'missing', 1, 20),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
