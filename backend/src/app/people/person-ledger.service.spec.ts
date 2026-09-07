import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import {
  DirectLedgerEntry,
  Expense,
  ExpensePayment,
  ExpenseSplit,
  Group,
  GroupMember,
  Settlement,
  User,
} from '@finmate/data-models';
import { PersonLedgerService } from './person-ledger.service';

/** Minimal user stub the way userRepository.findOne resolves it. */
const userStub = (id: string) => ({
  id,
  displayName: id,
  email: `${id}@example.com`,
});

describe('PersonLedgerService', () => {
  let service: PersonLedgerService;
  let groupMemberRepo: { find: jest.Mock };
  let expenseRepo: { find: jest.Mock };
  let splitRepo: { find: jest.Mock };
  let paymentRepo: { find: jest.Mock };
  let settlementRepo: { find: jest.Mock };
  let directRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softRemove: jest.Mock;
  };
  let userRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    groupMemberRepo = { find: jest.fn().mockResolvedValue([]) };
    expenseRepo = { find: jest.fn().mockResolvedValue([]) };
    splitRepo = { find: jest.fn().mockResolvedValue([]) };
    paymentRepo = { find: jest.fn().mockResolvedValue([]) };
    settlementRepo = { find: jest.fn().mockResolvedValue([]) };
    directRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((d) => d),
      save: jest.fn(async (d) => ({ ...d, id: 'new-entry' })),
      softRemove: jest.fn(async (d) => d),
    };
    userRepo = {
      findOne: jest.fn(async ({ where }) => userStub(where.id)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonLedgerService,
        { provide: getRepositoryToken(GroupMember), useValue: groupMemberRepo },
        { provide: getRepositoryToken(Expense), useValue: expenseRepo },
        { provide: getRepositoryToken(ExpenseSplit), useValue: splitRepo },
        { provide: getRepositoryToken(ExpensePayment), useValue: paymentRepo },
        { provide: getRepositoryToken(Settlement), useValue: settlementRepo },
        {
          provide: getRepositoryToken(DirectLedgerEntry),
          useValue: directRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get(PersonLedgerService);
  });

  describe('direct transactions', () => {
    it('lend normalises so the counterparty owes the caller', async () => {
      await service.createDirectTransaction('U1', 'U2', {
        entryType: 'lend',
        amount: 500,
        currency: 'USD',
        occurredOn: '2026-08-01',
      });
      const saved = directRepo.create.mock.calls[0][0];
      expect(saved.fromUser.id).toBe('U2'); // debtor
      expect(saved.toUser.id).toBe('U1'); // creditor (caller is owed)
      expect(saved.entryType).toBe('lend');
    });

    it('borrow normalises so the caller owes the counterparty', async () => {
      await service.createDirectTransaction('U1', 'U2', {
        entryType: 'borrow',
        amount: 300,
        currency: 'USD',
        occurredOn: '2026-08-01',
      });
      const saved = directRepo.create.mock.calls[0][0];
      expect(saved.fromUser.id).toBe('U1');
      expect(saved.toUser.id).toBe('U2');
    });

    it('rejects a transaction with oneself', async () => {
      await expect(
        service.createDirectTransaction('U1', 'U1', {
          entryType: 'lend',
          amount: 10,
          currency: 'USD',
          occurredOn: '2026-08-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('overview aggregation (direct-only)', () => {
    beforeEach(() => {
      // Two lends to the caller (U2 owes U1 800) and one borrow (U1 owes U3 200).
      directRepo.find.mockResolvedValue([
        {
          id: 'd1',
          fromUser: userStub('U2'),
          toUser: userStub('U1'),
          entryType: 'lend',
          amount: '500',
          currency: 'USD',
          occurredOn: '2026-08-01',
        },
        {
          id: 'd2',
          fromUser: userStub('U2'),
          toUser: userStub('U1'),
          entryType: 'lend',
          amount: '300',
          currency: 'USD',
          occurredOn: '2026-08-03',
        },
        {
          id: 'd3',
          fromUser: userStub('U1'),
          toUser: userStub('U3'),
          entryType: 'borrow',
          amount: '200',
          currency: 'USD',
          occurredOn: '2026-08-04',
        },
      ]);
    });

    it('computes totals, directions, and outstanding-first ordering', async () => {
      const overview = await service.getOverview('U1');
      expect(overview.totalYouAreOwed).toBe(800);
      expect(overview.totalYouOwe).toBe(200);
      expect(overview.people[0].counterpartyUserId).toBe('U2');
      expect(overview.people[0].netBalance).toBe(800);
      expect(overview.people[0].direction).toBe('owes_you');
      const u3 = overview.people.find((p) => p.counterpartyUserId === 'U3');
      expect(u3?.netBalance).toBe(-200);
      expect(u3?.direction).toBe('you_owe');
    });

    it('honours the limit for the dashboard widget', async () => {
      const overview = await service.getOverview('U1', 1);
      expect(overview.people).toHaveLength(1);
      expect(overview.people[0].counterpartyUserId).toBe('U2');
    });

    it('excludes household groups from the group aggregation', async () => {
      await service.getOverview('U1');
      const whereArg = groupMemberRepo.find.mock.calls[0][0].where;
      expect(whereArg.group.groupType).toBe('normal');
    });
  });

  describe('settlement ("Return")', () => {
    beforeEach(() => {
      // U2 owes the caller 400 (net +400).
      directRepo.find.mockResolvedValue([
        {
          id: 'd1',
          fromUser: userStub('U2'),
          toUser: userStub('U1'),
          entryType: 'lend',
          amount: '400',
          currency: 'USD',
          occurredOn: '2026-08-01',
        },
      ]);
    });

    it('rejects over-settlement beyond the outstanding balance', async () => {
      await expect(
        service.createDirectSettlement('U1', 'U2', {
          amount: 500,
          currency: 'USD',
          occurredOn: '2026-08-10',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('records a partial return in the correct direction', async () => {
      await service.createDirectSettlement('U1', 'U2', {
        amount: 200,
        currency: 'USD',
        occurredOn: '2026-08-10',
      });
      const saved = directRepo.create.mock.calls[0][0];
      // They owe you → they return money → from = counterparty, to = caller.
      expect(saved.entryType).toBe('settlement');
      expect(saved.fromUser.id).toBe('U2');
      expect(saved.toUser.id).toBe('U1');
    });

    it('rejects settling when nothing is outstanding', async () => {
      directRepo.find.mockResolvedValue([]);
      await expect(
        service.createDirectSettlement('U1', 'U2', {
          amount: 50,
          currency: 'USD',
          occurredOn: '2026-08-10',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('group per-expense pairwise obligations', () => {
    beforeEach(() => {
      groupMemberRepo.find.mockResolvedValue([
        { id: 'M1', group: { id: 'G1', name: 'Trip', groupType: 'normal' } },
      ]);
      // ₹6 expense, equal 3-way, paid entirely by caller (M1/U1).
      expenseRepo.find.mockResolvedValue([
        {
          id: 'E1',
          currency: 'USD',
          transactionType: 'expense',
          expenseDate: '2026-08-02',
          title: 'cipher-title',
          amountTotal: '6',
        },
      ]);
      paymentRepo.find.mockResolvedValue([
        {
          expense: { id: 'E1' },
          paidByGroupMember: { id: 'M1', user: userStub('U1') },
          amount: '6',
        },
      ]);
      splitRepo.find.mockResolvedValue([
        {
          expense: { id: 'E1' },
          participantGroupMember: { id: 'M1', user: userStub('U1') },
          amountOwed: '2',
        },
        {
          expense: { id: 'E1' },
          participantGroupMember: { id: 'M2', user: userStub('U2') },
          amountOwed: '2',
        },
        {
          expense: { id: 'E1' },
          participantGroupMember: { id: 'M3', user: userStub('U3') },
          amountOwed: '2',
        },
      ]);
    });

    it('derives that each other participant owes the payer their share', async () => {
      const detail = await service.getPersonDetail('U1', 'U2');
      expect(detail.netBalance).toBe(2);
      expect(detail.direction).toBe('owes_you');
      expect(detail.history).toHaveLength(1);
      expect(detail.history[0].source).toBe('group_expense');
      expect(detail.history[0].expenseId).toBe('E1');
      expect(detail.history[0].groupName).toBe('Trip');
      expect(detail.history[0].amount).toBe(2);
    });
  });

  describe('multiple payers on one expense (§7)', () => {
    beforeEach(() => {
      // Total 10; shares A=2 B=3 C=5; A paid 4, B paid 6, C paid 0.
      // Expected: C owes A 2 and C owes B 3.  Caller = A (M1/U1).
      groupMemberRepo.find.mockResolvedValue([
        { id: 'M1', group: { id: 'G1', name: 'Flat', groupType: 'normal' } },
      ]);
      expenseRepo.find.mockResolvedValue([
        {
          id: 'E1',
          currency: 'USD',
          transactionType: 'expense',
          expenseDate: '2026-08-05',
          title: 'cipher',
          amountTotal: '10',
        },
      ]);
      paymentRepo.find.mockResolvedValue([
        {
          expense: { id: 'E1' },
          paidByGroupMember: { id: 'M1', user: userStub('U1') },
          amount: '4',
        },
        {
          expense: { id: 'E1' },
          paidByGroupMember: { id: 'M2', user: userStub('U2') },
          amount: '6',
        },
      ]);
      splitRepo.find.mockResolvedValue([
        {
          expense: { id: 'E1' },
          participantGroupMember: { id: 'M1', user: userStub('U1') },
          amountOwed: '2',
        },
        {
          expense: { id: 'E1' },
          participantGroupMember: { id: 'M2', user: userStub('U2') },
          amountOwed: '3',
        },
        {
          expense: { id: 'E1' },
          participantGroupMember: { id: 'M3', user: userStub('U3') },
          amountOwed: '5',
        },
      ]);
    });

    it('attributes each payment so C owes A the overpaid remainder', async () => {
      const cToA = await service.getPersonDetail('U1', 'U3');
      expect(cToA.netBalance).toBe(2); // C owes A 2
      expect(cToA.direction).toBe('owes_you');

      // A and B both overpaid — no obligation between them.
      const aToB = await service.getPersonDetail('U1', 'U2');
      expect(aToB.netBalance).toBe(0);
    });
  });

  // ── P2P-1 — Contact-capable direct ledger (internal assembly) ─────────────
  // Proves DirectLedgerEntry can be assembled for a non-member Contact under an
  // opaque `contact:<id>` key, that the same Contact reuses one identity, and
  // that existing User↔User external behaviour is unchanged. Contact rows are
  // NOT yet surfaced through the User API (deferred to P2P-3).
  describe('P2P-1 Contact-capable ledger', () => {
    const contactStub = (id: string, displayName = id) => ({
      id,
      displayName,
      email: `${id}@contact.example`, // must never leak into the ledger
      phoneNumber: '+10000000000',
    });
    const rd2 = (n: number) => Math.round(n * 100) / 100;
    // White-box: buildLedger is private; assemble the internal ledger directly.
    const buildLedger = (callerId: string, only?: string) =>
      (
        service as unknown as {
          buildLedger: (
            c: string,
            o?: string,
          ) => Promise<Map<string, Record<string, any>>>;
        }
      ).buildLedger(callerId, only);

    it('assembles a User→Contact lend under contact:<id> (caller is owed); never leaks email', async () => {
      directRepo.find.mockResolvedValue([
        {
          id: 'x1',
          fromUser: null,
          fromContact: contactStub('C1', 'Priya'),
          toUser: userStub('U1'),
          toContact: null,
          entryType: 'lend',
          amount: '500',
          currency: 'USD',
          occurredOn: '2026-08-01',
        },
      ]);
      const ledger = await buildLedger('U1');
      expect([...ledger.keys()]).toEqual(['contact:C1']);
      const cp = ledger.get('contact:C1')!;
      expect(cp.kind).toBe('contact');
      expect(cp.contactId).toBe('C1');
      expect(cp.userId).toBeUndefined();
      expect(cp.displayName).toBe('Priya');
      expect(cp.email).toBe(''); // privacy — Contact email/phone never surfaced
      expect(rd2(cp.byCurrency.get('USD').directLending)).toBe(500);
    });

    it('assembles a Contact→User borrow under contact:<id> (caller owes)', async () => {
      directRepo.find.mockResolvedValue([
        {
          id: 'x2',
          fromUser: userStub('U1'),
          fromContact: null,
          toUser: null,
          toContact: contactStub('C1'),
          entryType: 'borrow',
          amount: '300',
          currency: 'USD',
          occurredOn: '2026-08-02',
        },
      ]);
      const ledger = await buildLedger('U1');
      expect(
        rd2(ledger.get('contact:C1')!.byCurrency.get('USD').directLending),
      ).toBe(-300);
    });

    it('reuses the SAME contact:<id> key across three entries — no identity duplication', async () => {
      directRepo.find.mockResolvedValue([
        {
          id: 'e1',
          fromContact: contactStub('C1'),
          toUser: userStub('U1'),
          entryType: 'lend',
          amount: '500',
          currency: 'USD',
          occurredOn: '2026-08-01',
        },
        {
          id: 'e2',
          fromUser: userStub('U1'),
          toContact: contactStub('C1'),
          entryType: 'borrow',
          amount: '300',
          currency: 'USD',
          occurredOn: '2026-08-02',
        },
        {
          id: 'e3',
          fromContact: contactStub('C1'),
          toUser: userStub('U1'),
          entryType: 'lend',
          amount: '700',
          currency: 'USD',
          occurredOn: '2026-08-03',
        },
      ]);
      const ledger = await buildLedger('U1');
      const contactKeys = [...ledger.keys()].filter((k) =>
        k.startsWith('contact:'),
      );
      expect(contactKeys).toEqual(['contact:C1']); // ONE identity, not three
      const bucket = ledger.get('contact:C1')!.byCurrency.get('USD');
      expect(rd2(bucket.directLending)).toBe(900); // +500 -300 +700
      expect(bucket.history).toHaveLength(3);
    });

    it('buckets a Contact counterparty independently per currency', async () => {
      directRepo.find.mockResolvedValue([
        {
          id: 'm1',
          fromContact: contactStub('C1'),
          toUser: userStub('U1'),
          entryType: 'lend',
          amount: '500',
          currency: 'USD',
          occurredOn: '2026-08-01',
        },
        {
          id: 'm2',
          fromContact: contactStub('C1'),
          toUser: userStub('U1'),
          entryType: 'lend',
          amount: '400',
          currency: 'INR',
          occurredOn: '2026-08-01',
        },
      ]);
      const cp = (await buildLedger('U1')).get('contact:C1')!;
      expect(rd2(cp.byCurrency.get('USD').directLending)).toBe(500);
      expect(rd2(cp.byCurrency.get('INR').directLending)).toBe(400);
    });

    it('nets a Contact relationship to zero when fully offset', async () => {
      directRepo.find.mockResolvedValue([
        {
          id: 'z1',
          fromContact: contactStub('C1'),
          toUser: userStub('U1'),
          entryType: 'lend',
          amount: '500',
          currency: 'USD',
          occurredOn: '2026-08-01',
        },
        {
          id: 'z2',
          fromUser: userStub('U1'),
          toContact: contactStub('C1'),
          entryType: 'borrow',
          amount: '500',
          currency: 'USD',
          occurredOn: '2026-08-02',
        },
      ]);
      const cp = (await buildLedger('U1')).get('contact:C1')!;
      expect(rd2(cp.byCurrency.get('USD').directLending)).toBe(0);
    });

    it('round2 collapses floating-point drift for a Contact net (0.1 + 0.2 = 0.3)', async () => {
      directRepo.find.mockResolvedValue([
        {
          id: 'f1',
          fromContact: contactStub('C1'),
          toUser: userStub('U1'),
          entryType: 'lend',
          amount: '0.1',
          currency: 'USD',
          occurredOn: '2026-08-01',
        },
        {
          id: 'f2',
          fromContact: contactStub('C1'),
          toUser: userStub('U1'),
          entryType: 'lend',
          amount: '0.2',
          currency: 'USD',
          occurredOn: '2026-08-02',
        },
      ]);
      const cp = (await buildLedger('U1')).get('contact:C1')!;
      expect(rd2(cp.byCurrency.get('USD').directLending)).toBe(0.3);
    });

    it('PARITY: User↔User still uses a user:<id> internal key and the external overview still returns the raw counterpartyUserId', async () => {
      directRepo.find.mockResolvedValue([
        {
          id: 'p1',
          fromUser: userStub('U2'),
          toUser: userStub('U1'),
          entryType: 'lend',
          amount: '500',
          currency: 'USD',
          occurredOn: '2026-08-01',
        },
      ]);
      const ledger = await buildLedger('U1');
      expect([...ledger.keys()]).toEqual(['user:U2']); // internal key
      const res = await service.getOverview('U1');
      expect(res.people[0].counterpartyUserId).toBe('U2'); // external shape unchanged
      expect(res.people[0].netBalance).toBe(500);
    });

    it('does NOT surface Contact counterparties through the User overview yet (deferred to P2P-3)', async () => {
      directRepo.find.mockResolvedValue([
        {
          id: 'c1',
          fromContact: contactStub('C1'),
          toUser: userStub('U1'),
          entryType: 'lend',
          amount: '500',
          currency: 'USD',
          occurredOn: '2026-08-01',
        },
      ]);
      const res = await service.getOverview('U1');
      expect(res.people).toHaveLength(0);
      expect(res.totalYouAreOwed).toBe(0);
    });
  });
});
