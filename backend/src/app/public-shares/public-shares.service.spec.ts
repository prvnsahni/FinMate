import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { GroupMember, PublicShare } from '@finmate/data-models';
import { PublicSharesService } from './public-shares.service';

const USER = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const GROUP = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

describe('PublicSharesService (PUBLIC-1B)', () => {
  let service: PublicSharesService;
  let shares: any[];
  let shareRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let memberRepo: { findOne: jest.Mock };
  let lockQb: { setLock: jest.Mock; where: jest.Mock; getOne: jest.Mock };

  beforeEach(async () => {
    shares = [];
    let seq = 0;
    shareRepo = {
      find: jest.fn(async ({ where }: any) =>
        shares.filter(
          (s) =>
            s.group.id === where.group.id &&
            (!where.status || s.status === where.status),
        ),
      ),
      findOne: jest.fn(
        async ({ where }: any) =>
          shares
            .filter((s) => s.group.id === where.group.id)
            .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
      ),
      create: jest.fn((data: any) => ({ ...data })),
      save: jest.fn(async (s: any) => {
        if (!s.id) {
          s.id = `sh-${++seq}`;
          s.createdAt = s.createdAt ?? Date.now() + seq;
          shares.push(s);
        }
        return s;
      }),
    };
    memberRepo = { findOne: jest.fn() };
    lockQb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: GROUP }),
    };
    const dataSource = {
      transaction: jest.fn(async (cb: any) =>
        cb({
          getRepository: () => shareRepo,
          createQueryBuilder: () => lockQb,
        }),
      ),
    } as unknown as DataSource;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicSharesService,
        { provide: getRepositoryToken(PublicShare), useValue: shareRepo },
        { provide: getRepositoryToken(GroupMember), useValue: memberRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    service = module.get(PublicSharesService);
  });

  const asRole = (role: string) =>
    memberRepo.findOne.mockResolvedValue({
      id: 'm',
      role,
      joinStatus: 'active',
    } as unknown as GroupMember);
  const asNonMember = () => memberRepo.findOne.mockResolvedValue(null);
  const activeShares = () => shares.filter((s) => s.status === 'active');

  // ── AUTHORIZATION ───────────────────────────────────────────────────────────

  it('1/2. owner and admin can create a share', async () => {
    asRole('owner');
    await expect(service.create(USER, GROUP, {})).resolves.toMatchObject({
      status: 'active',
    });
    shares = [];
    asRole('admin');
    await expect(service.create(USER, GROUP, {})).resolves.toMatchObject({
      status: 'active',
    });
  });

  it('3/4. a plain member and a viewer cannot create (Forbidden)', async () => {
    asRole('member');
    await expect(service.create(USER, GROUP, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    asRole('viewer');
    await expect(service.create(USER, GROUP, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(shareRepo.save).not.toHaveBeenCalled();
  });

  it('5. a non-member cannot create (Forbidden, no group disclosure)', async () => {
    asNonMember();
    await expect(service.create(USER, GROUP, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // ── TOKEN SECRECY ───────────────────────────────────────────────────────────

  it('6/7/8. create returns the raw token ONCE; DB stores only its sha256 hash; no hash in the response', async () => {
    asRole('owner');
    const res = await service.create(USER, GROUP, {});
    expect(typeof res.token).toBe('string');
    expect(res.token.length).toBeGreaterThan(20); // base64url of 32 bytes
    // Persisted row holds ONLY the sha256 hex of the returned token — never the raw token.
    const saved = shareRepo.save.mock.calls[0][0];
    expect(saved.tokenHash).toBe(
      createHash('sha256').update(res.token).digest('hex'),
    );
    expect(saved.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(saved).not.toHaveProperty('token');
    expect(saved).not.toHaveProperty('rawToken');
    // The response never leaks the hash / group id / internal ids.
    expect(res).not.toHaveProperty('tokenHash');
    expect(res).not.toHaveProperty('groupId');
    expect(res).not.toHaveProperty('createdByUserId');
  });

  it('9. GET status never returns the token or the hash', async () => {
    asRole('owner');
    await service.create(USER, GROUP, {});
    const status = await service.getStatus(USER, GROUP);
    expect(status).not.toHaveProperty('token');
    expect(status).not.toHaveProperty('tokenHash');
    expect(status).toMatchObject({ active: true, status: 'active' });
  });

  it('rejects a second create while a share is already active (one active share)', async () => {
    asRole('owner');
    await service.create(USER, GROUP, {});
    await expect(service.create(USER, GROUP, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(activeShares().length).toBe(1);
  });

  // ── REGENERATE ──────────────────────────────────────────────────────────────

  it('10/11/12/13. regenerate issues a new token, atomically revokes the old, leaving exactly one active', async () => {
    asRole('admin');
    const first = await service.create(USER, GROUP, {});
    const second = await service.regenerate(USER, GROUP, {});
    expect(second.token).not.toBe(first.token);
    // Runs in a transaction with a group-row lock (serializes concurrent regenerate).
    expect(lockQb.setLock).toHaveBeenCalledWith('pessimistic_write');
    // Exactly one ACTIVE share remains; the previous one is revoked.
    expect(activeShares().length).toBe(1);
    expect(shares.filter((s) => s.status === 'revoked').length).toBe(1);
    const revoked = shares.find((s) => s.status === 'revoked');
    expect(revoked.revokedAt).toBeInstanceOf(Date);
  });

  it('regenerate works even with no prior share (nothing to revoke)', async () => {
    asRole('owner');
    const res = await service.regenerate(USER, GROUP, {});
    expect(res.status).toBe('active');
    expect(activeShares().length).toBe(1);
  });

  // ── REVOKE ──────────────────────────────────────────────────────────────────

  it('14. revoke invalidates the active share immediately', async () => {
    asRole('owner');
    await service.create(USER, GROUP, {});
    await expect(service.revoke(USER, GROUP)).resolves.toEqual({
      revoked: true,
    });
    expect(activeShares().length).toBe(0);
  });

  it('15. revoke is idempotent when nothing is active (safe no-op)', async () => {
    asRole('owner');
    await expect(service.revoke(USER, GROUP)).resolves.toEqual({
      revoked: false,
    });
  });

  // ── EXPIRY ──────────────────────────────────────────────────────────────────

  it('16. a past / invalid expiry is rejected', async () => {
    asRole('owner');
    await expect(
      service.create(USER, GROUP, { expiresAt: '2000-01-01T00:00:00Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(USER, GROUP, { expiresAt: 'not-a-date' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(shareRepo.save).not.toHaveBeenCalled();
  });

  it('a valid future expiry is accepted and reflected in status', async () => {
    asRole('owner');
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const res = await service.create(USER, GROUP, { expiresAt: future });
    expect(res.expiresAt).toBe(future);
    const status = await service.getStatus(USER, GROUP);
    expect(status.active).toBe(true);
  });

  it('17. an expired active share reports active:false in status', async () => {
    asRole('owner');
    // Insert an active row already past its expiry directly into the store.
    shares.push({
      id: 'x',
      group: { id: GROUP },
      status: 'active',
      expiresAt: new Date(Date.now() - 1000),
      createdAt: Date.now(),
      revokedAt: null,
    });
    const status = await service.getStatus(USER, GROUP);
    expect(status.active).toBe(false);
  });

  // ── SAFETY: no logging, no E2EE, no finance ─────────────────────────────────

  it('18. never logs the raw token', async () => {
    const logSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const errSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    asRole('owner');
    const res = await service.create(USER, GROUP, {});
    const logged = [...logSpy.mock.calls, ...errSpy.mock.calls]
      .flat()
      .join(' ');
    expect(logged).not.toContain(res.token);
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('19/20. holds no crypto/E2EE or finance repositories (cannot decrypt or mutate the ledger)', () => {
    const injected = Object.values(
      service as unknown as Record<string, unknown>,
    );
    // Only the two repositories + the DataSource are present.
    expect(injected).toContain(shareRepo);
    expect(injected).toContain(memberRepo);
    expect(injected).toHaveLength(3);
    expect(
      (service as unknown as Record<string, unknown>)['decrypt'],
    ).toBeUndefined();
  });
});
