import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  Contact,
  CreateDirectSettlementDto,
  CreateDirectTransactionDto,
  DirectLedgerEntry,
  Expense,
  ExpensePayment,
  ExpenseSplit,
  Group,
  GroupMember,
  PeopleOverviewResponse,
  PersonBalanceBreakdown,
  PersonDetailResponse,
  PersonHistoryItem,
  PersonSummaryResponse,
  Settlement,
  UpdateDirectTransactionDto,
  User,
  simplifyLedgerDebts,
} from '@finmate/data-models';
import { resolveMemberDisplay } from '../common/member-display.util';
import { ContactsService } from '../contacts/contacts.service';

/** Per-currency accumulator for one counterparty. */
interface CurrencyBucket {
  groupObligations: number;
  directLending: number;
  settlements: number;
  history: PersonHistoryItem[];
}

/**
 * Accumulated relationship with one counterparty, keyed by currency. The
 * counterparty is a registered `User` or a non-member `Contact`; `key` is the
 * opaque ledger identity (`user:<id>` / `contact:<id>`) that also feeds
 * `simplifyLedgerDebts` unchanged.
 */
interface CounterpartyLedger {
  key: string;
  kind: 'user' | 'contact';
  /** Set when kind === 'user'. */
  userId?: string;
  /** Set when kind === 'contact'. */
  contactId?: string;
  displayName: string;
  email: string;
  byCurrency: Map<string, CurrencyBucket>;
}

/** Metadata carried alongside a ledger key when a counterparty is first seen. */
interface CounterpartyMeta {
  kind: 'user' | 'contact';
  userId?: string;
  contactId?: string;
  displayName: string;
  email: string;
}

/** Get-or-create a counterparty bucket by its opaque ledger key. */
type GetCp = (key: string, meta: CounterpartyMeta) => CounterpartyLedger;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Opaque ledger identity keys. Kept as plain prefixed strings so the FIN-002
 * calculator `simplifyLedgerDebts` continues to receive opaque keys with no
 * business meaning (it already sorts/tie-breaks purely lexicographically).
 */
const keyForUser = (id: string): string => `user:${id}`;
const keyForContact = (id: string): string => `contact:${id}`;

@Injectable()
export class PersonLedgerService {
  constructor(
    @InjectRepository(GroupMember)
    private readonly groupMemberRepository: Repository<GroupMember>,
    @InjectRepository(Expense)
    private readonly expenseRepository: Repository<Expense>,
    @InjectRepository(ExpenseSplit)
    private readonly expenseSplitRepository: Repository<ExpenseSplit>,
    @InjectRepository(ExpensePayment)
    private readonly expensePaymentRepository: Repository<ExpensePayment>,
    @InjectRepository(Settlement)
    private readonly settlementRepository: Repository<Settlement>,
    @InjectRepository(DirectLedgerEntry)
    private readonly directLedgerRepository: Repository<DirectLedgerEntry>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
    // P2P-2: reused only for its existing merge/redirect resolver — no second
    // merge mechanism and no claim/merge write path is touched here.
    private readonly contactsService: ContactsService,
  ) {}

