import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import {
  Contact,
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
import { ContactsService } from '../contacts/contacts.service';

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
  let contactRepo: { findOne: jest.Mock };
  let contactsService: { resolveMergeRedirect: jest.Mock };
  /** In-memory contacts store the mocked repo/resolver read from. */
  let contacts: Record<string, any>;

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

    contacts = {};
    contactRepo = {
      findOne: jest.fn(async ({ where }) => contacts[where.id] ?? null),
    };
    // Faithful stand-in for ContactsService.resolveMergeRedirect: follows
    // `mergedIntoContact` through archived rows to the terminal, cycle-guarded.
    contactsService = {
      resolveMergeRedirect: jest.fn(async (c: any) => {
        let cur = c;
        const seen = new Set<string>([cur.id]);
        while (cur.status === 'archived' && cur.mergedIntoContact) {
          const next = contacts[cur.mergedIntoContact.id];
          if (!next || seen.has(next.id)) break;
          cur = next;
          seen.add(cur.id);
        }
        return cur;
      }),
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
        { provide: getRepositoryToken(Contact), useValue: contactRepo },
        { provide: ContactsService, useValue: contactsService },
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
    // Seeds the read-time resolution store (P2P-2) so displayName resolves from
    // the Contact record, then returns the shallow relation the entry carries.
    const contactStub = (id: string, displayName = id) => {
      contacts[id] = { id, status: 'pending', displayName };
      return {
        id,
        displayName,
        email: `${id}@contact.example`, // must never leak into the ledger
        phoneNumber: '+10000000000',
      };
    };
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

  // ── P2P-2 — read-time Contact claim + merge resolution ────────────────────
  // Historical Contact-backed rows are never rewritten; ledger assembly folds a
  // claimed Contact to its user:<id> identity and a merged Contact to its
  // terminal survivor, collapsing the same human into ONE ledger identity.
  describe('P2P-2 claim + merge read-time resolution', () => {
    const rd2 = (n: number) => Math.round(n * 100) / 100;
    const buildLedger = (callerId: string, only?: string) =>
      (
        service as unknown as {
          buildLedger: (
            c: string,
            o?: string,
          ) => Promise<Map<string, Record<string, any>>>;
        }
      ).buildLedger(callerId, only);
    const lendFromContact = (
      id: string,
      contactId: string,
      amount: string,
    ) => ({
      id,
      fromContact: { id: contactId },
      toUser: userStub('U1'),
      entryType: 'lend',
      amount,
      currency: 'USD',
      occurredOn: '2026-08-01',
    });

    it('TEST 1 — unclaimed Contact keeps a contact:<id> identity', async () => {
      contacts['C1'] = { id: 'C1', status: 'pending', displayName: 'Priya' };
      directRepo.find.mockResolvedValue([lendFromContact('d1', 'C1', '500')]);
      const ledger = await buildLedger('U1');
      expect([...ledger.keys()]).toEqual(['contact:C1']);
      expect(
        rd2(ledger.get('contact:C1')!.byCurrency.get('USD').directLending),
      ).toBe(500);
    });

    it('TEST 2 — claimed Contact resolves to user:<id> and never mutates the row', async () => {
      contacts['C1'] = {
        id: 'C1',
        status: 'claimed',
        displayName: 'Priya',
        claimedByUser: { id: 'U9', displayName: 'Priya R', email: 'p@x.com' },
      };
      directRepo.find.mockResolvedValue([lendFromContact('d1', 'C1', '500')]);
      const ledger = await buildLedger('U1');
      expect([...ledger.keys()]).toEqual(['user:U9']);
      expect(directRepo.save).not.toHaveBeenCalled();
      expect(directRepo.softRemove).not.toHaveBeenCalled();
    });

    it('TEST 3 — claim collapses historical Contact + native User history into ONE identity', async () => {
      contacts['C1'] = {
        id: 'C1',
        status: 'claimed',
        claimedByUser: { id: 'U9', displayName: 'Priya', email: 'p@x.com' },
      };
      directRepo.find.mockResolvedValue([
        lendFromContact('c1', 'C1', '500'), // C1 (→U9) owes caller 500
        {
          id: 'u1',
          fromUser: userStub('U9'),
          toUser: userStub('U1'),
          entryType: 'lend',
          amount: '300',
          currency: 'USD',
          occurredOn: '2026-08-02',
        }, // native U9 owes caller 300
      ]);
      const ledger = await buildLedger('U1');
      expect([...ledger.keys()]).toEqual(['user:U9']); // ONE identity, not two
      expect(
        rd2(ledger.get('user:U9')!.byCurrency.get('USD').directLending),
      ).toBe(800);
      // And the public overview shows a single combined person row.
      const res = await service.getOverview('U1');
      expect(res.people).toHaveLength(1);
      expect(res.people[0].counterpartyUserId).toBe('U9');
      expect(res.people[0].netBalance).toBe(800);
    });

    it('TEST 4 — three entries for one claimed Contact resolve to one identity with a single lookup (no N+1)', async () => {
      contacts['C1'] = {
        id: 'C1',
        status: 'claimed',
        claimedByUser: { id: 'U9', displayName: 'Priya', email: 'p@x.com' },
      };
      directRepo.find.mockResolvedValue([
        lendFromContact('e1', 'C1', '500'),
        lendFromContact('e2', 'C1', '300'),
        lendFromContact('e3', 'C1', '700'),
      ]);
      const ledger = await buildLedger('U1');
      expect([...ledger.keys()]).toEqual(['user:U9']);
      expect(
        rd2(ledger.get('user:U9')!.byCurrency.get('USD').directLending),
      ).toBe(1500);
      expect(contactRepo.findOne).toHaveBeenCalledTimes(1); // resolved once, not per row
    });

    it('TEST 5 — merge A→B folds A into terminal Contact B', async () => {
      contacts['A'] = {
        id: 'A',
        status: 'archived',
        displayName: 'A',
        mergedIntoContact: { id: 'B' },
      };
      contacts['B'] = { id: 'B', status: 'pending', displayName: 'B' };
      directRepo.find.mockResolvedValue([
        lendFromContact('a1', 'A', '500'),
        lendFromContact('b1', 'B', '300'),
      ]);
      const ledger = await buildLedger('U1');
      expect([...ledger.keys()]).toEqual(['contact:B']);
      expect(
        rd2(ledger.get('contact:B')!.byCurrency.get('USD').directLending),
      ).toBe(800);
    });

    it('TEST 6 — merge A→B then B claimed folds A to the claimed User', async () => {
      contacts['A'] = {
        id: 'A',
        status: 'archived',
        mergedIntoContact: { id: 'B' },
      };
      contacts['B'] = {
        id: 'B',
        status: 'claimed',
        claimedByUser: { id: 'U9', displayName: 'Priya', email: 'p@x.com' },
      };
      directRepo.find.mockResolvedValue([lendFromContact('a1', 'A', '500')]);
      const ledger = await buildLedger('U1');
      expect([...ledger.keys()]).toEqual(['user:U9']);
    });

    it('TEST 7 — redirect chain A→B→C resolves to terminal Contact C', async () => {
      contacts['A'] = {
        id: 'A',
        status: 'archived',
        mergedIntoContact: { id: 'B' },
      };
      contacts['B'] = {
        id: 'B',
        status: 'archived',
        mergedIntoContact: { id: 'C' },
      };
      contacts['C'] = { id: 'C', status: 'pending', displayName: 'C' };
      directRepo.find.mockResolvedValue([lendFromContact('a1', 'A', '500')]);
      const ledger = await buildLedger('U1');
      expect([...ledger.keys()]).toEqual(['contact:C']);
    });

    it('TEST 8 — redirect chain A→B→C then C claimed resolves to user:<id>', async () => {
      contacts['A'] = {
        id: 'A',
        status: 'archived',
        mergedIntoContact: { id: 'B' },
      };
      contacts['B'] = {
        id: 'B',
        status: 'archived',
        mergedIntoContact: { id: 'C' },
      };
      contacts['C'] = {
        id: 'C',
        status: 'claimed',
        claimedByUser: { id: 'U9', displayName: 'Priya', email: 'p@x.com' },
      };
      directRepo.find.mockResolvedValue([lendFromContact('a1', 'A', '500')]);
      const ledger = await buildLedger('U1');
      expect([...ledger.keys()]).toEqual(['user:U9']);
    });

    it('TEST 9 — immutability: no historical row is written during a ledger read', async () => {
      contacts['C1'] = {
        id: 'C1',
        status: 'claimed',
        claimedByUser: { id: 'U9', displayName: 'Priya', email: 'p@x.com' },
      };
      const entry = lendFromContact('d1', 'C1', '500');
      directRepo.find.mockResolvedValue([entry]);
      await buildLedger('U1');
      expect(directRepo.save).not.toHaveBeenCalled();
      expect(directRepo.softRemove).not.toHaveBeenCalled();
      expect(directRepo.create).not.toHaveBeenCalled();
      // Stored Contact FK on the row is untouched.
      expect(entry.fromContact).toEqual({ id: 'C1' });
    });

    it('TEST 10 — idempotency: repeated reads produce identical results', async () => {
      contacts['C1'] = {
        id: 'C1',
        status: 'claimed',
        claimedByUser: { id: 'U9', displayName: 'Priya', email: 'p@x.com' },
      };
      directRepo.find.mockResolvedValue([lendFromContact('d1', 'C1', '500')]);
      const net = async () =>
        rd2(
          (await buildLedger('U1')).get('user:U9')!.byCurrency.get('USD')
            .directLending,
        );
      expect(await net()).toBe(500);
      expect(await net()).toBe(500);
      expect(await net()).toBe(500);
    });

    it('TEST 11 — a claimed Contact keeps currencies independently bucketed', async () => {
      contacts['C1'] = {
        id: 'C1',
        status: 'claimed',
        claimedByUser: { id: 'U9', displayName: 'Priya', email: 'p@x.com' },
      };
      directRepo.find.mockResolvedValue([
        lendFromContact('u1', 'C1', '500'),
        { ...lendFromContact('i1', 'C1', '400'), currency: 'INR' },
      ]);
      const cp = (await buildLedger('U1')).get('user:U9')!;
      expect(rd2(cp.byCurrency.get('USD').directLending)).toBe(500);
      expect(rd2(cp.byCurrency.get('INR').directLending)).toBe(400);
    });

    it('TEST 12 — claim fold preserves round2 semantics (0.1 + 0.2 = 0.3)', async () => {
      contacts['C1'] = {
        id: 'C1',
        status: 'claimed',
        claimedByUser: { id: 'U9', displayName: 'Priya', email: 'p@x.com' },
      };
      directRepo.find.mockResolvedValue([
        lendFromContact('f1', 'C1', '0.1'),
        lendFromContact('f2', 'C1', '0.2'),
      ]);
      const cp = (await buildLedger('U1')).get('user:U9')!;
      expect(rd2(cp.byCurrency.get('USD').directLending)).toBe(0.3);
    });
  });
});
