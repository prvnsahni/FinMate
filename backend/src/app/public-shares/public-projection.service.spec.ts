import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Expense, GroupMember, PublicShare } from '@finmate/data-models';
import { PublicProjectionService } from './public-projection.service';
import { SettlementsService } from '../settlements/settlements.service';
import { FeatureFlagsService } from '../platform/feature-flags.service';

const TOKEN = 'kQ8mN3pR7sT1vW5xY9zA2bC4dE6fG0hJ_lMoPqRsTuV';
const HASH = createHash('sha256').update(TOKEN).digest('hex');

// Fixtures carry PII we must PROVE never leaks into the projection.
const GROUP = { id: 'grp-secret-id', name: 'Goa Trip', currency: 'INR' };
const members = [
  { id: 'm2', joinedAt: new Date('2026-02-01'), user: { id: 'u2', displayName: 'Bob Real', email: 'bob@x.com' } },
  { id: 'm1', joinedAt: new Date('2026-01-01'), user: { id: 'u1', displayName: 'Alice Real', email: 'alice@x.com' } },
];
const activeShare = () =>
  ({
    id: 'share-id',
    status: 'active',
    expiresAt: null,
    tokenHash: HASH,
    group: { ...GROUP },
    createdByUser: { id: 'creator-user-id' },
  }) as unknown as PublicShare;

