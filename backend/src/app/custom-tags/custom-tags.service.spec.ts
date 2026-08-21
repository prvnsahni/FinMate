import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import {
  CustomTag,
  GroupKeyVersion,
  GroupMember,
} from '@finmate/data-models';
import { CustomTagsService } from './custom-tags.service';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CreatePersonalCustomTagDto,
  CreateGroupCustomTagDto,
  UpdateCustomTagDto,
} from './dto';

const USER_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const GROUP_X = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const GROUP_Y = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
const GKV_ACTIVE = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
const TAG_ID = 'ffffffff-ffff-4fff-ffff-ffffffffffff';

// A valid `iv:ciphertext` pair (both base64). The server treats it opaquely.
const CIPHERTEXT = 'YWJjZA==:ZGVmZ2hpamtsbW5vcA==';
const CIPHERTEXT_2 = 'MTIzNA==:NTY3ODkwYWJjZGVm';

describe('CustomTagsService', () => {
  let service: CustomTagsService;
  let customTagRepository: jest.Mocked<Repository<CustomTag>>;
  let groupMemberRepository: jest.Mocked<Repository<GroupMember>>;
  let groupKeyVersionRepository: jest.Mocked<Repository<GroupKeyVersion>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomTagsService,
        {
          provide: getRepositoryToken(CustomTag),
          useValue: {
            create: jest.fn((data) => ({ ...data })),
            save: jest.fn(async (data) => ({
              id: data.id ?? TAG_ID,
              version: data.version ?? 1,
              createdAt: data.createdAt ?? new Date('2026-08-22T00:00:00Z'),
              updatedAt: new Date('2026-08-22T00:00:00Z'),
              status: data.status ?? 'active',
              ...data,
            })),
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(GroupMember),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(GroupKeyVersion),
          useValue: { findOne: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(CustomTagsService);
    customTagRepository = module.get(getRepositoryToken(CustomTag));
    groupMemberRepository = module.get(getRepositoryToken(GroupMember));
    groupKeyVersionRepository = module.get(getRepositoryToken(GroupKeyVersion));
  });

  const asMember = () =>
    groupMemberRepository.findOne.mockResolvedValue({
      id: 'm1',
      role: 'member',
      joinStatus: 'active',
    } as unknown as GroupMember);
  const asNonMember = () =>
    groupMemberRepository.findOne.mockResolvedValue(null);
  const activeKeyVersion = () =>
    groupKeyVersionRepository.findOne.mockResolvedValue({
      id: GKV_ACTIVE,
      status: 'ACTIVE',
      version: 3,
    } as unknown as GroupKeyVersion);

  // ─── AUTHORIZATION: PERSONAL ───────────────────────────────────────────────

  it('1. User A can create a personal tag (owned by A, personal scope)', async () => {
    const res = await service.createPersonal(USER_A, {
      encryptedName: CIPHERTEXT,
    });
    const saved = customTagRepository.save.mock.calls[0][0] as CustomTag;
    expect(saved.scopeType).toBe('personal');
    expect(saved.ownerUser).toEqual({ id: USER_A });
    expect(saved.group).toBeUndefined();
    expect(saved.groupKeyVersion).toBeUndefined();
    expect(res.scopeType).toBe('personal');
    expect(res.encryptedName).toBe(CIPHERTEXT);
  });

  it('2. User A can list own personal tags (scoped to A + active)', async () => {
    customTagRepository.find.mockResolvedValue([
      {
        id: TAG_ID,
        scopeType: 'personal',
        status: 'active',
        version: 1,
        encryptedName: CIPHERTEXT,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as CustomTag,
    ]);
    const res = await service.listPersonal(USER_A);
    expect(customTagRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scopeType: 'personal',
          status: 'active',
          ownerUser: { id: USER_A },
        }),
      }),
    );
    expect(res).toHaveLength(1);
  });

  it("3. User B cannot list A's personal tags (query is scoped to the caller)", async () => {
    customTagRepository.find.mockResolvedValue([]);
    const res = await service.listPersonal(USER_B);
    expect(customTagRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerUser: { id: USER_B } }),
      }),
    );
    expect(res).toEqual([]);
  });

  it('4. User A can rename own personal tag', async () => {
    customTagRepository.findOne.mockResolvedValue({
      id: TAG_ID,
      scopeType: 'personal',
      status: 'active',
      version: 1,
      encryptedName: CIPHERTEXT,
      ownerUser: { id: USER_A },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as CustomTag);
    const res = await service.rename(USER_A, TAG_ID, {
      encryptedName: CIPHERTEXT_2,
      version: 1,
    });
    const saved = customTagRepository.save.mock.calls[0][0] as CustomTag;
    expect(saved.encryptedName).toBe(CIPHERTEXT_2);
    expect(res.encryptedName).toBe(CIPHERTEXT_2);
  });

  it("5. User B cannot rename A's personal tag (IDOR → NotFound)", async () => {
    customTagRepository.findOne.mockResolvedValue({
      id: TAG_ID,
      scopeType: 'personal',
      version: 1,
      encryptedName: CIPHERTEXT,
      ownerUser: { id: USER_A },
    } as unknown as CustomTag);
    await expect(
      service.rename(USER_B, TAG_ID, { encryptedName: CIPHERTEXT_2, version: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(customTagRepository.save).not.toHaveBeenCalled();
  });

  it('6. User A can deprecate own personal tag', async () => {
    customTagRepository.findOne.mockResolvedValue({
      id: TAG_ID,
      scopeType: 'personal',
      status: 'active',
      version: 1,
      encryptedName: CIPHERTEXT,
      ownerUser: { id: USER_A },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as CustomTag);
    const res = await service.deprecate(USER_A, TAG_ID);
    const saved = customTagRepository.save.mock.calls[0][0] as CustomTag;
    expect(saved.status).toBe('deprecated');
    expect(res.status).toBe('deprecated');
  });

  // ─── AUTHORIZATION: GROUP ──────────────────────────────────────────────────

  it('7. Group member can create a group tag (with resolved key version)', async () => {
    asMember();
    activeKeyVersion();
    const res = await service.createGroup(USER_A, GROUP_X, {
      encryptedName: CIPHERTEXT,
    });
    const saved = customTagRepository.save.mock.calls[0][0] as CustomTag;
    expect(saved.scopeType).toBe('group');
    expect(saved.group).toEqual({ id: GROUP_X });
    expect(saved.ownerUser).toBeUndefined();
    expect((saved.groupKeyVersion as GroupKeyVersion).id).toBe(GKV_ACTIVE);
    expect(res.groupId).toBe(GROUP_X);
  });

  it('8. Group member can list group tags', async () => {
    asMember();
    customTagRepository.find.mockResolvedValue([]);
    await service.listGroup(USER_A, GROUP_X);
    expect(customTagRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scopeType: 'group',
          status: 'active',
          group: { id: GROUP_X },
        }),
      }),
    );
  });

  it('9. Non-member cannot list group tags (Forbidden)', async () => {
    asNonMember();
    await expect(service.listGroup(USER_B, GROUP_X)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(customTagRepository.find).not.toHaveBeenCalled();
  });

  it('10. Non-member cannot create group tag (Forbidden)', async () => {
    asNonMember();
    await expect(
      service.createGroup(USER_B, GROUP_X, { encryptedName: CIPHERTEXT }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(customTagRepository.save).not.toHaveBeenCalled();
  });

  it('11. Non-member cannot rename a group tag (IDOR → NotFound)', async () => {
    customTagRepository.findOne.mockResolvedValue({
      id: TAG_ID,
      scopeType: 'group',
      version: 1,
      encryptedName: CIPHERTEXT,
      group: { id: GROUP_X },
    } as unknown as CustomTag);
    asNonMember();
    await expect(
      service.rename(USER_B, TAG_ID, { encryptedName: CIPHERTEXT_2, version: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(customTagRepository.save).not.toHaveBeenCalled();
  });

  it('12. Non-member cannot deprecate a group tag (IDOR → NotFound)', async () => {
    customTagRepository.findOne.mockResolvedValue({
      id: TAG_ID,
      scopeType: 'group',
      version: 1,
      encryptedName: CIPHERTEXT,
      group: { id: GROUP_X },
    } as unknown as CustomTag);
    asNonMember();
    await expect(service.deprecate(USER_B, TAG_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(customTagRepository.save).not.toHaveBeenCalled();
  });

  // ─── E2EE NAME HANDLING ────────────────────────────────────────────────────

  it('13. backend rejects a non-ciphertext (plaintext) name at the DTO boundary', async () => {
    const good = plainToInstance(CreatePersonalCustomTagDto, {
      encryptedName: CIPHERTEXT,
    });
    const bad = plainToInstance(CreatePersonalCustomTagDto, {
      encryptedName: 'Groceries', // plaintext, not iv:ciphertext
    });
    expect(await validate(good)).toHaveLength(0);
    expect(await validate(bad)).not.toHaveLength(0);
  });

  it('14. encryptedName is stored byte-for-byte unchanged', async () => {
    await service.createPersonal(USER_A, { encryptedName: CIPHERTEXT });
    const saved = customTagRepository.save.mock.calls[0][0] as CustomTag;
    expect(saved.encryptedName).toBe(CIPHERTEXT);
  });

  it('15. response exposes ONLY the opaque name (no owner/creator account leak)', async () => {
    const res = await service.createPersonal(USER_A, {
      encryptedName: CIPHERTEXT,
    });
    expect(res).not.toHaveProperty('ownerUser');
    expect(res).not.toHaveProperty('createdByUser');
    expect(Object.keys(res)).toEqual(
      expect.arrayContaining(['encryptedName', 'scopeType', 'status']),
    );
  });

  it('16/17. no decrypt path and no plaintext/key logging during CRUD', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    // The service exposes no decrypt/unwrap method.
    expect(
      (service as unknown as Record<string, unknown>)['decrypt'],
    ).toBeUndefined();
    await service.createPersonal(USER_A, { encryptedName: CIPHERTEXT });
    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls]
      .flat()
      .join(' ');
    expect(logged).not.toContain(CIPHERTEXT);
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  // ─── LIFECYCLE ─────────────────────────────────────────────────────────────

  it('18. active lists exclude deprecated tags (status=active filter)', async () => {
    asMember();
    customTagRepository.find.mockResolvedValue([]);
    await service.listGroup(USER_A, GROUP_X);
    await service.listPersonal(USER_A);
    for (const call of customTagRepository.find.mock.calls) {
      expect((call[0] as { where: { status: string } }).where.status).toBe(
        'active',
      );
    }
  });

  it('19. deprecate is non-destructive (no hard delete, no expense_tags touch)', async () => {
    customTagRepository.findOne.mockResolvedValue({
      id: TAG_ID,
      scopeType: 'personal',
      status: 'active',
      version: 1,
      encryptedName: CIPHERTEXT,
      ownerUser: { id: USER_A },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as CustomTag);
    await service.deprecate(USER_A, TAG_ID);
    // Only a status flip via save — the repo has no delete/remove invocation and
    // the service holds no expense/expense_tags repository at all.
    expect(
      (customTagRepository as unknown as Record<string, unknown>)['delete'],
    ).toBeUndefined();
    const saved = customTagRepository.save.mock.calls[0][0] as CustomTag;
    expect(saved.status).toBe('deprecated');
  });

  it('20. service exposes no global-taxonomy mutation surface', () => {
    for (const forbidden of [
      'createGlobal',
      'promote',
      'renameCanonical',
      'deleteCanonical',
    ]) {
      expect(
        (service as unknown as Record<string, unknown>)[forbidden],
      ).toBeUndefined();
    }
  });

  it('21. stale version on rename → CON_VERSION_CONFLICT (existing convention)', async () => {
    customTagRepository.findOne.mockResolvedValue({
      id: TAG_ID,
      scopeType: 'personal',
      status: 'active',
      version: 5,
      encryptedName: CIPHERTEXT,
      ownerUser: { id: USER_A },
    } as unknown as CustomTag);
    try {
      await service.rename(USER_A, TAG_ID, {
        encryptedName: CIPHERTEXT_2,
        version: 1,
      });
      fail('expected version conflict');
    } catch (e) {
      expect(e).toBeInstanceOf(PreconditionFailedException);
      expect((e as PreconditionFailedException).getResponse()).toMatchObject({
        errorCode: 'CON_VERSION_CONFLICT',
      });
    }
    expect(customTagRepository.save).not.toHaveBeenCalled();
  });

  // ─── SCOPE ─────────────────────────────────────────────────────────────────

  it('22. personal create is always personal scope, never group (route-derived)', async () => {
    // Even if the client smuggles group hints, the DTO whitelist drops them and
    // the service derives scope from the route — the saved row stays personal.
    await service.createPersonal(USER_A, {
      encryptedName: CIPHERTEXT,
      // @ts-expect-error — extra fields are not part of the DTO
      scopeType: 'group',
      groupId: GROUP_X,
    });
    const saved = customTagRepository.save.mock.calls[0][0] as CustomTag;
    expect(saved.scopeType).toBe('personal');
    expect(saved.group).toBeUndefined();
  });

  it('23/24. group create binds to the route group + verifies that membership', async () => {
    asMember();
    activeKeyVersion();
    await service.createGroup(USER_A, GROUP_Y, { encryptedName: CIPHERTEXT });
    expect(groupMemberRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          group: { id: GROUP_Y },
          user: { id: USER_A },
          joinStatus: 'active',
        }),
      }),
    );
    const saved = customTagRepository.save.mock.calls[0][0] as CustomTag;
    expect(saved.group).toEqual({ id: GROUP_Y });
  });

  it('25a. a declared REVOKED key version is rejected (BadRequest)', async () => {
    asMember();
    groupKeyVersionRepository.findOne.mockResolvedValue({
      id: 'revoked-1',
      status: 'REVOKED',
      version: 2,
    } as unknown as GroupKeyVersion);
    await expect(
      service.createGroup(USER_A, GROUP_X, {
        encryptedName: CIPHERTEXT,
        groupKeyVersionId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('25b. with no declared version the ACTIVE version is stamped', async () => {
    asMember();
    activeKeyVersion();
    await service.createGroup(USER_A, GROUP_X, { encryptedName: CIPHERTEXT });
    const saved = customTagRepository.save.mock.calls[0][0] as CustomTag;
    expect((saved.groupKeyVersion as GroupKeyVersion).id).toBe(GKV_ACTIVE);
  });

  it('25c. group with no active key version → BadRequest (no auto-provision)', async () => {
    asMember();
    groupKeyVersionRepository.findOne.mockResolvedValue(null);
    await expect(
      service.createGroup(USER_A, GROUP_X, { encryptedName: CIPHERTEXT }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ─── FINANCE (structural) ──────────────────────────────────────────────────

  it('26. service holds no finance repositories (cannot touch the ledger)', () => {
    const injected = Object.values(
      service as unknown as Record<string, unknown>,
    );
    // Only the three tag/authorization repositories are present — no expense,
    // split, payment, settlement or balance repository is reachable here.
    expect(injected).toContain(customTagRepository);
    expect(injected).toContain(groupMemberRepository);
    expect(injected).toContain(groupKeyVersionRepository);
    expect(injected).toHaveLength(3);
  });

  // ─── ADVERSARIAL: malformed / missing metadata ─────────────────────────────

  it('malformed encrypted payload is rejected at the DTO boundary', async () => {
    const cases = ['', 'no-colon', 'not_base64:@@@', 'a:b:c'];
    for (const value of cases) {
      const dto = plainToInstance(CreateGroupCustomTagDto, {
        encryptedName: value,
      });
      expect(await validate(dto)).not.toHaveLength(0);
    }
  });

  it('rename DTO requires an integer version (optimistic lock cannot be skipped)', async () => {
    const dto = plainToInstance(UpdateCustomTagDto, {
      encryptedName: CIPHERTEXT,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'version')).toBe(true);
  });
});
