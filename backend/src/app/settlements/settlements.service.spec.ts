import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  Group,
  GroupMember,
  Expense,
  ExpenseSplit,
  ExpensePayment,
  Settlement,
  SettlementVersion,
  AuditLog,
} from '@finmate/data-models';
import { SettlementsService, MemberBalance } from './settlements.service';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
  PreconditionFailedException,
} from '@nestjs/common';

describe('SettlementsService', () => {
  let service: SettlementsService;
  let groupRepository: jest.Mocked<Repository<Group>>;
  let groupMemberRepository: jest.Mocked<Repository<GroupMember>>;
  let expenseRepository: jest.Mocked<Repository<Expense>>;
  let expenseSplitRepository: jest.Mocked<Repository<ExpenseSplit>>;
  let settlementRepository: jest.Mocked<Repository<Settlement>>;
  let settlementVersionRepository: jest.Mocked<Repository<SettlementVersion>>;
  let managerQuery: jest.Mock;

  beforeEach(async () => {
    const mockGroupRepository = {
      findOne: jest.fn(),
    };

    const mockGroupMemberRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest
          .fn()
          .mockImplementation(() => mockGroupMemberRepository.findOne()),
      })),
    };

    const mockExpenseRepository: any = {
      find: jest.fn(),
      // computeBalancesCore fetches expenses via a query builder; delegate its
      // getMany() to the same `find` mock the tests already configure, forwarding
      // the groupId (captured from `.where('expense.group = :groupId', ...)`) so
      // group-keyed mock implementations still resolve the right expenses.
      createQueryBuilder: jest.fn(() => {
        let capturedGroupId: string | undefined;
        // The filtered/period query adds `expense.isCarryForward = false`; honor
        // just that one clause so tests can assert carry-forward exclusion (the
        // other andWhere clauses stay no-ops, exercised by the DB layer instead).
        let excludeCarryForward = false;
        const qb: any = {
          leftJoinAndSelect: jest.fn(() => qb),
          where: jest.fn((_sql: string, params?: any) => {
            if (params?.groupId) capturedGroupId = params.groupId;
            return qb;
          }),
          andWhere: jest.fn((sql: string) => {
            if (typeof sql === 'string' && sql.includes('isCarryForward')) {
              excludeCarryForward = true;
            }
            return qb;
          }),
          setParameter: jest.fn(() => qb),
          getMany: jest.fn(async () => {
            const rows = await mockExpenseRepository.find({
              where: { group: { id: capturedGroupId } },
            });
            return excludeCarryForward
              ? (rows ?? []).filter((e: any) => !e.isCarryForward)
              : rows;
          }),
        };
        return qb;
      }),
    };

    const mockExpenseSplitRepository = {
      find: jest.fn(),
    };

    // Default to no payment rows so the balance engine uses the single-payer
    // `paidBy*` fallback — the behaviour these tests were written against.
    const mockExpensePaymentRepository = {
      find: jest.fn().mockResolvedValue([]),
    };

    const mockSettlementRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const mockAuditLogRepository = {
      save: jest.fn(),
      create: jest.fn(),
    };

    const mockSettlementVersionRepository = {
      save: jest.fn((data) => Promise.resolve(data)),
      create: jest.fn((data) => data),
    };

    const mockEntityManager = {
      // Raw FOR SHARE member lock (member-lock.util) — no-op in unit tests.
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entityClass) => {
        if (entityClass === GroupMember) {
          return {
            find: mockGroupMemberRepository.find,
          };
        }
        return { find: jest.fn().mockResolvedValue([]) };
      }),
      findOne: jest.fn(async (entityClass, options: any) => {
        if (entityClass === GroupMember) {
          const res = await mockGroupMemberRepository.findOne(options);
          if (res && !res.user) {
            res.user = {
              id: options?.where?.user?.id || 'caller-id',
              email: 'test@example.com',
            } as any;
          }
          return res;
        }
        if (entityClass === Settlement) {
          return mockSettlementRepository.findOne(options);
        }
        return null;
      }),
      create: jest.fn((entityClass, data) => {
        if (entityClass === Settlement) {
          return mockSettlementRepository.create(data);
        }
        if (entityClass === SettlementVersion) {
          return mockSettlementVersionRepository.create(data);
        }
        return data;
      }),
      save: jest.fn((entityClass, data) => {
        if (entityClass === Settlement) {
          return mockSettlementRepository.save(data);
        }
        if (entityClass === SettlementVersion) {
          return mockSettlementVersionRepository.save(data);
        }
        return data;
      }),
    };

    managerQuery = mockEntityManager.query as jest.Mock;

    const mockDataSource = {
      transaction: jest.fn((cb) => cb(mockEntityManager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettlementsService,
        { provide: getRepositoryToken(Group), useValue: mockGroupRepository },
        {
          provide: getRepositoryToken(GroupMember),
          useValue: mockGroupMemberRepository,
        },
        {
          provide: getRepositoryToken(Expense),
          useValue: mockExpenseRepository,
        },
        {
          provide: getRepositoryToken(ExpenseSplit),
          useValue: mockExpenseSplitRepository,
        },
        {
          provide: getRepositoryToken(ExpensePayment),
          useValue: mockExpensePaymentRepository,
        },
        {
          provide: getRepositoryToken(Settlement),
          useValue: mockSettlementRepository,
        },
        {
          provide: getRepositoryToken(AuditLog),
          useValue: mockAuditLogRepository,
        },
        {
          provide: getRepositoryToken(SettlementVersion),
          useValue: mockSettlementVersionRepository,
        },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<SettlementsService>(SettlementsService);
    groupRepository = module.get(getRepositoryToken(Group));
    groupMemberRepository = module.get(getRepositoryToken(GroupMember));
    expenseRepository = module.get(getRepositoryToken(Expense));
    expenseSplitRepository = module.get(getRepositoryToken(ExpenseSplit));
    settlementRepository = module.get(getRepositoryToken(Settlement));
    settlementVersionRepository = module.get(
      getRepositoryToken(SettlementVersion),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('simplifyDebts (Core Math Algorithm)', () => {
    it('Example A: Simple Debt (No Tie-Breaks)', () => {
      // User A (aaaa) is owed $90. User B (bbbb) owes $30. User C (cccc) owes $60.
      const balances: MemberBalance[] = [
        { userId: 'aaaa', balance: 90.0 },
        { userId: 'bbbb', balance: -30.0 },
        { userId: 'cccc', balance: -60.0 },
      ];

      const result = service.simplifyDebts(balances, 'USD');

      expect(result).toHaveLength(2);
      // cccc owes most, so cccc pays aaaa $60 first
      expect(result[0]).toEqual({
        fromUserId: 'cccc',
        toUserId: 'aaaa',
        amount: 60.0,
        currency: 'USD',
      });
      // bbbb pays aaaa $30 next
      expect(result[1]).toEqual({
        fromUserId: 'bbbb',
        toUserId: 'aaaa',
        amount: 30.0,
        currency: 'USD',
      });
    });

    it('Example B: Rounding Remainder (Equal Split of $10.00)', () => {
      // User A (aaaa) is owed $6.66. User B (bbbb) owes $3.33. User C (cccc) owes $3.33.
      const balances: MemberBalance[] = [
        { userId: 'aaaa', balance: 6.66 },
        { userId: 'bbbb', balance: -3.33 },
        { userId: 'cccc', balance: -3.33 },
      ];

      const result = service.simplifyDebts(balances, 'USD');

      expect(result).toHaveLength(2);
      // bbbb and cccc owe same. Lexicographically, bbbb comes before cccc.
      // So bbbb pays aaaa $3.33 first.
      expect(result[0]).toEqual({
        fromUserId: 'bbbb',
        toUserId: 'aaaa',
        amount: 3.33,
        currency: 'USD',
      });
      // cccc pays aaaa $3.33 next.
      expect(result[1]).toEqual({
        fromUserId: 'cccc',
        toUserId: 'aaaa',
        amount: 3.33,
        currency: 'USD',
      });
    });

    it('Example C: Sorting & Tie-Breaking (Multiple equal balances)', () => {
      // User A (1111) owes $100. User B (2222) owes $100. User C (3333) is owed $200.
      const balances: MemberBalance[] = [
        { userId: '1111', balance: -100.0 },
        { userId: '2222', balance: -100.0 },
        { userId: '3333', balance: 200.0 },
      ];

      const result = service.simplifyDebts(balances, 'USD');

      expect(result).toHaveLength(2);
      // User A (1111) is lexicographically before User B (2222).
      // So 1111 pays 3333 $100 first.
      expect(result[0]).toEqual({
        fromUserId: '1111',
        toUserId: '3333',
        amount: 100.0,
        currency: 'USD',
      });
      // 2222 pays 3333 $100 next.
      expect(result[1]).toEqual({
        fromUserId: '2222',
        toUserId: '3333',
        amount: 100.0,
        currency: 'USD',
      });
    });

    it('should minimize circular debts and return empty for net zero inputs', () => {
      const balances: MemberBalance[] = [
        { userId: 'aaaa', balance: 0.0 },
        { userId: 'bbbb', balance: 0.004 }, // under 0.01 tolerance -> ignored
      ];

      const result = service.simplifyDebts(balances, 'USD');
      expect(result).toHaveLength(0);
    });

    it('should resolve a complex circular debt scenario', () => {
      // A owes B $10, B owes C $10, C owes A $10 (net balances all 0)
      const balances: MemberBalance[] = [
        { userId: 'aaaa', balance: 0.0 },
        { userId: 'bbbb', balance: 0.0 },
        { userId: 'cccc', balance: 0.0 },
      ];

      const result = service.simplifyDebts(balances, 'USD');
      expect(result).toHaveLength(0);
    });
  });

  describe('calculateGroupBalances', () => {
    it('should throw ForbiddenException if caller is not an active member', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.calculateGroupBalances('user-id', 'group-id'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should compile balances and simplify debts across multiple currencies', async () => {
      // Setup members
      const userA = { id: 'aaaa', email: 'a@ex.com', displayName: 'User A' };
      const userB = { id: 'bbbb', email: 'b@ex.com', displayName: 'User B' };

      const mockMembers = [
        { id: 'member-a', user: userA, joinStatus: 'active' },
        { id: 'member-b', user: userB, joinStatus: 'active' },
      ] as any[];

      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({ id: 'group-id' } as any);
      groupMemberRepository.find.mockResolvedValueOnce(mockMembers);

      // Expenses
      const mockExpenses = [
        {
          id: 'exp-1',
          amountTotal: 100.0,
          currency: 'USD',
          paidByUser: userA,
        },
      ] as any[];
      // Persistent (not Once): computeBalancesCore runs for both overall + filtered.
      expenseRepository.find.mockResolvedValue(mockExpenses);

      // Splits: User B owes $100 for exp-1
      const mockSplits = [
        {
          expense: { id: 'exp-1', currency: 'USD' },
          participantUser: userB,
          amountOwed: 100.0,
        },
      ] as any[];
      expenseSplitRepository.find.mockResolvedValue(mockSplits);

      // Settlements: B paid A $30 in USD (confirmed)
      const mockSettlements = [
        {
          amount: 30.0,
          currency: 'USD',
          fromUser: userB,
          toUser: userA,
        },
      ] as any[];
      settlementRepository.find.mockResolvedValueOnce(mockSettlements);

      const result = await service.calculateGroupBalances('aaaa', 'group-id');

      expect(result).toBeDefined();
      // USD net balance calculations:
      // A paid 100, owes 0, received 30. Net = 100 - 0 - 30 = 70.
      // B paid 0, owes 100, paid 30. Net = 0 - 100 + 30 = -70.
      expect(result.overall.balances).toContainEqual(
        expect.objectContaining({
          userId: 'aaaa',
          netBalance: 70.0,
          currency: 'USD',
        }),
      );
      expect(result.overall.balances).toContainEqual(
        expect.objectContaining({
          userId: 'bbbb',
          netBalance: -70.0,
          currency: 'USD',
        }),
      );

      // Suggested settlements should simplify: B pays A $70. The response
      // additionally carries GroupMember/Contact ids for pending-member
      // support — fromUserId/toUserId stay populated and unchanged for an
      // all-registered group like this one.
      expect(result.overall.suggestedSettlements).toHaveLength(1);
      expect(result.overall.suggestedSettlements[0]).toMatchObject({
        fromUserId: 'bbbb',
        toUserId: 'aaaa',
        amount: 70.0,
        currency: 'USD',
      });
    });

    it('treats a refund as a negative expense in the settlement engine', async () => {
      // A pays 100 split equally (50/50). A refund of 20 (split equally) comes
      // back to the original payer A. Net spending = 80 ⇒ 40 each. A has paid a
      // net 80 and owes 40, so the group owes A 40; B owes 40.
      const userA = { id: 'aaaa', email: 'a@ex.com', displayName: 'User A' };
      const userB = { id: 'bbbb', email: 'b@ex.com', displayName: 'User B' };

      const mockMembers = [
        { id: 'member-a', user: userA, joinStatus: 'active' },
        { id: 'member-b', user: userB, joinStatus: 'active' },
      ] as any[];

      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({ id: 'group-id' } as any);
      groupMemberRepository.find.mockResolvedValueOnce(mockMembers);

      expenseRepository.find.mockResolvedValue([
        {
          id: 'exp-1',
          amountTotal: 100.0,
          currency: 'USD',
          transactionType: 'expense',
          paidByUser: userA,
        },
        {
          id: 'refund-1',
          amountTotal: 20.0,
          currency: 'USD',
          transactionType: 'refund',
          paidByUser: userA,
        },
      ] as any[]);

      expenseSplitRepository.find.mockResolvedValue([
        {
          expense: { id: 'exp-1', currency: 'USD', transactionType: 'expense' },
          participantUser: userA,
          amountOwed: 50.0,
        },
        {
          expense: { id: 'exp-1', currency: 'USD', transactionType: 'expense' },
          participantUser: userB,
          amountOwed: 50.0,
        },
        {
          expense: {
            id: 'refund-1',
            currency: 'USD',
            transactionType: 'refund',
          },
          participantUser: userA,
          amountOwed: 10.0,
        },
        {
          expense: {
            id: 'refund-1',
            currency: 'USD',
            transactionType: 'refund',
          },
          participantUser: userB,
          amountOwed: 10.0,
        },
      ] as any[]);

      settlementRepository.find.mockResolvedValueOnce([]);

      const result = await service.calculateGroupBalances('aaaa', 'group-id');

      expect(result.overall.balances).toContainEqual(
        expect.objectContaining({
          userId: 'aaaa',
          netBalance: 40.0,
          currency: 'USD',
        }),
      );
      expect(result.overall.balances).toContainEqual(
        expect.objectContaining({
          userId: 'bbbb',
          netBalance: -40.0,
          currency: 'USD',
        }),
      );
      expect(result.overall.suggestedSettlements[0]).toMatchObject({
        fromUserId: 'bbbb',
        toUserId: 'aaaa',
        amount: 40.0,
        currency: 'USD',
      });
    });

    it('returns a caller breakdown where opening + period = closing', async () => {
      // A pays 100, B owes 100. A settlement (B→A 30) folds into overall only.
      // Caller = A: closing (overall) = 100 − 30 = 70; period (filtered, no
      // settlements) = 100; opening = closing − period = −30 (the settlement,
      // correctly attributed to the carried-in Opening, never the period).
      const userA = { id: 'aaaa', email: 'a@ex.com', displayName: 'User A' };
      const userB = { id: 'bbbb', email: 'b@ex.com', displayName: 'User B' };
      const mockMembers = [
        { id: 'member-a', user: userA, joinStatus: 'active' },
        { id: 'member-b', user: userB, joinStatus: 'active' },
      ] as any[];

      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({
        id: 'group-id',
        currency: 'USD',
      } as any);
      groupMemberRepository.find.mockResolvedValueOnce(mockMembers);

      expenseRepository.find.mockResolvedValue([
        { id: 'exp-1', amountTotal: 100.0, currency: 'USD', paidByUser: userA },
      ] as any[]);
      expenseSplitRepository.find.mockResolvedValue([
        {
          expense: { id: 'exp-1', currency: 'USD' },
          participantUser: userB,
          amountOwed: 100.0,
        },
      ] as any[]);
      settlementRepository.find.mockResolvedValue([
        { amount: 30.0, currency: 'USD', fromUser: userB, toUser: userA },
      ] as any[]);

      // A filter must be supplied for a distinct filtered/period view to be
      // computed (otherwise filtered === overall).
      const result = await service.calculateGroupBalances('aaaa', 'group-id', {
        from: '2020-01-01',
      });

      expect(result.breakdown).toEqual({
        currency: 'USD',
        openingBalance: -30.0,
        currentPeriodBalance: 100.0,
        closingBalance: 70.0,
      });
      expect(
        result.breakdown.openingBalance + result.breakdown.currentPeriodBalance,
      ).toBeCloseTo(result.breakdown.closingBalance, 2);
    });

    it('excludes system carry-forward expenses from the filtered/period view but keeps them in overall', async () => {
      // Household rollover: a normal 100 expense (A pays, B owes) plus a
      // system carry-forward 40 expense (A pays, B owes). Overall counts both
      // (A +140/owed → net 140−0); the period slice drops the carry-forward.
      const userA = { id: 'aaaa', email: 'a@ex.com', displayName: 'User A' };
      const userB = { id: 'bbbb', email: 'b@ex.com', displayName: 'User B' };
      const mockMembers = [
        { id: 'member-a', user: userA, joinStatus: 'active' },
        { id: 'member-b', user: userB, joinStatus: 'active' },
      ] as any[];

      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({
        id: 'group-id',
        currency: 'USD',
      } as any);
      groupMemberRepository.find.mockResolvedValueOnce(mockMembers);

      expenseRepository.find.mockResolvedValue([
        {
          id: 'exp-1',
          amountTotal: 100.0,
          currency: 'USD',
          paidByUser: userA,
          isCarryForward: false,
        },
        {
          id: 'cf-1',
          amountTotal: 40.0,
          currency: 'USD',
          paidByUser: userA,
          isCarryForward: true,
        },
      ] as any[]);
      expenseSplitRepository.find.mockResolvedValue([
        {
          expense: { id: 'exp-1', currency: 'USD' },
          participantUser: userB,
          amountOwed: 100.0,
        },
        {
          expense: { id: 'cf-1', currency: 'USD' },
          participantUser: userB,
          amountOwed: 40.0,
        },
      ] as any[]);
      settlementRepository.find.mockResolvedValue([]);

      const result = await service.calculateGroupBalances('aaaa', 'group-id', {
        from: '2020-01-01',
      });

      // Overall keeps the carry-forward: A net = 100 + 40 = 140.
      expect(result.breakdown.closingBalance).toBe(140.0);
      // Period drops it: A net = 100 only.
      expect(result.breakdown.currentPeriodBalance).toBe(100.0);
      // Opening therefore carries the 40 rollover.
      expect(result.breakdown.openingBalance).toBe(40.0);
    });

    it('hides departed members from live balances when they are net-zero', async () => {
      const userA = { id: 'aaaa', email: 'a@ex.com', displayName: 'User A' };
      const userB = { id: 'bbbb', email: 'b@ex.com', displayName: 'User B' };

      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({
        id: 'group-id',
        currency: 'USD',
      } as any);
      groupMemberRepository.find.mockResolvedValueOnce([
        { id: 'member-a', user: userA, joinStatus: 'active' },
        { id: 'member-b', user: userB, joinStatus: 'left' },
      ] as any);

      expenseRepository.find.mockResolvedValue([] as any[]);
      expenseSplitRepository.find.mockResolvedValue([] as any[]);
      settlementRepository.find.mockResolvedValue([] as any[]);

      const result = await service.calculateGroupBalances('aaaa', 'group-id');

      expect(
        result.overall.balances.some((b) => b.groupMemberId === 'member-b'),
      ).toBe(false);
      expect(
        result.overall.suggestedSettlements.some(
          (s) =>
            s.fromGroupMemberId === 'member-b' ||
            s.toGroupMemberId === 'member-b',
        ),
      ).toBe(false);
      expect(result.memberSettledStatus).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            groupMemberId: 'member-a',
            settled: true,
          }),
          expect.objectContaining({
            groupMemberId: 'member-b',
            settled: true,
          }),
        ]),
      );
    });

    it('keeps departed members visible in live balances when non-zero', async () => {
      const userA = { id: 'aaaa', email: 'a@ex.com', displayName: 'User A' };
      const userB = { id: 'bbbb', email: 'b@ex.com', displayName: 'User B' };

      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({
        id: 'group-id',
        currency: 'USD',
      } as any);
      groupMemberRepository.find.mockResolvedValueOnce([
        { id: 'member-a', user: userA, joinStatus: 'active' },
        { id: 'member-b', user: userB, joinStatus: 'removed' },
      ] as any);

      expenseRepository.find.mockResolvedValue([
        {
          id: 'exp-1',
          amountTotal: 100,
          currency: 'USD',
          paidByUser: userA,
          transactionType: 'expense',
        },
      ] as any[]);
      expenseSplitRepository.find.mockResolvedValue([
        {
          expense: { id: 'exp-1', currency: 'USD', transactionType: 'expense' },
          participantUser: userB,
          amountOwed: 100,
        },
      ] as any[]);
      settlementRepository.find.mockResolvedValue([] as any[]);

      const result = await service.calculateGroupBalances('aaaa', 'group-id');

      expect(
        result.overall.balances.some((b) => b.groupMemberId === 'member-b'),
      ).toBe(true);
      expect(result.overall.suggestedSettlements.length).toBeGreaterThan(0);
      expect(result.memberSettledStatus).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            groupMemberId: 'member-b',
            settled: false,
            byCurrency: expect.arrayContaining([
              expect.objectContaining({
                currency: 'USD',
                settled: false,
              }),
            ]),
          }),
        ]),
      );
    });

    it('period view hides departed members at period-net zero even when overall net is non-zero', async () => {
      const userA = { id: 'aaaa', email: 'a@ex.com', displayName: 'User A' };
      const userB = { id: 'bbbb', email: 'b@ex.com', displayName: 'User B' };

      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({
        id: 'group-id',
        currency: 'USD',
      } as any);
      groupMemberRepository.find.mockResolvedValueOnce([
        { id: 'member-a', user: userA, joinStatus: 'active' },
        { id: 'member-b', user: userB, joinStatus: 'left' },
      ] as any);

      // First compute (overall): departed member has non-zero net due to historical spend.
      // Second compute (filtered period): no in-period rows, so member is period-net zero.
      expenseRepository.find
        .mockResolvedValueOnce([
          {
            id: 'hist-exp-1',
            amountTotal: 100,
            currency: 'USD',
            paidByUser: userA,
            transactionType: 'expense',
          },
        ] as any[])
        .mockResolvedValueOnce([] as any[]);

      expenseSplitRepository.find
        .mockResolvedValueOnce([
          {
            expense: {
              id: 'hist-exp-1',
              currency: 'USD',
              transactionType: 'expense',
            },
            participantUser: userB,
            amountOwed: 100,
          },
        ] as any[])
        .mockResolvedValueOnce([] as any[]);

      settlementRepository.find.mockResolvedValueOnce([] as any[]);

      const result = await service.calculateGroupBalances('aaaa', 'group-id', {
        from: '2026-09-01',
        to: '2026-09-30',
      });

      // Overall keeps departed member visible (non-zero all-time net).
      expect(
        result.overall.balances.some((b) => b.groupMemberId === 'member-b'),
      ).toBe(true);
      // Period view hides departed member (period-net zero).
      expect(
        result.filtered.balances.some((b) => b.groupMemberId === 'member-b'),
      ).toBe(false);
      expect(result.memberSettledStatus).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            groupMemberId: 'member-b',
            settled: false,
            byCurrency: expect.arrayContaining([
              expect.objectContaining({
                currency: 'USD',
                settled: false,
              }),
            ]),
          }),
        ]),
      );
    });

    it('keeps a departed cross-currency member visible when each currency is non-zero', async () => {
      const userA = { id: 'aaaa', email: 'a@ex.com', displayName: 'User A' };
      const userB = { id: 'bbbb', email: 'b@ex.com', displayName: 'User B' };

      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({
        id: 'group-id',
        currency: 'USD',
      } as any);
      groupMemberRepository.find.mockResolvedValueOnce([
        { id: 'member-a', user: userA, joinStatus: 'active' },
        { id: 'member-b', user: userB, joinStatus: 'left' },
      ] as any);

      expenseRepository.find.mockResolvedValue([
        {
          id: 'usd-exp',
          amountTotal: 100,
          currency: 'USD',
          paidByUser: userA,
          transactionType: 'expense',
        },
        {
          id: 'inr-exp',
          amountTotal: 100,
          currency: 'INR',
          paidByUser: userB,
          transactionType: 'expense',
        },
      ] as any[]);
      expenseSplitRepository.find.mockResolvedValue([
        {
          expense: { id: 'usd-exp', currency: 'USD', transactionType: 'expense' },
          participantUser: userB,
          amountOwed: 100,
        },
        {
          expense: { id: 'inr-exp', currency: 'INR', transactionType: 'expense' },
          participantUser: userA,
          amountOwed: 100,
        },
      ] as any[]);
      settlementRepository.find.mockResolvedValue([] as any[]);

      const result = await service.calculateGroupBalances('aaaa', 'group-id');

      const memberBBalances = result.overall.balances.filter(
        (b) => b.groupMemberId === 'member-b',
      );
      expect(memberBBalances.length).toBeGreaterThan(0);
      expect(memberBBalances).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ currency: 'USD', netBalance: -100 }),
          expect.objectContaining({ currency: 'INR', netBalance: 100 }),
        ]),
      );
      expect(result.memberSettledStatus).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ groupMemberId: 'member-b', settled: false }),
        ]),
      );
    });
  });

  // ── Phase 3: Friends Balance (registered-user-only aggregation) ─────────

  describe('calculateFriendsBalances', () => {
    const callerId = 'caller-id';

    /**
     * Wires the repository mocks so `calculateGroupBalances` (invoked once
     * per membership by `calculateFriendsBalances`) resolves correctly for
     * an arbitrary number of groups in a single test, without depending on
     * call order — each mock branches on the entity id in its own `where`.
     */
    function setupGroups(
      groups: Array<{
        id: string;
        currency: string;
        members: any[];
        expenses: any[];
        splits: any[];
        settlements?: any[];
      }>,
    ) {
      groupMemberRepository.find.mockImplementation((opts: any) => {
        if (opts?.where?.group?.id) {
          const g = groups.find((x) => x.id === opts.where.group.id);
          return Promise.resolve(g ? g.members : []);
        }
        if (opts?.where?.user?.id === callerId) {
          return Promise.resolve(
            groups.map((g) => ({ group: { id: g.id, name: `${g.id}-name` } })),
          );
        }
        return Promise.resolve([]);
      });

      groupMemberRepository.findOne.mockImplementation((opts?: any) => {
        if (!opts) {
          // createQueryBuilder().getOne() — caller access check inside
          // calculateGroupBalances; any truthy membership passes it.
          return Promise.resolve({ id: 'caller-access-ok' } as any);
        }
        // Direct `.findOne()` call — the friendMember display lookup inside
        // calculateFriendsBalances.
        const groupId = opts?.where?.group?.id;
        const wantedUserId = opts?.where?.user?.id;
        const g = groups.find((x) => x.id === groupId);
        const member = g?.members.find((m: any) => m.user?.id === wantedUserId);
        return Promise.resolve(member ?? null);
      });

      groupRepository.findOne.mockImplementation((opts: any) => {
        const g = groups.find((x) => x.id === opts?.where?.id);
        return Promise.resolve(
          (g ? { id: g.id, currency: g.currency } : null) as any,
        );
      });

      expenseRepository.find.mockImplementation((opts: any) => {
        const g = groups.find((x) => x.id === opts?.where?.group?.id);
        return Promise.resolve(g ? g.expenses : []);
      });

      expenseSplitRepository.find.mockImplementation((opts: any) => {
        const ids: string[] = opts?.where?.expense?.id?.value ?? [];
        const allSplits = groups.flatMap((g) => g.splits);
        return Promise.resolve(
          allSplits.filter((s) => ids.includes(s.expense.id)),
        );
      });

      settlementRepository.find.mockImplementation((opts: any) => {
        const g = groups.find((x) => x.id === opts?.where?.group?.id);
        return Promise.resolve(g?.settlements ?? []);
      });
    }

    it('aggregates a registered friend across multiple shared groups in the same currency into one entry', async () => {
      const callerG1 = {
        id: 'gm-caller-g1',
        user: { id: callerId, displayName: 'Caller', email: 'caller@x.com' },
      };
      const friendG1 = {
        id: 'gm-friend-g1',
        user: {
          id: 'user-friend',
          displayName: 'Friend One',
          email: 'friend@x.com',
        },
      };
      const callerG2 = {
        id: 'gm-caller-g2',
        user: { id: callerId, displayName: 'Caller', email: 'caller@x.com' },
      };
      const friendG2 = {
        id: 'gm-friend-g2',
        user: {
          id: 'user-friend',
          displayName: 'Friend One',
          email: 'friend@x.com',
        },
      };

      setupGroups([
        {
          id: 'g1',
          currency: 'USD',
          members: [callerG1, friendG1],
          // Caller paid 100, split equally -> friend owes caller 50.
          expenses: [
            {
              id: 'g1-exp-1',
              currency: 'USD',
              amountTotal: 100,
              paidByGroupMember: callerG1,
            },
          ],
          splits: [
            {
              expense: { id: 'g1-exp-1', currency: 'USD' },
              amountOwed: 50,
              participantGroupMember: callerG1,
            },
            {
              expense: { id: 'g1-exp-1', currency: 'USD' },
              amountOwed: 50,
              participantGroupMember: friendG1,
            },
          ],
        },
        {
          id: 'g2',
          currency: 'USD',
          members: [callerG2, friendG2],
          // Friend paid 40, split equally -> caller owes friend 20.
          expenses: [
            {
              id: 'g2-exp-1',
              currency: 'USD',
              amountTotal: 40,
              paidByGroupMember: friendG2,
            },
          ],
          splits: [
            {
              expense: { id: 'g2-exp-1', currency: 'USD' },
              amountOwed: 20,
              participantGroupMember: callerG2,
            },
            {
              expense: { id: 'g2-exp-1', currency: 'USD' },
              amountOwed: 20,
              participantGroupMember: friendG2,
            },
          ],
        },
      ]);

      const result = await service.calculateFriendsBalances(callerId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        friendId: 'user-friend_USD',
        displayName: 'Friend One (USD)',
        netBalance: 30, // +50 (g1) - 20 (g2)
      });
      expect(result[0].currencyDetails).toHaveLength(2);
    });

    it('buckets the same friend separately per currency', async () => {
      const callerG1 = {
        id: 'gm-caller-g1',
        user: { id: callerId, displayName: 'Caller', email: 'caller@x.com' },
      };
      const friendG1 = {
        id: 'gm-friend-g1',
        user: {
          id: 'user-friend',
          displayName: 'Friend One',
          email: 'friend@x.com',
        },
      };
      const callerG3 = {
        id: 'gm-caller-g3',
        user: { id: callerId, displayName: 'Caller', email: 'caller@x.com' },
      };
      const friendG3 = {
        id: 'gm-friend-g3',
        user: {
          id: 'user-friend',
          displayName: 'Friend One',
          email: 'friend@x.com',
        },
      };

      setupGroups([
        {
          id: 'g1',
          currency: 'USD',
          members: [callerG1, friendG1],
          expenses: [
            {
              id: 'g1-exp-1',
              currency: 'USD',
              amountTotal: 100,
              paidByGroupMember: callerG1,
            },
          ],
          splits: [
            {
              expense: { id: 'g1-exp-1', currency: 'USD' },
              amountOwed: 50,
              participantGroupMember: callerG1,
            },
            {
              expense: { id: 'g1-exp-1', currency: 'USD' },
              amountOwed: 50,
              participantGroupMember: friendG1,
            },
          ],
        },
        {
          id: 'g3',
          currency: 'EUR',
          members: [callerG3, friendG3],
          // Friend paid 60 EUR, split equally -> caller owes friend 30 EUR.
          expenses: [
            {
              id: 'g3-exp-1',
              currency: 'EUR',
              amountTotal: 60,
              paidByGroupMember: friendG3,
            },
          ],
          splits: [
            {
              expense: { id: 'g3-exp-1', currency: 'EUR' },
              amountOwed: 30,
              participantGroupMember: callerG3,
            },
            {
              expense: { id: 'g3-exp-1', currency: 'EUR' },
              amountOwed: 30,
              participantGroupMember: friendG3,
            },
          ],
        },
      ]);

      const result = await service.calculateFriendsBalances(callerId);

      expect(result).toHaveLength(2);
      const usd = result.find((r) => r.friendId === 'user-friend_USD');
      const eur = result.find((r) => r.friendId === 'user-friend_EUR');
      expect(usd?.netBalance).toBe(50);
      expect(eur?.netBalance).toBe(-30);
    });

    it('excludes a pending (Contact-backed) co-member from Friends aggregation', async () => {
      const caller = {
        id: 'gm-caller-g4',
        user: { id: callerId, displayName: 'Caller', email: 'caller@x.com' },
      };
      const pending = {
        id: 'gm-pending-g4',
        contact: { displayName: 'Pending Guy', email: 'pending@x.com' },
      };

      setupGroups([
        {
          id: 'g4',
          currency: 'USD',
          members: [caller, pending],
          // Caller paid 60, split equally -> pending owes caller 30.
          expenses: [
            {
              id: 'g4-exp-1',
              currency: 'USD',
              amountTotal: 60,
              paidByGroupMember: caller,
            },
          ],
          splits: [
            {
              expense: { id: 'g4-exp-1', currency: 'USD' },
              amountOwed: 30,
              participantGroupMember: caller,
            },
            {
              expense: { id: 'g4-exp-1', currency: 'USD' },
              amountOwed: 30,
              participantGroupMember: pending,
            },
          ],
        },
      ]);

      const result = await service.calculateFriendsBalances(callerId);

      // The pending member has no `userId`, so `friendId` resolves to null
      // and the entry is skipped entirely — they still fully appear in
      // calculateGroupBalances, just not in this registered-user-only view.
      expect(result).toHaveLength(0);
    });

    it('mixed group: a registered co-member still appears in Friends even when a pending member shares the same group', async () => {
      const caller = {
        id: 'gm-caller-g5',
        user: { id: callerId, displayName: 'Caller', email: 'caller@x.com' },
      };
      const registeredFriend = {
        id: 'gm-friend-g5',
        user: {
          id: 'user-friend-2',
          displayName: 'Friend Two',
          email: 'friend2@x.com',
        },
      };
      const pending = {
        id: 'gm-pending-g5',
        contact: { displayName: 'Pending Guy', email: 'pending@x.com' },
      };

      setupGroups([
        {
          id: 'g5',
          currency: 'USD',
          members: [caller, registeredFriend, pending],
          // Caller paid 90, split equally three ways (30 each).
          expenses: [
            {
              id: 'g5-exp-1',
              currency: 'USD',
              amountTotal: 90,
              paidByGroupMember: caller,
            },
          ],
          splits: [
            {
              expense: { id: 'g5-exp-1', currency: 'USD' },
              amountOwed: 30,
              participantGroupMember: caller,
            },
            {
              expense: { id: 'g5-exp-1', currency: 'USD' },
              amountOwed: 30,
              participantGroupMember: registeredFriend,
            },
            {
              expense: { id: 'g5-exp-1', currency: 'USD' },
              amountOwed: 30,
              participantGroupMember: pending,
            },
          ],
        },
      ]);

      const result = await service.calculateFriendsBalances(callerId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        friendId: 'user-friend-2_USD',
        displayName: 'Friend Two (USD)',
        netBalance: 30,
      });
    });

    it('registered-only regression: single group, single currency behaves as a simple two-party ledger', async () => {
      const caller = {
        id: 'gm-caller-g6',
        user: { id: callerId, displayName: 'Caller', email: 'caller@x.com' },
      };
      const friend = {
        id: 'gm-friend-g6',
        user: {
          id: 'user-friend-3',
          displayName: 'Friend Three',
          email: 'friend3@x.com',
        },
      };

      setupGroups([
        {
          id: 'g6',
          currency: 'USD',
          members: [caller, friend],
          expenses: [
            {
              id: 'g6-exp-1',
              currency: 'USD',
              amountTotal: 100,
              paidByGroupMember: caller,
            },
          ],
          splits: [
            {
              expense: { id: 'g6-exp-1', currency: 'USD' },
              amountOwed: 50,
              participantGroupMember: caller,
            },
            {
              expense: { id: 'g6-exp-1', currency: 'USD' },
              amountOwed: 50,
              participantGroupMember: friend,
            },
          ],
        },
      ]);

      const result = await service.calculateFriendsBalances(callerId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        friendId: 'user-friend-3_USD',
        displayName: 'Friend Three (USD)',
        email: 'friend3@x.com',
        netBalance: 50,
      });
    });

    it('returns an empty list when the caller has no active group memberships', async () => {
      groupMemberRepository.find.mockResolvedValueOnce([]);

      const result = await service.calculateFriendsBalances(callerId);

      expect(result).toEqual([]);
    });
  });

  describe('proposeSettlement', () => {
    it('rejects unsupported currency (JPY) with CURRENCY_UNSUPPORTED', async () => {
      await expect(
        service.proposeSettlement('caller-id', 'group-id', {
          toUserId: 'target-id',
          amount: 10,
          currency: 'JPY',
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: 'CURRENCY_UNSUPPORTED',
        }),
      });
    });

    it('should throw ForbiddenException if caller is not an active member', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.proposeSettlement('caller-id', 'group-id', {
          toUserId: 'target-id',
          amount: 10,
          currency: 'USD',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException if recipient is not in group', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);
      groupRepository.findOne.mockResolvedValueOnce({ id: 'group-id' } as any);
      groupMemberRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.proposeSettlement('caller-id', 'group-id', {
          toUserId: 'target-id',
          amount: 10,
          currency: 'USD',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully propose settlement', async () => {
      const mockCaller = {
        id: 'caller-member',
        user: { id: 'caller-id' },
      } as any;
      const mockRecipient = {
        id: 'recipient-member',
        user: { id: 'recipient-id' },
      } as any;

      groupMemberRepository.findOne.mockResolvedValueOnce(mockCaller);
      groupRepository.findOne.mockResolvedValueOnce({ id: 'group-id' } as any);
      groupMemberRepository.findOne.mockResolvedValueOnce(mockRecipient);

      settlementRepository.create.mockImplementation((data) => data as any);
      settlementRepository.save.mockImplementationOnce(
        async (data) =>
          ({
            ...data,
            id: 'settlement-id',
            version: 1,
          }) as any,
      );

      const result = await service.proposeSettlement('caller-id', 'group-id', {
        toUserId: 'recipient-id',
        amount: 100,
        currency: 'USD',
        note: 'lunch',
      });

      expect(settlementRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 100,
          currency: 'USD',
          note: 'lunch',
          // Frozen group-ledger identity rule: even a fully registered-to-
          // registered settlement resolves both parties via GroupMember —
          // fromUser/toUser are never written for new rows.
          fromGroupMember: mockCaller,
          toGroupMember: mockRecipient,
        }),
      );
      expect(settlementRepository.create).toHaveBeenCalledWith(
        expect.not.objectContaining({
          fromUser: expect.anything(),
          toUser: expect.anything(),
        }),
      );
      expect(settlementVersionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'proposed',
          settlement: expect.any(Object),
          snapshot: expect.objectContaining({ currency: 'USD' }),
        }),
      );
      expect(settlementVersionRepository.save).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    });

    it('proposes a settlement with a pending (Contact-backed) recipient via toGroupMemberId', async () => {
      const mockCaller = {
        id: 'caller-member',
        user: { id: 'caller-id' },
      } as any;
      const pendingRecipient = {
        id: 'pending-member-id',
        user: undefined,
        contact: { id: 'contact-rahul' },
      } as any;

      groupMemberRepository.findOne.mockResolvedValueOnce(mockCaller);
      groupRepository.findOne.mockResolvedValueOnce({ id: 'group-id' } as any);
      groupMemberRepository.findOne.mockResolvedValueOnce(pendingRecipient);

      settlementRepository.create.mockImplementation((data) => data as any);
      settlementRepository.save.mockImplementationOnce(
        async (data) => ({ ...data, id: 'settlement-id-2', version: 1 }) as any,
      );

      const result = await service.proposeSettlement('caller-id', 'group-id', {
        toGroupMemberId: 'pending-member-id',
        amount: 50,
        currency: 'USD',
      });

      // Frozen group-ledger identity rule: both parties always resolve via
      // GroupMember, never User — including the caller, who is always a
      // real account but is referenced by their GroupMember row here.
      expect(settlementRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fromGroupMember: mockCaller,
          toGroupMember: pendingRecipient,
        }),
      );
      expect(settlementRepository.create).toHaveBeenCalledWith(
        expect.not.objectContaining({
          fromUser: expect.anything(),
          toUser: expect.anything(),
        }),
      );
      expect(result).toBeDefined();
    });

    it('rejects proposing a settlement with oneself', async () => {
      const mockCaller = {
        id: 'caller-member',
        user: { id: 'caller-id' },
      } as any;
      groupMemberRepository.findOne.mockResolvedValueOnce(mockCaller);
      groupRepository.findOne.mockResolvedValueOnce({ id: 'group-id' } as any);
      groupMemberRepository.findOne.mockResolvedValueOnce(mockCaller);

      await expect(
        service.proposeSettlement('caller-id', 'group-id', {
          toGroupMemberId: 'caller-member',
          amount: 10,
          currency: 'USD',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('recordPayment', () => {
    const group = { id: 'group-id', currency: 'USD' } as any;
    const contactMember = {
      id: 'contact-member',
      user: null,
      contact: { id: 'contact-1' },
      role: 'member',
    } as any;
    const callerMember = {
      id: 'caller-member',
      user: { id: 'caller-id' },
      role: 'member',
    } as any;

    const wireSave = () => {
      settlementRepository.create.mockImplementation((d) => d as any);
      settlementRepository.save.mockImplementation(
        async (d) => ({ ...d, id: 'settlement-id', version: 1 }) as any,
      );
    };

    it('records a one-step CONFIRMED payment when a Contact owes the caller (Contact=from, caller=to)', async () => {
      groupMemberRepository.findOne
        .mockResolvedValueOnce(callerMember) // caller
        .mockResolvedValueOnce(contactMember) // fromMember (Contact/debtor)
        .mockResolvedValueOnce(callerMember); // toMember (caller/creditor)
      groupRepository.findOne.mockResolvedValueOnce(group);
      wireSave();

      const result = await service.recordPayment('caller-id', 'group-id', {
        fromMemberId: 'contact-member',
        toMemberId: 'caller-member',
        amount: 40,
        currency: 'USD',
      });

      expect(settlementRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'confirmed',
          fromGroupMember: contactMember,
          toGroupMember: callerMember,
          amount: 40,
          currency: 'USD',
          recordedByUser: callerMember.user,
        }),
      );
      expect(settlementVersionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'confirmed' }),
      );
      expect((result as any).status).toBe('confirmed');
    });

    it('records a one-step CONFIRMED payment when the caller owes a Contact (caller=from, Contact=to)', async () => {
      groupMemberRepository.findOne
        .mockResolvedValueOnce(callerMember) // caller
        .mockResolvedValueOnce(callerMember) // fromMember (caller/debtor)
        .mockResolvedValueOnce(contactMember); // toMember (Contact/creditor)
      groupRepository.findOne.mockResolvedValueOnce(group);
      wireSave();

      await service.recordPayment('caller-id', 'group-id', {
        fromMemberId: 'caller-member',
        toMemberId: 'contact-member',
        amount: 25,
        currency: 'USD',
      });

      expect(settlementRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'confirmed',
          fromGroupMember: callerMember,
          toGroupMember: contactMember,
        }),
      );
    });

    it('rejects (SETTLE_USE_PROPOSE_ACCEPT) when both parties are registered users', async () => {
      const otherRegistered = {
        id: 'other-member',
        user: { id: 'other-id' },
        role: 'member',
      } as any;
      groupMemberRepository.findOne
        .mockResolvedValueOnce(callerMember) // caller
        .mockResolvedValueOnce(callerMember) // from (registered)
        .mockResolvedValueOnce(otherRegistered); // to (registered)
      groupRepository.findOne.mockResolvedValueOnce(group);

      const err = await service
        .recordPayment('caller-id', 'group-id', {
          fromMemberId: 'caller-member',
          toMemberId: 'other-member',
          amount: 10,
          currency: 'USD',
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({
        errorCode: 'SETTLE_USE_PROPOSE_ACCEPT',
      });
      expect(settlementRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a non-party, non-admin caller with ForbiddenException', async () => {
      const fromM = {
        id: 'm1',
        user: { id: 'u1' },
        role: 'member',
      } as any;
      const toM = {
        id: 'm2',
        user: null,
        contact: { id: 'c2' },
        role: 'member',
      } as any;
      groupMemberRepository.findOne
        .mockResolvedValueOnce(callerMember) // caller (member, not a party)
        .mockResolvedValueOnce(fromM)
        .mockResolvedValueOnce(toM);
      groupRepository.findOne.mockResolvedValueOnce(group);

      await expect(
        service.recordPayment('caller-id', 'group-id', {
          fromMemberId: 'm1',
          toMemberId: 'm2',
          amount: 10,
          currency: 'USD',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(settlementRepository.save).not.toHaveBeenCalled();
    });

    it('lets a group ADMIN record a payment between a registered member and a Contact', async () => {
      const admin = {
        id: 'admin-member',
        user: { id: 'admin-id' },
        role: 'admin',
      } as any;
      const registeredParty = {
        id: 'reg-member',
        user: { id: 'reg-id' },
        role: 'member',
      } as any;
      groupMemberRepository.findOne
        .mockResolvedValueOnce(admin) // caller (admin, not a party)
        .mockResolvedValueOnce(registeredParty) // from
        .mockResolvedValueOnce(contactMember); // to (Contact)
      groupRepository.findOne.mockResolvedValueOnce(group);
      wireSave();

      await service.recordPayment('admin-id', 'group-id', {
        fromMemberId: 'reg-member',
        toMemberId: 'contact-member',
        amount: 15,
        currency: 'USD',
      });

      expect(settlementRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'confirmed',
          recordedByUser: admin.user,
        }),
      );
    });

    it('rejects a currency that does not match the group base currency', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce(callerMember);
      groupRepository.findOne.mockResolvedValueOnce(group);

      await expect(
        service.recordPayment('caller-id', 'group-id', {
          fromMemberId: 'contact-member',
          toMemberId: 'caller-member',
          amount: 10,
          currency: 'EUR',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('acquires a FOR SHARE member lock inside the write transaction (serializes vs member removal)', async () => {
      groupMemberRepository.findOne
        .mockResolvedValueOnce(callerMember)
        .mockResolvedValueOnce(contactMember)
        .mockResolvedValueOnce(callerMember);
      groupRepository.findOne.mockResolvedValueOnce(group);
      wireSave();

      await service.recordPayment('caller-id', 'group-id', {
        fromMemberId: 'contact-member',
        toMemberId: 'caller-member',
        amount: 40,
        currency: 'USD',
      });

      expect(managerQuery).toHaveBeenCalledWith(
        expect.stringContaining('FOR SHARE'),
        ['group-id'],
      );
    });
  });

  describe('listSettlements', () => {
    it('should throw ForbiddenException if caller is not active', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.listSettlements('caller-id', 'group-id', 1, 20),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return paginated list of settlements', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValueOnce(2),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest
          .fn()
          .mockResolvedValueOnce([{ id: 's-1' }, { id: 's-2' }]),
      };
      settlementRepository.createQueryBuilder.mockReturnValueOnce(
        mockQueryBuilder as any,
      );

      const result = await service.listSettlements(
        'caller-id',
        'group-id',
        1,
        10,
      );

      expect(result).toBeDefined();
      expect(result.data).toHaveLength(2);
      expect(result.meta.totalItems).toBe(2);
    });
  });

  describe('updateSettlement', () => {
    it('should throw ForbiddenException if caller is not active', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.updateSettlement('caller-id', 'group-id', 'settlement-id', {
          status: 'confirmed',
          version: 1,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if settlement is not found', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);
      settlementRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.updateSettlement('caller-id', 'group-id', 'settlement-id', {
          status: 'confirmed',
          version: 1,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw PreconditionFailedException on version conflict', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);
      settlementRepository.findOne.mockResolvedValueOnce({
        id: 'settlement-id',
        version: 2,
      } as any);

      await expect(
        service.updateSettlement('caller-id', 'group-id', 'settlement-id', {
          status: 'confirmed',
          version: 1,
        }),
      ).rejects.toThrow(PreconditionFailedException);
    });

    it('allows the debtor to confirm on behalf of a pending (Contact-backed) creditor, who has no account to confirm with', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);

      const mockSettlement = {
        id: 'settlement-id',
        version: 1,
        fromUser: { id: 'debtor-id' },
        toUser: undefined,
        toGroupMember: { id: 'pending-member-id', user: undefined },
        status: 'proposed',
      } as any;
      settlementRepository.findOne.mockResolvedValueOnce(mockSettlement);
      settlementRepository.save.mockResolvedValueOnce(mockSettlement);

      const result = await service.updateSettlement(
        'debtor-id',
        'group-id',
        'settlement-id',
        { status: 'confirmed', version: 1 },
      );

      expect(result.status).toBe('confirmed');
    });

    it('still rejects an unrelated third party from confirming a settlement with a pending creditor', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);

      const mockSettlement = {
        id: 'settlement-id',
        version: 1,
        fromUser: { id: 'debtor-id' },
        toUser: undefined,
        toGroupMember: { id: 'pending-member-id', user: undefined },
        status: 'proposed',
      } as any;
      settlementRepository.findOne.mockResolvedValueOnce(mockSettlement);

      await expect(
        service.updateSettlement(
          'someone-else-id',
          'group-id',
          'settlement-id',
          { status: 'confirmed', version: 1 },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if non-creditor tries to confirm', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);

      const mockSettlement = {
        id: 'settlement-id',
        version: 1,
        fromUser: { id: 'debtor-id' },
        toUser: { id: 'creditor-id' },
      } as any;
      settlementRepository.findOne.mockResolvedValueOnce(mockSettlement);

      await expect(
        service.updateSettlement('debtor-id', 'group-id', 'settlement-id', {
          status: 'confirmed',
          version: 1,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow creditor to confirm receipt', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);

      const mockSettlement = {
        id: 'settlement-id',
        version: 1,
        fromUser: { id: 'debtor-id' },
        toUser: { id: 'creditor-id' },
        status: 'proposed',
      } as any;
      settlementRepository.findOne.mockResolvedValueOnce(mockSettlement);
      settlementRepository.save.mockResolvedValueOnce(mockSettlement);

      const result = await service.updateSettlement(
        'creditor-id',
        'group-id',
        'settlement-id',
        {
          status: 'confirmed',
          settledOn: '2026-06-10',
          version: 1,
        },
      );

      expect(mockSettlement.status).toBe('confirmed');
      expect(mockSettlement.settledOn).toBe('2026-06-10');
      expect(settlementVersionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'confirmed',
          settlement: mockSettlement,
          snapshot: expect.objectContaining({ status: 'confirmed' }),
        }),
      );
      expect(settlementVersionRepository.save).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    });

    it('should throw ForbiddenException if non-party tries to cancel', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);

      const mockSettlement = {
        id: 'settlement-id',
        version: 1,
        fromUser: { id: 'debtor-id' },
        toUser: { id: 'creditor-id' },
      } as any;
      settlementRepository.findOne.mockResolvedValueOnce(mockSettlement);

      await expect(
        service.updateSettlement('other-id', 'group-id', 'settlement-id', {
          status: 'cancelled',
          version: 1,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow debtor to cancel', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);

      const mockSettlement = {
        id: 'settlement-id',
        version: 1,
        fromUser: { id: 'debtor-id' },
        toUser: { id: 'creditor-id' },
        status: 'proposed',
      } as any;
      settlementRepository.findOne.mockResolvedValueOnce(mockSettlement);
      settlementRepository.save.mockResolvedValueOnce(mockSettlement);

      const result = await service.updateSettlement(
        'debtor-id',
        'group-id',
        'settlement-id',
        {
          status: 'cancelled',
          version: 1,
        },
      );

      expect(mockSettlement.status).toBe('cancelled');
      expect(result).toBeDefined();
    });

    it('blocks confirming a proposed settlement when a party has departed', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);
      settlementRepository.findOne.mockResolvedValueOnce({
        id: 'settlement-id',
        version: 1,
        status: 'proposed',
        fromGroupMember: { id: 'member-a' },
        toGroupMember: { id: 'member-b' },
        fromUser: { id: 'debtor-id' },
        toUser: { id: 'creditor-id' },
      } as any);
      groupMemberRepository.find.mockResolvedValue([
        {
          id: 'member-a',
          joinStatus: 'left',
          user: { id: 'debtor-id', email: 'debtor@example.com' },
        },
      ] as any);

      await expect(
        service.updateSettlement('creditor-id', 'group-id', 'settlement-id', {
          status: 'confirmed',
          version: 1,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('blocks cancelling a confirmed settlement when a party has departed', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);
      settlementRepository.findOne.mockResolvedValueOnce({
        id: 'settlement-id',
        version: 1,
        status: 'confirmed',
        fromGroupMember: { id: 'member-a' },
        toGroupMember: { id: 'member-b' },
        fromUser: { id: 'debtor-id' },
        toUser: { id: 'creditor-id' },
      } as any);
      groupMemberRepository.find.mockResolvedValue([
        {
          id: 'member-b',
          joinStatus: 'removed',
          user: { id: 'creditor-id', email: 'creditor@example.com' },
        },
      ] as any);

      await expect(
        service.updateSettlement('debtor-id', 'group-id', 'settlement-id', {
          status: 'cancelled',
          version: 1,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows cancelling a proposed settlement when a party has departed', async () => {
      groupMemberRepository.findOne.mockResolvedValueOnce({
        id: 'caller-member',
      } as any);

      const mockSettlement = {
        id: 'settlement-id',
        version: 1,
        status: 'proposed',
        fromGroupMember: { id: 'member-a' },
        toGroupMember: { id: 'member-b' },
        fromUser: { id: 'debtor-id' },
        toUser: { id: 'creditor-id' },
      } as any;
      settlementRepository.findOne.mockResolvedValueOnce(mockSettlement);
      groupMemberRepository.find.mockResolvedValue([
        {
          id: 'member-a',
          joinStatus: 'left',
          user: { id: 'debtor-id', email: 'debtor@example.com' },
        },
      ] as any);
      settlementRepository.save.mockResolvedValueOnce(mockSettlement);

      const result = await service.updateSettlement(
        'debtor-id',
        'group-id',
        'settlement-id',
        {
          status: 'cancelled',
          version: 1,
        },
      );

      expect(result.status).toBe('cancelled');
    });
  });
});