  /**
   * Read-time resolution of a Contact-backed counterparty to its terminal
   * ledger identity (P2P-2). Follows the existing Contact merge redirect chain
   * (`ContactsService.resolveMergeRedirect`, cycle-guarded) to the surviving
   * Contact, then folds a *claimed* Contact into its `user:<id>` identity so
   * historical Contact-backed rows collapse into the same human as the
   * registered User. The underlying `DirectLedgerEntry` is never mutated.
   */
  private async resolveContactIdentity(
    contactId: string,
  ): Promise<CounterpartyMeta> {
    const contact = await this.contactRepository.findOne({
      where: { id: contactId },
      relations: ['mergedIntoContact', 'claimedByUser'],
    });
    if (!contact) {
      // Defensive: FK guarantees the row exists, but never throw during a
      // read-only ledger build — fall back to an opaque contact identity.
      return { kind: 'contact', contactId, displayName: 'Contact', email: '' };
    }

    // Follow merge redirects to the terminal (surviving) Contact. Only archived
    // rows redirect; resolveMergeRedirect handles multi-hop chains + cycles.
    let terminal = contact;
    if (contact.status === 'archived' && contact.mergedIntoContact) {
      const resolved = await this.contactsService.resolveMergeRedirect(contact);
      // resolveMergeRedirect loads only `mergedIntoContact`; reload the terminal
      // with its claim state so a merged→claimed chain folds to the User.
      terminal =
        (await this.contactRepository.findOne({
          where: { id: resolved.id },
          relations: ['claimedByUser'],
        })) ?? resolved;
    }

    if (terminal.status === 'claimed' && terminal.claimedByUser) {
      const u = terminal.claimedByUser;
      return {
        kind: 'user',
        userId: u.id,
        displayName: u.displayName || u.email,
        email: u.email,
      };
    }
    return {
      kind: 'contact',
      contactId: terminal.id,
      displayName: terminal.displayName || 'Contact',
      email: '',
    };
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Aggregate People dashboard: totals plus a per-(person, currency) list.
   * Household groups are intentionally excluded — they never create
   * person-to-person obligations. Sorted by outstanding magnitude; settled
   * relationships sink to the bottom.
   */
  async getOverview(
    callerUserId: string,
    limit?: number,
  ): Promise<PeopleOverviewResponse> {
    const ledger = await this.buildLedger(callerUserId);
    const people: PersonSummaryResponse[] = [];
    // Per-currency totals — never summed across currencies (that would combine
    // unrelated units into one misleading number). The headline totals report a
    // single "dominant" currency; balances in other currencies still appear as
    // their own person rows.
    const byCurrency = new Map<string, { owed: number; owe: number }>();

    for (const cp of ledger.values()) {
      // P2P-1: only registered-User counterparties are surfaced in the public
      // response. Contact-backed direct entries are assembled internally (so the
      // ledger is Contact-capable) but exposed via dedicated Contact routes in a
      // later batch (P2P-3), keeping the existing User API byte-for-byte.
      if (cp.kind !== 'user' || !cp.userId) continue;
      const counterpartyUserId = cp.userId;
      for (const [currency, bucket] of cp.byCurrency.entries()) {
        const net = round2(
          bucket.groupObligations + bucket.directLending + bucket.settlements,
        );
        const totals = byCurrency.get(currency) ?? { owed: 0, owe: 0 };
        if (net > 0) totals.owed += net;
        else if (net < 0) totals.owe += Math.abs(net);
        byCurrency.set(currency, totals);
        people.push({
          counterpartyUserId,
          displayName: cp.displayName,
          email: cp.email,
          currency,
          netBalance: net,
          direction: net > 0 ? 'owes_you' : net < 0 ? 'you_owe' : 'settled',
        });
      }
    }

    // Dominant currency = the one with the largest outstanding activity.
    let dominant = 'USD';
    let best = -1;
    for (const [currency, t] of byCurrency.entries()) {
      const activity = t.owed + t.owe;
      if (activity > best) {
        best = activity;
        dominant = currency;
      }
    }
    const dom = byCurrency.get(dominant) ?? { owed: 0, owe: 0 };

    // Outstanding first (largest magnitude), settled last.
    people.sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance));
    const limited =
      typeof limit === 'number' && limit > 0 ? people.slice(0, limit) : people;

