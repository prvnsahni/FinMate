import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { BalancesService } from './balances.service';
import { SettlementsService } from './settlements.service';

describe('BalancesService', () => {
  let service: BalancesService;
  let getOverallBalances: jest.Mock;

  const row = (
    groupMemberId: string,
    currency: string,
    netBalance: number,
  ) => ({
    userId: null,
    contactId: null,
    groupMemberId,
    displayName: groupMemberId,
    netBalance,
    currency,
  });

  beforeEach(async () => {
    getOverallBalances = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BalancesService,
        { provide: SettlementsService, useValue: { getOverallBalances } },
      ],
    }).compile();
    service = module.get(BalancesService);
  });

  describe('getGroupMemberNetByCurrency', () => {
    it('returns only the target member’s NON-ZERO currencies', async () => {
      getOverallBalances.mockResolvedValue([
        row('m1', 'USD', 40),
        row('m1', 'INR', 0), // settled in INR — excluded
        row('m2', 'USD', -40), // other member — excluded
      ]);

      const map = await service.getGroupMemberNetByCurrency('g1', 'm1');
      expect([...map.entries()]).toEqual([['USD', 40]]);
    });

    it('returns an empty map when the member is fully settled', async () => {
      getOverallBalances.mockResolvedValue([
        row('m1', 'USD', 0),
        row('m2', 'USD', 0),
      ]);
      const map = await service.getGroupMemberNetByCurrency('g1', 'm1');
      expect(map.size).toBe(0);
    });

    it('rounds to 2dp so sub-cent drift counts as zero', async () => {
      getOverallBalances.mockResolvedValue([row('m1', 'USD', 0.0001)]);
      const map = await service.getGroupMemberNetByCurrency('g1', 'm1');
      expect(map.size).toBe(0);
    });
  });

  describe('assertZeroBalance', () => {
    it('passes silently when the member is settled in every currency', async () => {
      getOverallBalances.mockResolvedValue([row('m1', 'USD', 0)]);
      await expect(
        service.assertZeroBalance('g1', 'm1'),
      ).resolves.toBeUndefined();
    });

    it('throws 409 MEMBER_BALANCE_NONZERO with a per-currency breakdown when non-zero', async () => {
      getOverallBalances.mockResolvedValue([
        row('m1', 'USD', 40),
        row('m1', 'INR', -12.5),
      ]);

      const err = await service
        .assertZeroBalance('g1', 'm1', { displayName: 'Alice' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      const res = err.getResponse();
      expect(res.errorCode).toBe('MEMBER_BALANCE_NONZERO');
      expect(res.message).toContain('Alice');
      expect(res.balances).toEqual(
        expect.arrayContaining([
          { currency: 'USD', net: 40 },
          { currency: 'INR', net: -12.5 },
        ]),
      );
    });
  });
});