describe('PublicProjectionService (PUBLIC-1C)', () => {
  let service: PublicProjectionService;
  let shareRepo: { findOne: jest.Mock };
  let memberRepo: { find: jest.Mock };
  let expenseRepo: { find: jest.Mock; save: jest.Mock };
  let settlements: { calculateGroupBalances: jest.Mock };
  let flags: { isEnabled: jest.Mock };

  beforeEach(async () => {
    shareRepo = { findOne: jest.fn().mockResolvedValue(activeShare()) };
    memberRepo = { find: jest.fn().mockResolvedValue(members) };
    expenseRepo = {
      find: jest.fn().mockResolvedValue([
        {
          expenseDate: '2026-08-01',
          amountTotal: '500',
          currency: 'INR',
          category: 'Food',
          transactionType: 'expense',
          title: 'enc:SECRET_TITLE',
          description: 'enc:SECRET_DESC',
          paidByGroupMember: { id: 'm1' },
          paidByUser: null,
        },
      ]),
      save: jest.fn(),
    };
    settlements = {
      calculateGroupBalances: jest.fn().mockResolvedValue({
        overall: {
          balances: [
            { groupMemberId: 'm1', currency: 'INR' },
            { groupMemberId: 'm2', currency: 'INR' },
          ],
          suggestedSettlements: [
            { fromGroupMemberId: 'm2', toGroupMemberId: 'm1', amount: 500, currency: 'INR' },
          ],
        },
      }),
    };
    flags = { isEnabled: jest.fn().mockReturnValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PublicProjectionService,
        { provide: getRepositoryToken(PublicShare), useValue: shareRepo },
        { provide: getRepositoryToken(GroupMember), useValue: memberRepo },
        { provide: getRepositoryToken(Expense), useValue: expenseRepo },
        { provide: SettlementsService, useValue: settlements },
        { provide: FeatureFlagsService, useValue: flags },
      ],
    }).compile();
    service = module.get(PublicProjectionService);
  });

  // ── HAPPY PATH ──────────────────────────────────────────────────────────────

  it('1. a valid token returns the public projection', async () => {
    const ledger = await service.getPublicLedger(TOKEN);
    expect(ledger.groupName).toBe('Goa Trip');
    expect(ledger.currency).toBe('INR');
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.balanceSummary).toHaveLength(1);
    expect(typeof ledger.generatedAt).toBe('string');
  });

  it('6. looks the share up by sha256(token), not the raw token', async () => {
    await service.getPublicLedger(TOKEN);
    expect(shareRepo.findOne).toHaveBeenCalledWith({
      where: { tokenHash: HASH },
      relations: ['group', 'createdByUser'],
    });
  });

  // ── GENERIC 404 FOR EVERY UNAVAILABLE CASE ──────────────────────────────────

  const expectUnavailable = (p: Promise<unknown>) =>
    expect(p).rejects.toBeInstanceOf(NotFoundException);

  it('2. unknown token → generic 404', async () => {
    shareRepo.findOne.mockResolvedValue(null);
    await expectUnavailable(service.getPublicLedger('nope'));
  });

  it('3. revoked token → generic 404', async () => {
    shareRepo.findOne.mockResolvedValue({ ...activeShare(), status: 'revoked' });
    await expectUnavailable(service.getPublicLedger(TOKEN));
  });

  it('4. expired token → generic 404', async () => {
    shareRepo.findOne.mockResolvedValue({
      ...activeShare(),
      expiresAt: new Date(Date.now() - 1000),
    });
    await expectUnavailable(service.getPublicLedger(TOKEN));
  });

  it('5. deleted group (share.group null) → generic 404', async () => {
    shareRepo.findOne.mockResolvedValue({ ...activeShare(), group: null });
    await expectUnavailable(service.getPublicLedger(TOKEN));
  });

  it('18. inactive creator (calculateGroupBalances throws) → generic 404, no impersonation', async () => {
    settlements.calculateGroupBalances.mockRejectedValue(new Error('not a member'));
    await expectUnavailable(service.getPublicLedger(TOKEN));
    // Never retried with a different user.
    expect(settlements.calculateGroupBalances).toHaveBeenCalledTimes(1);
    expect(settlements.calculateGroupBalances).toHaveBeenCalledWith(
      'creator-user-id',
      GROUP.id,
    );
  });

  it('20. feature flag OFF → generic 404 with NO data access', async () => {
    flags.isEnabled.mockReturnValue(false);
    await expectUnavailable(service.getPublicLedger(TOKEN));
    expect(shareRepo.findOne).not.toHaveBeenCalled();
    expect(settlements.calculateGroupBalances).not.toHaveBeenCalled();
  });

  // ── ALLOWLIST / NO LEAKAGE ──────────────────────────────────────────────────

  it('7/9-17. projection is allowlist-only — no ids/PII/E2EE/token in the payload', async () => {
    const ledger = await service.getPublicLedger(TOKEN);
    const json = JSON.stringify(ledger);
    // No ids of any kind.
    for (const id of ['grp-secret-id', 'creator-user-id', 'm1', 'm2', 'u1', 'u2', 'share-id']) {
      expect(json).not.toContain(id);
    }
    // No real names / emails.
    for (const pii of ['Alice Real', 'Bob Real', 'alice@x.com', 'bob@x.com']) {
      expect(json).not.toContain(pii);
    }
    // No E2EE content / token / hash.
    for (const secret of ['SECRET_TITLE', 'SECRET_DESC', TOKEN, HASH]) {
      expect(json).not.toContain(secret);
    }
    // Top-level + entry + balance shapes are exactly the allowlist.
    expect(Object.keys(ledger).sort()).toEqual(
      ['balanceSummary', 'currency', 'entries', 'generatedAt', 'groupName'],
    );
    expect(Object.keys(ledger.entries[0]).sort()).toEqual(
      ['amount', 'category', 'currency', 'date', 'payerLabel', 'transactionType'],
    );
    expect(Object.keys(ledger.balanceSummary[0]).sort()).toEqual(
      ['amount', 'currency', 'fromLabel', 'toLabel'],
    );
  });

  // ── PSEUDONYMS ──────────────────────────────────────────────────────────────

  it('15/16. members get deterministic distinct "Member N" labels by (joinedAt,id) order', async () => {
    const ledger = await service.getPublicLedger(TOKEN);
    // m1 joined earlier → Member 1; m2 → Member 2. Payer m1 → "Member 1".
    expect(ledger.entries[0].payerLabel).toBe('Member 1');
    // Settlement m2 → m1 → "Member 2" owes "Member 1".
    expect(ledger.balanceSummary[0]).toEqual({
      fromLabel: 'Member 2',
      toLabel: 'Member 1',
      amount: 500,
      currency: 'INR',
    });
  });

  it('21. the same member has the SAME label in entries and balances', async () => {
    // Make m1 both the payer and a settlement party.
    const ledger = await service.getPublicLedger(TOKEN);
    const payer = ledger.entries[0].payerLabel; // Member 1 (m1)
    expect(ledger.balanceSummary[0].toLabel).toBe(payer); // m1 again
  });

  // ── BALANCE AUTHORITY / NO SECOND CALCULATOR / NO MUTATION ───────────────────

  it('22/23. balances come verbatim from calculateGroupBalances; nothing is computed or mutated', async () => {
    const ledger = await service.getPublicLedger(TOKEN);
    expect(settlements.calculateGroupBalances).toHaveBeenCalledWith('creator-user-id', GROUP.id);
    // The amount/currency are exactly what the authoritative service returned.
    expect(ledger.balanceSummary[0].amount).toBe(500);
    expect(ledger.balanceSummary[0].currency).toBe('INR');
    // Read-only: no expense/settlement write.
    expect(expenseRepo.save).not.toHaveBeenCalled();
  });

  it('cross-group safety: the projection only ever uses the share.group it resolved', async () => {
    await service.getPublicLedger(TOKEN);
    // Balances + entries + members are all scoped to the resolved group id; there
    // is no client-supplied group id path.
    expect(settlements.calculateGroupBalances).toHaveBeenCalledWith(expect.any(String), GROUP.id);
    expect(memberRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { group: { id: GROUP.id } } }),
    );
    expect(expenseRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ group: { id: GROUP.id }, status: 'posted' }),
      }),
    );
  });

  it('holds no finance-mutation or crypto/decrypt capability', () => {
    expect((service as unknown as Record<string, unknown>)['decrypt']).toBeUndefined();
    expect((service as unknown as Record<string, unknown>)['calculateBalances']).toBeUndefined();
    // Reuses the single injected authoritative calculator only.
    const injected = Object.values(service as unknown as Record<string, unknown>);
    expect(injected).toContain(settlements);
  });
});