    return {
      currency: dominant,
      totalYouAreOwed: round2(dom.owed),
      totalYouOwe: round2(dom.owe),
      hasMultipleCurrencies: byCurrency.size > 1,
      people: limited,
    };
  }

  /**
   * Full relationship with one person: headline net (dominant currency),
   * per-currency breakdown, and chronological history across every source.
   */
  async getPersonDetail(
    callerUserId: string,
    counterpartyUserId: string,
  ): Promise<PersonDetailResponse> {
    if (callerUserId === counterpartyUserId) {
      throw new BadRequestException('Cannot view a relationship with yourself');
    }
    const ledger = await this.buildLedger(callerUserId, counterpartyUserId);
    const cp = ledger.get(keyForUser(counterpartyUserId));

    const counterparty = await this.userRepository.findOne({
      where: { id: counterpartyUserId },
    });
    if (!counterparty) {
      throw new NotFoundException('Person not found');
    }
    const displayName =
      cp?.displayName || counterparty.displayName || counterparty.email;
    const email = cp?.email || counterparty.email;

    const breakdown: PersonBalanceBreakdown[] = [];
    const history: PersonHistoryItem[] = [];
    let headlineCurrency = 'USD';
    let headlineNet = 0;

    if (cp) {
      for (const [currency, bucket] of cp.byCurrency.entries()) {
        const net = round2(
          bucket.groupObligations + bucket.directLending + bucket.settlements,
        );
        breakdown.push({
          currency,
          groupObligations: round2(bucket.groupObligations),
          directLending: round2(bucket.directLending),
          settlements: round2(bucket.settlements),
          net,
        });
        history.push(...bucket.history);
        if (Math.abs(net) >= Math.abs(headlineNet)) {
          headlineNet = net;
          headlineCurrency = currency;
        }
      }
    }

    history.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return {
      counterpartyUserId,
      displayName,
      email,
      currency: headlineCurrency,
      netBalance: headlineNet,
      direction:
        headlineNet > 0 ? 'owes_you' : headlineNet < 0 ? 'you_owe' : 'settled',
      breakdown,
      history,
    };
  }

  /** Record a direct lend/borrow with another registered user. */
  async createDirectTransaction(
    callerUserId: string,
    counterpartyUserId: string,
    dto: CreateDirectTransactionDto,
  ): Promise<DirectLedgerEntry> {
    const { caller, counterparty } = await this.resolvePair(
      callerUserId,
      counterpartyUserId,
    );

    // Normalise to a directional obligation: after a lend, the counterparty
    // owes the caller; after a borrow, the caller owes the counterparty.
    const fromUser = dto.entryType === 'lend' ? counterparty : caller;
    const toUser = dto.entryType === 'lend' ? caller : counterparty;

    const entry = this.directLedgerRepository.create({
      fromUser,
      toUser,
      createdByUser: caller,
      entryType: dto.entryType,
      amount: dto.amount,
      currency: dto.currency.toUpperCase(),
      note: dto.note,
      occurredOn: dto.occurredOn,
    });
    return this.directLedgerRepository.save(entry);
  }

  /**
   * Record a settlement ("Return") reducing the outstanding balance with a
   * person. Direction is inferred from the current net; over-settlement (more
   * than the outstanding amount in that currency) is rejected.
   */
  async createDirectSettlement(
    callerUserId: string,
    counterpartyUserId: string,
    dto: CreateDirectSettlementDto,
  ): Promise<DirectLedgerEntry> {
    const { caller, counterparty } = await this.resolvePair(
      callerUserId,
      counterpartyUserId,
    );
    const currency = dto.currency.toUpperCase();

    const ledger = await this.buildLedger(callerUserId, counterpartyUserId);
    const bucket = ledger
      .get(keyForUser(counterpartyUserId))
      ?.byCurrency.get(currency);
    const net = bucket
      ? round2(
          bucket.groupObligations + bucket.directLending + bucket.settlements,
        )
      : 0;

    if (net === 0) {
      throw new BadRequestException({
        errorCode: 'SETTLE_NOTHING_OUTSTANDING',
        message: `There is no outstanding ${currency} balance to settle with this person`,
      });
    }
    if (dto.amount > Math.abs(net) + 1e-9) {
      throw new BadRequestException({
        errorCode: 'SETTLE_OVER_AMOUNT',
        message: `Return amount cannot exceed the outstanding balance (${Math.abs(
          net,
        )} ${currency})`,
      });
    }

    // net > 0 → they owe you → they return money to you (from=counterparty).
    // net < 0 → you owe them → you return money to them (from=caller).
    const fromUser = net > 0 ? counterparty : caller;
    const toUser = net > 0 ? caller : counterparty;

    const entry = this.directLedgerRepository.create({
      fromUser,
      toUser,
      createdByUser: caller,
      entryType: 'settlement',
      amount: dto.amount,
      currency,
      note: dto.note,
      occurredOn: dto.occurredOn,
    });
    return this.directLedgerRepository.save(entry);
  }

  /** Edit a direct entry the caller is party to (version-checked). */
  async updateDirectTransaction(
    callerUserId: string,
    entryId: string,
    dto: UpdateDirectTransactionDto,
  ): Promise<DirectLedgerEntry> {
    const entry = await this.loadCallerEntry(callerUserId, entryId);
    if (entry.version !== dto.version) {
      throw new PreconditionFailedException({
        errorCode: 'CON_VERSION_CONFLICT',
        message:
          'Version conflict: the resource has been modified by another request',
      });
    }
    if (dto.amount !== undefined) entry.amount = dto.amount;
    if (dto.occurredOn !== undefined) entry.occurredOn = dto.occurredOn;
    if (dto.note !== undefined) entry.note = dto.note;
    return this.directLedgerRepository.save(entry);
  }

  /** Soft-delete a direct entry (preserves history). */
  async deleteDirectTransaction(
    callerUserId: string,
    entryId: string,
  ): Promise<void> {
    const entry = await this.loadCallerEntry(callerUserId, entryId);
    await this.directLedgerRepository.softRemove(entry);
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private async resolvePair(callerUserId: string, counterpartyUserId: string) {
    if (callerUserId === counterpartyUserId) {
      throw new BadRequestException(
        'Cannot record a transaction with yourself',
      );
    }
    const [caller, counterparty] = await Promise.all([
      this.userRepository.findOne({ where: { id: callerUserId } }),
      this.userRepository.findOne({ where: { id: counterpartyUserId } }),
    ]);
    if (!caller) throw new NotFoundException('User not found');
    if (!counterparty) throw new NotFoundException('Person not found');
    return { caller, counterparty };
  }

  private async loadCallerEntry(
    callerUserId: string,
    entryId: string,
  ): Promise<DirectLedgerEntry> {
    const entry = await this.directLedgerRepository.findOne({
      where: { id: entryId },
      relations: ['fromUser', 'toUser', 'createdByUser'],
    });
    if (!entry) throw new NotFoundException('Transaction not found');
    if (
      entry.fromUser.id !== callerUserId &&
      entry.toUser.id !== callerUserId
    ) {
      throw new ForbiddenException('You are not a party to this transaction');
    }
    return entry;
  }

  private ensureBucket(
    cp: CounterpartyLedger,
    currency: string,
  ): CurrencyBucket {
    let b = cp.byCurrency.get(currency);
    if (!b) {
      b = {
        groupObligations: 0,
        directLending: 0,
        settlements: 0,
        history: [],
      };
      cp.byCurrency.set(currency, b);
    }
    return b;
  }

  /**
   * Builds the caller's ledger keyed by counterparty userId, from:
   *  - per-expense pairwise obligations in NORMAL groups (household excluded),
   *  - confirmed group settlements between the two parties,
   *  - direct lend/borrow/settlement entries.
   * Registered users only (a stable cross-context identity requires a User).
   * When `onlyCounterpartyId` is given, other counterparties are skipped.
   */
  private async buildLedger(
    callerUserId: string,
    onlyCounterpartyId?: string,
  ): Promise<Map<string, CounterpartyLedger>> {
    const ledger = new Map<string, CounterpartyLedger>();
    const getCp: GetCp = (key, meta) => {
      let cp = ledger.get(key);
      if (!cp) {
        cp = {
          key,
          kind: meta.kind,
          userId: meta.userId,
          contactId: meta.contactId,
          displayName: meta.displayName,
          email: meta.email,
          byCurrency: new Map(),
        };
        ledger.set(key, cp);
      }
      return cp;
    };

    await this.accumulateGroupLedger(callerUserId, onlyCounterpartyId, getCp);
    await this.accumulateDirectLedger(callerUserId, onlyCounterpartyId, getCp);
    return ledger;
  }

  private async accumulateGroupLedger(
    callerUserId: string,
    onlyCounterpartyId: string | undefined,
    getCp: GetCp,
  ): Promise<void> {
    // Caller's active memberships in NORMAL groups only.
    const memberships = await this.groupMemberRepository.find({
      where: {
        user: { id: callerUserId },
        joinStatus: 'active',
        group: { groupType: 'normal' },
      },
      relations: ['group'],
    });

    for (const membership of memberships) {
      const group = membership.group;
      const callerMemberId = membership.id;

      const expenses = await this.expenseRepository.find({
        where: { group: { id: group.id }, status: 'posted' },
        relations: ['groupKeyVersion'],
      });
      if (expenses.length === 0) continue;
      const expenseIds = expenses.map((e) => e.id);
      const expenseById = new Map(expenses.map((e) => [e.id, e]));

      const [splits, payments] = await Promise.all([
        this.expenseSplitRepository.find({
          where: { expense: { id: In(expenseIds) } },
          relations: [
            'expense',
            'participantGroupMember',
            'participantGroupMember.user',
            'participantGroupMember.contact',
          ],
        }),
        this.expensePaymentRepository.find({
          where: { expense: { id: In(expenseIds) } },
          relations: [
            'expense',
            'paidByGroupMember',
            'paidByGroupMember.user',
            'paidByGroupMember.contact',
            'paidByUser',
          ],
        }),
      ]);

      // Index by expense.
      const splitsByExpense = new Map<string, ExpenseSplit[]>();
      for (const s of splits) {
        const list = splitsByExpense.get(s.expense.id) ?? [];
        list.push(s);
        splitsByExpense.set(s.expense.id, list);
      }
      const paymentsByExpense = new Map<string, ExpensePayment[]>();
      for (const p of payments) {
        const list = paymentsByExpense.get(p.expense.id) ?? [];
        list.push(p);
        paymentsByExpense.set(p.expense.id, list);
      }

      // memberId → { userId, displayName, email }
      const memberInfo = new Map<
        string,
        { userId: string | null; displayName: string; email: string | null }
      >();
      const registerMember = (m?: GroupMember) => {
        if (!m || memberInfo.has(m.id)) return;
        const d = resolveMemberDisplay(m);
        memberInfo.set(m.id, {
          userId: d.userId,
          displayName: d.displayName,
          email: d.email,
        });
      };
      splits.forEach((s) => registerMember(s.participantGroupMember));
      payments.forEach((p) => registerMember(p.paidByGroupMember));

      for (const expense of expenses) {
        const exSplits = splitsByExpense.get(expense.id) ?? [];
        const exPayments = paymentsByExpense.get(expense.id) ?? [];
        const sign = expense.transactionType === 'refund' ? -1 : 1;

        // Net position per member within THIS expense (paid − owed).
        const balances = new Map<string, number>();
        const add = (memberId: string, delta: number) =>
          balances.set(memberId, (balances.get(memberId) ?? 0) + delta);

        if (exPayments.length > 0) {
          for (const p of exPayments) {
            const mid = p.paidByGroupMember?.id;
            if (!mid) continue;
            add(mid, sign * Number(p.amount));
          }
        } else if (expense.paidByGroupMember) {
          // Legacy / single-payer fallback.
          registerMember(expense.paidByGroupMember);
          add(expense.paidByGroupMember.id, sign * Number(expense.amountTotal));
        }
        for (const s of exSplits) {
          const mid = s.participantGroupMember?.id;
          if (!mid) continue;
          add(mid, -sign * Number(s.amountOwed));
        }

        if (!balances.has(callerMemberId)) continue; // caller uninvolved

        // Per-expense pairwise settle-up (scoped to this one expense — never a
        // cross-expense/cross-person chain simplification). Extract the caller's
        // edges only.
        const edges = simplifyLedgerDebts(
          [...balances.entries()].map(([key, balance]) => ({ key, balance })),
          expense.currency,
        );
        for (const edge of edges) {
          let counterpartyMemberId: string | null = null;
          let signedForCaller = 0;
          if (edge.toKey === callerMemberId) {
            counterpartyMemberId = edge.fromKey; // they owe the caller
            signedForCaller = edge.amount;
          } else if (edge.fromKey === callerMemberId) {
            counterpartyMemberId = edge.toKey; // caller owes them
            signedForCaller = -edge.amount;
          } else {
            continue;
          }
          const info = memberInfo.get(counterpartyMemberId);
          if (!info || !info.userId) continue; // registered users only (V1)
          if (onlyCounterpartyId && info.userId !== onlyCounterpartyId)
            continue;

          const cp = getCp(keyForUser(info.userId), {
            kind: 'user',
            userId: info.userId,
            displayName: info.displayName,
            email: info.email ?? '',
          });
          const bucket = this.ensureBucket(cp, expense.currency);
          bucket.groupObligations += signedForCaller;
          bucket.history.push({
            id: `expense:${expense.id}`,
            source: 'group_expense',
            amount: round2(signedForCaller),
            currency: expense.currency,
            date: expense.expenseDate,
            groupId: group.id,
            groupName: group.name,
            expenseId: expense.id,
            title: expense.title,
            encryptionScope: expense.encryptionScope,
            groupKeyVersionId: expense.groupKeyVersion?.id,
          });
        }
      }

      // Confirmed group settlements between the caller and each counterparty.
      const settlements = await this.settlementRepository.find({
        where: { group: { id: group.id }, status: 'confirmed' },
        relations: [
          'fromUser',
          'toUser',
          'fromGroupMember',
          'fromGroupMember.user',
          'toGroupMember',
          'toGroupMember.user',
        ],
      });
      for (const s of settlements) {
        const fromUserId =
          s.fromUser?.id ?? s.fromGroupMember?.user?.id ?? null;
        const toUserId = s.toUser?.id ?? s.toGroupMember?.user?.id ?? null;
        if (!fromUserId || !toUserId) continue;
        let counterpartyUserId: string | null = null;
        let signedForCaller = 0;
        if (fromUserId === callerUserId) {
          counterpartyUserId = toUserId; // caller paid → reduces what caller owes
          signedForCaller = Number(s.amount);
        } else if (toUserId === callerUserId) {
          counterpartyUserId = fromUserId; // caller received → reduces their debt
          signedForCaller = -Number(s.amount);
        } else {
          continue;
        }
        if (onlyCounterpartyId && counterpartyUserId !== onlyCounterpartyId)
          continue;
        // Resolve counterparty display via their membership if available.
        const cpDisplayName =
          (counterpartyUserId === toUserId
            ? s.toGroupMember?.user?.displayName
            : s.fromGroupMember?.user?.displayName) ?? '';
        const cpEmail =
          (counterpartyUserId === toUserId
            ? s.toGroupMember?.user?.email
            : s.fromGroupMember?.user?.email) ?? '';
        const cp = getCp(keyForUser(counterpartyUserId), {
          kind: 'user',
          userId: counterpartyUserId,
          displayName: cpDisplayName || cpEmail,
          email: cpEmail,
        });
        const bucket = this.ensureBucket(cp, s.currency);
        bucket.settlements += signedForCaller;
        bucket.history.push({
          id: `settlement:${s.id}`,
          source: 'settlement',
          entryType: 'settlement',
          amount: round2(signedForCaller),
          currency: s.currency,
          date: s.settledOn ?? s.updatedAt.toISOString().slice(0, 10),
          note: s.note,
          groupId: group.id,
          groupName: group.name,
        });
      }
    }
  }

  private async accumulateDirectLedger(
    callerUserId: string,
    onlyCounterpartyId: string | undefined,
    getCp: GetCp,
  ): Promise<void> {
    // The caller is always a User on one side (a Contact never records/queries),
    // so filtering by the caller's user id on either side finds every entry the
    // caller is party to — including User↔Contact ones.
    const entries = await this.directLedgerRepository.find({
      where: [
        { fromUser: { id: callerUserId }, deletedAt: IsNull() },
        { toUser: { id: callerUserId }, deletedAt: IsNull() },
      ],
      relations: ['fromUser', 'toUser', 'fromContact', 'toContact'],
    });

    // P2P-2: resolve each DISTINCT counterparty Contact exactly once (claim +
    // merge redirect), so a Contact appearing in many rows never triggers a
    // per-row query — no N+1. Repeated resolution is idempotent and does no
    // writes, so the ledger is stable across repeated reads.
    const contactIds = new Set<string>();
    for (const e of entries) {
      const callerParty =
        e.fromUser?.id === callerUserId || e.toUser?.id === callerUserId;
      if (!callerParty) continue;
      const cpContact =
        e.toUser?.id === callerUserId ? e.fromContact : e.toContact;
      if (cpContact) contactIds.add(cpContact.id);
    }
    const contactIdentity = new Map<string, CounterpartyMeta>();
    await Promise.all(
      [...contactIds].map(async (id) =>
        contactIdentity.set(id, await this.resolveContactIdentity(id)),
      ),
    );

    for (const e of entries) {
      const callerIsFrom = e.fromUser?.id === callerUserId;
      const callerIsTo = e.toUser?.id === callerUserId;
      if (!callerIsFrom && !callerIsTo) continue;

      // Counterparty = the OTHER side — a registered User or a non-member Contact.
      const cpUser = callerIsTo ? e.fromUser : e.toUser;
      const cpContact = callerIsTo ? e.fromContact : e.toContact;

      let cpKey: string;
      let cpMeta: CounterpartyMeta;
      if (cpUser) {
        cpKey = keyForUser(cpUser.id);
        cpMeta = {
          kind: 'user',
          userId: cpUser.id,
          displayName: cpUser.displayName || cpUser.email,
          email: cpUser.email,
        };
      } else if (cpContact) {
        // Read-time resolved identity: a claimed Contact folds to user:<id>
        // (collapsing with any native User↔User history for the same human);
        // a merged Contact resolves to its terminal Contact. History rows are
        // never rewritten — only the ledger key is resolved here.
        cpMeta =
          contactIdentity.get(cpContact.id) ??
          ({
            kind: 'contact',
            contactId: cpContact.id,
            displayName: cpContact.displayName || 'Contact',
            email: '',
          } as CounterpartyMeta);
        cpKey =
          cpMeta.kind === 'user'
            ? keyForUser(cpMeta.userId as string)
            : keyForContact(cpMeta.contactId as string);
      } else {
        continue; // malformed row (DB checks forbid this) — skip defensively
      }

      // `onlyCounterpartyId` is a User id (P2P-1 read routes are User-only), so
      // an unclaimed Contact never matches; a CLAIMED Contact resolves to its
      // user id and therefore correctly folds into that user's detail view.
      if (onlyCounterpartyId && cpMeta.userId !== onlyCounterpartyId) continue;

      let signedForCaller: number;
      let bucketKey: 'directLending' | 'settlements';
      if (e.entryType === 'settlement') {
        // from = payer. Caller paying back increases net toward "they owe you".
        signedForCaller = callerIsFrom ? Number(e.amount) : -Number(e.amount);
        bucketKey = 'settlements';
      } else {
        // lend/borrow: the `to` side is the creditor.
        signedForCaller = callerIsTo ? Number(e.amount) : -Number(e.amount);
        bucketKey = 'directLending';
      }

      const cp = getCp(cpKey, cpMeta);
      const bucket = this.ensureBucket(cp, e.currency);
      bucket[bucketKey] += signedForCaller;
      bucket.history.push({
        id: `direct:${e.id}`,
        source: e.entryType === 'settlement' ? 'settlement' : 'direct',
        entryType: e.entryType,
        amount: round2(signedForCaller),
        currency: e.currency,
        date: e.occurredOn,
        note: e.note,
      });
    }
  }
}
