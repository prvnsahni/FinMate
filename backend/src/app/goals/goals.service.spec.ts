import { NotFoundException, PreconditionFailedException } from '@nestjs/common';
import { GoalsService } from './goals.service';

const goalRow = (over: any = {}) => ({
  id: 'g1',
  title: 'CIPHERTEXT',
  encryptedContentKey: 'WRAPPED',
  targetAmount: '1000.00',
  savedAmount: '250.00',
  currency: 'USD',
  targetDate: '2027-01-01',
  status: 'active',
  priority: 0,
  version: 3,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

describe('GoalsService (BATCH-11)', () => {
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    remove: jest.Mock;
  };
  let engine: { project: jest.Mock };
  let svc: GoalsService;

  beforeEach(() => {
    repo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ ...goalRow(), ...x })),
      find: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
    };
    engine = { project: jest.fn().mockReturnValue({ status: 'ok' }) };
    svc = new GoalsService(repo as any, engine as any);
  });

  it('create stores ciphertext title + wrapped key under the caller as owner', async () => {
    await svc.create('user-1', {
      title: 'CIPHERTEXT',
      encryptedContentKey: 'WRAPPED',
      targetAmount: 1000,
      currency: 'USD',
    } as any);
    const created = repo.create.mock.calls[0][0];
    expect(created.ownerUser).toEqual({ id: 'user-1' });
    expect(created.title).toBe('CIPHERTEXT'); // opaque — no decryption
    expect(created.encryptedContentKey).toBe('WRAPPED');
    expect(created.status).toBe('active');
  });

  it('list is owner-scoped and deterministically ordered', async () => {
    repo.find.mockResolvedValue([goalRow()]);
    const out = await svc.list('user-1');
    expect(repo.find).toHaveBeenCalledWith({
      where: { ownerUser: { id: 'user-1' } },
      order: { priority: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
    expect(out[0].title).toBe('CIPHERTEXT'); // ciphertext returned as-is
    expect(out[0].targetAmount).toBe(1000); // numeric coerced
  });

  it('get denies another user’s goal with 404 (IDOR-safe, owner-scoped query)', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(svc.get('attacker', 'g1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { id: 'g1', ownerUser: { id: 'attacker' } },
    });
  });

  it('update enforces optimistic version', async () => {
    repo.findOne.mockResolvedValue(goalRow({ version: 3 }));
    await expect(
      svc.update('user-1', 'g1', { version: 2 } as any),
    ).rejects.toBeInstanceOf(PreconditionFailedException);

    repo.findOne.mockResolvedValue(goalRow({ version: 3 }));
    await svc.update('user-1', 'g1', { version: 3, priority: 5 } as any);
    expect(repo.save).toHaveBeenCalled();
    expect(repo.save.mock.calls[0][0].priority).toBe(5);
  });

  it('remove crypto-shreds by deleting the row (destroys the wrapped key)', async () => {
    const row = goalRow();
    repo.findOne.mockResolvedValue(row);
    await svc.remove('user-1', 'g1');
    expect(repo.remove).toHaveBeenCalledWith(row);
  });

  it('project delegates to the engine with numeric-only input (no title/free-text)', async () => {
    repo.findOne.mockResolvedValue(goalRow());
    await svc.project('user-1', 'g1', 100, '2026-07-01T00:00:00Z');
    const arg = engine.project.mock.calls[0][0];
    expect(arg.goal.targetAmount).toBe(1000);
    expect(arg.goal.savedAmount).toBe(250);
    expect(arg.assumedMonthlyContribution).toBe(100);
    expect(JSON.stringify(arg)).not.toContain('CIPHERTEXT'); // no ciphertext/title
    expect(arg.goal).not.toHaveProperty('title');
  });
});
