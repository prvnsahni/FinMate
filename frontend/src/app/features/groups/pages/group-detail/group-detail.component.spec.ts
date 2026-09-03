import { TestBed, ComponentFixture } from '@angular/core/testing';
import { GroupDetailComponent } from './group-detail.component';
import { GroupsService } from '../../services/groups.service';
import { ExpensesService } from '../../services/expenses.service';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { GroupMember } from '@finmate/data-models';
import { Store } from '@ngxs/store';
import { ClientEncryptionService } from '../../../../core/services/encryption.service';

import { RecurringExpensesService } from '../../services/recurring-expenses.service';
import { GroupKeyService } from '../../../../core/services/group-key.service';
import { CryptoSessionManager } from '../../../../core/services/crypto-session-manager.service';
import { signal } from '@angular/core';

describe('GroupDetailComponent', () => {
  let component: GroupDetailComponent;
  let fixture: ComponentFixture<GroupDetailComponent>;
  let mockGroupsService: jest.Mocked<GroupsService>;
  let mockExpensesService: jest.Mocked<ExpensesService>;
  let mockRecurringExpensesService: any;
  let mockActivatedRoute: any;
  let mockGroupKeyService: any;
  let mockEncryptionService: any;
  let mockStore: { selectSnapshot: jest.Mock };

  const mockGroup = {
    id: 'group-1',
    name: 'Household Suite',
    description: 'Shared household space',
    currency: 'USD',
    groupType: 'household',
    carryForwardEnabled: true,
    visibility: 'private',
    version: 1,
  };

  const mockMembers: GroupMember[] = [
    {
      id: 'member-owner',
      joinStatus: 'active',
      role: 'owner',
      user: {
        id: 'user-owner',
        email: 'owner@household.com',
        displayName: 'Owner User',
      },
    } as any,
    {
      id: 'member-admin',
      joinStatus: 'active',
      role: 'admin',
      user: {
        id: 'user-admin',
        email: 'admin@household.com',
        displayName: 'Admin User',
      },
    } as any,
    {
      id: 'member-contributor',
      joinStatus: 'active',
      role: 'member',
      user: {
        id: 'user-contributor',
        email: 'contributor@household.com',
        displayName: 'Contributor User',
      },
    } as any,
    {
      id: 'member-viewer',
      joinStatus: 'active',
      role: 'viewer',
      user: {
        id: 'user-viewer',
        email: 'viewer@household.com',
        displayName: 'Viewer User',
      },
    } as any,
  ];

  beforeEach(async () => {
    // Mock window.alert to prevent JSDOM errors
    jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    // jsdom doesn't implement scrollIntoView; the component calls it (via
    // setTimeout) after tab-bar changes. Left unmocked, a queued call from
    // an earlier test can fire mid-await in a later test (e.g. one that
    // does several real microtask flushes) and crash as an uncaught
    // exception unrelated to whatever that later test is actually checking.
    Element.prototype.scrollIntoView = jest.fn();

    mockGroupsService = {
      getGroup: jest.fn().mockReturnValue(of(mockGroup)),
      getMembers: jest.fn().mockReturnValue(of(mockMembers)),
      getBalances: jest.fn().mockReturnValue(
        of({
          overall: { balances: [], suggestedSettlements: [] },
          filtered: { balances: [], suggestedSettlements: [] },
        }),
      ),
      getHistoryLogs: jest.fn().mockReturnValue(of({ data: [] })),
      getDeletedExpenses: jest.fn().mockReturnValue(of({ data: [] })),
      getCarryForward: jest.fn().mockReturnValue(of([])),
      getContributions: jest.fn().mockReturnValue(
        of([
          {
            memberId: 'member-owner',
            displayName: 'Owner User',
            percentage: 50,
          },
          {
            memberId: 'member-admin',
            displayName: 'Admin User',
            percentage: 50,
          },
        ]),
      ),
      updateContributions: jest.fn().mockReturnValue(of({})),
      updateMember: jest.fn().mockReturnValue(of({})),
      removeMember: jest.fn().mockReturnValue(of({})),
    } as any;

    mockExpensesService = {
      getExpenses: jest
        .fn()
        .mockReturnValue(of({ data: [], meta: { totalItems: 0 } })),
      // TAG-BATCH-B: ngOnInit loads the taxonomy for the tag filter facet.
      getTaxonomy: jest.fn().mockReturnValue(of([])),
    } as any;

    mockRecurringExpensesService = {
      getRecurringExpenses: jest.fn().mockReturnValue(of([])),
      createRecurringExpense: jest.fn().mockReturnValue(of({})),
      updateRecurringExpense: jest.fn().mockReturnValue(of({})),
      deleteRecurringExpense: jest.fn().mockReturnValue(of(null)),
    };

    mockActivatedRoute = {
      paramMap: of(convertToParamMap({ id: 'group-1' })),
      queryParams: of({}),
      snapshot: {
        queryParams: {},
      },
    };

    mockGroupKeyService = {
      getMyAsymmetricKeys: jest.fn().mockResolvedValue({}),
      getGroupDataKey: jest.fn().mockResolvedValue({}),
      createGroupKey: jest.fn().mockResolvedValue({}),
      createAndStoreGroupKey: jest.fn().mockResolvedValue({}),
      resolveGroupKey: jest
        .fn()
        .mockResolvedValue({ status: 'ready', key: {} }),
      checkAndProvisionMissingKeys: jest.fn().mockResolvedValue({}),
      invalidateGroupKey: jest.fn(),
      // Provide Signal-compatible objects used by the component/template
      rateLimitError: signal<string | null>(null),
      requiresKeyProvisioning: signal<boolean>(false),
    };

    mockEncryptionService = {
      loadKeyFromSession: jest.fn().mockResolvedValue(null),
      deriveAndStoreKey: jest.fn().mockResolvedValue(undefined),
      unwrapKey: jest.fn().mockResolvedValue({}),
      decrypt: jest.fn().mockResolvedValue('file.txt'),
      decryptBytes: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
    };

    mockStore = {
      selectSnapshot: jest.fn().mockImplementation(() => ({
        email: 'owner@household.com',
      })),
    };

    await TestBed.configureTestingModule({
      imports: [GroupDetailComponent],
      providers: [
        { provide: GroupsService, useValue: mockGroupsService },
        { provide: ExpensesService, useValue: mockExpensesService },
        {
          provide: RecurringExpensesService,
          useValue: mockRecurringExpensesService,
        },
        { provide: GroupKeyService, useValue: mockGroupKeyService },
        { provide: ClientEncryptionService, useValue: mockEncryptionService },
        { provide: Store, useValue: mockStore },
        provideRouter([]),
        { provide: ActivatedRoute, useValue: mockActivatedRoute }, // Listed LAST to override provideRouter
      ],
    })
      .overrideComponent(GroupDetailComponent, {
        set: {
          imports: [CurrencyPipe, DatePipe, DecimalPipe, FormsModule],
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(GroupDetailComponent);
    component = fixture.componentInstance;

    // Default currentUserId spy
    jest.spyOn(component, 'getCurrentUserId').mockReturnValue('user-owner');
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load group details and related settings on init', () => {
    fixture.detectChanges(); // triggers ngOnInit

    expect(mockGroupsService.getGroup).toHaveBeenCalledWith('group-1');
    expect(mockGroupsService.getMembers).toHaveBeenCalledWith('group-1');
    expect(component.group()).toEqual(mockGroup);
    expect(component.members().length).toBe(4);
    expect(component.isOwnerOrAdmin()).toBe(true);
  });

  describe('cross-tab crypto recovery', () => {
    it('re-runs initializeGroupKeysAndSelfHeal whenever CryptoSessionManager reports Ready (this page unlocking, or another tab via BroadcastChannel)', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      component.group.set(mockGroup as any);
      const spy = jest.spyOn(component, 'initializeGroupKeysAndSelfHeal');
      spy.mockClear();

      // Simulate the master key becoming available (e.g. the shared
      // <app-crypto-recovery-panel> unlocked it, or another tab persisted
      // it to the shared IndexedDB vault and this tab's CryptoSessionManager
      // picked that up via BroadcastChannel).
      mockEncryptionService.loadKeyFromSession.mockResolvedValue({});
      const cryptoSession = TestBed.inject(CryptoSessionManager);
      await cryptoSession.ensureCryptoContext();
      expect(cryptoSession.isReady()).toBe(true);

      fixture.detectChanges(); // let the effect observe the signal change

      expect(spy).toHaveBeenCalledWith('group-1');
    });

    it('does not re-run initializeGroupKeysAndSelfHeal while the session is not Ready', async () => {
      fixture.detectChanges();
      await fixture.whenStable();

      component.group.set(mockGroup as any);
      const spy = jest.spyOn(component, 'initializeGroupKeysAndSelfHeal');
      spy.mockClear();

      const cryptoSession = TestBed.inject(CryptoSessionManager);
      expect(cryptoSession.isReady()).toBe(false);

      fixture.detectChanges();

      expect(spy).not.toHaveBeenCalled();
    });

    it('renders the shared <app-crypto-recovery-panel> in the template (structural — no component-local password prompt UI)', () => {
      fixture.detectChanges();

      expect(
        fixture.nativeElement.querySelector('app-crypto-recovery-panel'),
      ).not.toBeNull();
      // The old, component-local unlock input this replaced must be gone.
      expect(
        fixture.nativeElement.querySelector(
          'input[placeholder="Enter password to unlock vault"]',
        ),
      ).toBeNull();
    });
  });

  describe('downloadAttachment — crypto recovery wiring', () => {
    const mockExpense = {
      id: 'expense-1',
      encryptionScope: 'personal' as const,
    };
    const mockFile = {
      expenseId: 'expense-1',
      encryptedFileKey: 'wrapped-file-key',
      encryptedOriginalName: 'encrypted-name',
      storageKey: 'file-1',
      mimeType: 'text/plain',
    };

    async function flushMicrotasks(times = 15): Promise<void> {
      for (let i = 0; i < times; i++) {
        await Promise.resolve();
      }
    }

    beforeEach(() => {
      component.expenses.set([mockExpense as any]);
      jest
        .spyOn(Storage.prototype, 'getItem')
        .mockImplementation((key) =>
          key === 'sim_storage:file-1' ? 'encrypted-bytes' : null,
        );
      // jsdom doesn't implement these — define them rather than spyOn, which
      // requires the property to already exist.
      window.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock-url');
      window.URL.revokeObjectURL = jest.fn();
    });

    it('queues the download instead of alerting when the crypto session is genuinely not ready, then auto-resumes once unlocked', async () => {
      // The outer beforeEach's default loadKeyFromSession already resolves
      // null, so ensureCryptoContext() (and therefore resolveExpenseKey())
      // fails until we unlock below.
      const alertSpy = window.alert as jest.Mock;
      alertSpy.mockClear();

      const pending = component.downloadAttachment(mockFile);
      await flushMicrotasks();

      // Still paused, not failed — no premature alert to dismiss.
      expect(alertSpy).not.toHaveBeenCalled();

      mockEncryptionService.loadKeyFromSession.mockResolvedValue({});
      const cryptoSession = TestBed.inject(CryptoSessionManager);
      await cryptoSession.ensureCryptoContext();
      await pending;

      expect(mockEncryptionService.unwrapKey).toHaveBeenCalledWith(
        'wrapped-file-key',
        expect.anything(),
      );
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it('still alerts immediately for a real, non-recoverable failure (e.g. missing attachment bytes) when the session is fine', async () => {
      mockEncryptionService.loadKeyFromSession.mockResolvedValue({});
      (Storage.prototype.getItem as jest.Mock).mockReturnValue(null);
      const alertSpy = window.alert as jest.Mock;
      alertSpy.mockClear();

      await component.downloadAttachment(mockFile);

      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringContaining('Attachment file data not found'),
      );
    });
  });

  describe('progressive loading — parallel fetch (Phase 1)', () => {
    it('fetches members and balances immediately (ledger-tab data), without waiting for getGroup() to resolve', () => {
      const getGroupSubject = new Subject<typeof mockGroup>();
      mockGroupsService.getGroup = jest
        .fn()
        .mockReturnValue(getGroupSubject.asObservable()) as any;

      fixture.detectChanges(); // triggers ngOnInit; getGroup() is still pending

      expect(component.group()).toBeNull();
      expect(mockGroupsService.getMembers).toHaveBeenCalledWith('group-1');
      expect(mockGroupsService.getBalances).toHaveBeenCalledWith(
        'group-1',
        expect.anything(),
      );

      getGroupSubject.next(mockGroup);
      getGroupSubject.complete();
      expect(component.group()).toEqual(mockGroup);
    });

    it('does NOT fetch inactive-tab data (history / trash / recurring) on the initial ledger load', () => {
      fixture.detectChanges(); // default tab is ledger

      expect(mockGroupsService.getHistoryLogs).not.toHaveBeenCalled();
      expect(mockGroupsService.getDeletedExpenses).not.toHaveBeenCalled();
      expect(
        mockRecurringExpensesService.getRecurringExpenses,
      ).not.toHaveBeenCalled();
    });

    it('does not fetch expenses or carry-forward until getGroup() resolves (household month-scoping dependency)', () => {
      const getGroupSubject = new Subject<typeof mockGroup>();
      mockGroupsService.getGroup = jest
        .fn()
        .mockReturnValue(getGroupSubject.asObservable()) as any;

      fixture.detectChanges();

      expect(mockExpensesService.getExpenses).not.toHaveBeenCalled();
      expect(mockGroupsService.getCarryForward).not.toHaveBeenCalled();

      getGroupSubject.next(mockGroup); // household group
      getGroupSubject.complete();

      expect(mockExpensesService.getExpenses).toHaveBeenCalledWith(
        'group-1',
        expect.anything(),
      );
      expect(mockGroupsService.getCarryForward).toHaveBeenCalled();
    });

    it('computes userBalance correctly when balances() resolves before group()', () => {
      const getGroupSubject = new Subject<typeof mockGroup>();
      mockGroupsService.getGroup = jest
        .fn()
        .mockReturnValue(getGroupSubject.asObservable()) as any;
      mockGroupsService.getBalances = jest.fn().mockReturnValue(
        of({
          overall: {
            balances: [
              { userId: 'user-owner', currency: 'USD', netBalance: 42 },
            ],
            suggestedSettlements: [],
          },
          filtered: { balances: [], suggestedSettlements: [] },
        }),
      ) as any;

      fixture.detectChanges(); // balances resolves synchronously here; group() is still null

      expect(component.group()).toBeNull();
      expect(component.userBalance()).toBe(0); // no currency to match against yet

      getGroupSubject.next(mockGroup); // currency: 'USD'
      getGroupSubject.complete();

      // userBalance is a computed(), so it re-evaluates once group() is set —
      // no stale value frozen from before group() existed.
      expect(component.userBalance()).toBe(42);
    });
  });

  describe('progressive loading — per-section skeletons/errors (Phase 2)', () => {
    it('clears the page shell skeleton once getGroup() resolves, not once expenses resolve', () => {
      const getExpensesSubject = new Subject<{
        data: unknown[];
        meta: { totalItems: number };
      }>();
      mockExpensesService.getExpenses = jest
        .fn()
        .mockReturnValue(getExpensesSubject.asObservable()) as any;

      fixture.detectChanges(); // getGroup() resolves synchronously via of(); getExpenses() is still pending

      expect(component.group()).toEqual(mockGroup);
      expect(component.showSkeleton()).toBe(false);
      expect(component.isLoading()).toBe(false);

      getExpensesSubject.next({ data: [], meta: { totalItems: 0 } });
      getExpensesSubject.complete();
    });

    it('tracks balances loading independently via isLoadingBalances', () => {
      const getBalancesSubject = new Subject<{
        overall: { balances: unknown[]; suggestedSettlements: unknown[] };
        filtered: { balances: unknown[]; suggestedSettlements: unknown[] };
      }>();
      mockGroupsService.getBalances = jest
        .fn()
        .mockReturnValue(getBalancesSubject.asObservable()) as any;

      fixture.detectChanges();
      expect(component.isLoadingBalances()).toBe(true);

      getBalancesSubject.next({
        overall: { balances: [], suggestedSettlements: [] },
        filtered: { balances: [], suggestedSettlements: [] },
      });
      getBalancesSubject.complete();
      expect(component.isLoadingBalances()).toBe(false);
    });

    it('sets historyError (not just a console.error) on a failed history fetch, independent of other sections', () => {
      mockGroupsService.getHistoryLogs = jest
        .fn()
        .mockReturnValue(throwError(() => new Error('network error'))) as any;
      // History loads lazily — open its tab so the (failing) fetch runs.
      mockActivatedRoute.queryParams = of({ tab: 'history' });
      mockActivatedRoute.snapshot.queryParams = { tab: 'history' };

      fixture.detectChanges();

      expect(component.historyError()).toBe(true);
      expect(component.isLoadingHistory()).toBe(false);
      // Sibling sections are unaffected by history's failure.
      expect(component.membersError()).toBe(false);
      expect(component.balancesError()).toBe(false);
    });

    it('sets trashError independently on failure, without loading or affecting recurring', () => {
      mockGroupsService.getDeletedExpenses = jest
        .fn()
        .mockReturnValue(throwError(() => new Error('boom'))) as any;
      // Trash loads lazily — open its tab so the (failing) fetch runs.
      mockActivatedRoute.queryParams = of({ tab: 'trash' });
      mockActivatedRoute.snapshot.queryParams = { tab: 'trash' };

      fixture.detectChanges();

      expect(component.trashError()).toBe(true);
      // Recurring was never opened, so it neither loaded nor errored.
      expect(component.recurringError()).toBe(false);
    });
  });

  describe('infinite scroll ledger pagination', () => {
    const page1Item = { id: 'exp-1', title: 'First', amountTotal: 10 };
    const page2Item = { id: 'exp-2', title: 'Second', amountTotal: 20 };

    it('appends (not replaces) the next page and increments currentPage', () => {
      mockExpensesService.getExpenses = jest
        .fn()
        .mockReturnValueOnce(of({ data: [page1Item], meta: { totalItems: 2 } }))
        .mockReturnValueOnce(
          of({ data: [page2Item], meta: { totalItems: 2 } }),
        ) as any;

      fixture.detectChanges();

      expect(component.expenses().length).toBe(1);
      expect(component.currentPage()).toBe(1);
      expect(component.hasMoreExpenses()).toBe(true);

      component.loadMoreExpenses();

      expect(component.currentPage()).toBe(2);
      expect(component.expenses().length).toBe(2);
      expect(component.expenses().map((e) => e.id)).toEqual(['exp-1', 'exp-2']);
      expect(component.hasMoreExpenses()).toBe(false);
    });

    it('drops a stale (older) fetch response so it cannot overwrite a newer one (GOAL 4)', () => {
      const older = new Subject<{
        data: unknown[];
        meta: { totalItems: number };
      }>();
      const newer = new Subject<{
        data: unknown[];
        meta: { totalItems: number };
      }>();
      mockExpensesService.getExpenses = jest
        .fn()
        .mockReturnValueOnce(older.asObservable())
        .mockReturnValueOnce(newer.asObservable()) as any;

      fixture.detectChanges(); // fetch #1 (older) — still pending
      // A newer fetch supersedes it before #1 resolves.
      component.fetchExpenses('group-1', 'replace'); // fetch #2 (newer) — pending

      // Newer resolves first and is applied.
      newer.next({
        data: [{ id: 'new-1', title: 'Newer', amountTotal: 5 }],
        meta: { totalItems: 1 },
      });
      newer.complete();
      expect(component.expenses().map((e) => e.id)).toEqual(['new-1']);

      // The older (stale) response arrives LATER — it must be ignored entirely.
      older.next({
        data: [{ id: 'stale-1', title: 'Stale', amountTotal: 9 }],
        meta: { totalItems: 1 },
      });
      older.complete();
      expect(component.expenses().map((e) => e.id)).toEqual(['new-1']);
    });

    it('does not fetch another page while one is already loading', () => {
      const secondPageSubject = new Subject<{
        data: unknown[];
        meta: { totalItems: number };
      }>();
      mockExpensesService.getExpenses = jest
        .fn()
        .mockReturnValueOnce(of({ data: [page1Item], meta: { totalItems: 2 } }))
        .mockReturnValue(secondPageSubject.asObservable()) as any;

      fixture.detectChanges();

      component.loadMoreExpenses();
      expect(component.isLoadingMoreExpenses()).toBe(true);
      expect(mockExpensesService.getExpenses).toHaveBeenCalledTimes(2);

      // A second trigger while the first page-2 request is still in flight
      // must not fire a duplicate request.
      component.loadMoreExpenses();
      expect(mockExpensesService.getExpenses).toHaveBeenCalledTimes(2);

      secondPageSubject.next({ data: [page2Item], meta: { totalItems: 2 } });
      secondPageSubject.complete();
    });

    it('does not fetch beyond the last page once every item has loaded', () => {
      mockExpensesService.getExpenses = jest
        .fn()
        .mockReturnValue(
          of({ data: [page1Item], meta: { totalItems: 1 } }),
        ) as any;

      fixture.detectChanges();

      expect(component.hasMoreExpenses()).toBe(false);
      component.loadMoreExpenses();

      // Only the initial load — loadMoreExpenses() was a no-op.
      expect(mockExpensesService.getExpenses).toHaveBeenCalledTimes(1);
      expect(component.currentPage()).toBe(1);
    });

    it('triggers loadMoreExpenses via onExpenseListScroll once near the bottom', () => {
      mockExpensesService.getExpenses = jest
        .fn()
        .mockReturnValueOnce(of({ data: [page1Item], meta: { totalItems: 2 } }))
        .mockReturnValueOnce(
          of({ data: [page2Item], meta: { totalItems: 2 } }),
        ) as any;

      fixture.detectChanges();

      const scrollTarget = {
        scrollHeight: 1000,
        scrollTop: 850,
        clientHeight: 200,
      } as unknown as HTMLElement;
      component.onExpenseListScroll({
        target: scrollTarget,
      } as unknown as Event);

      expect(component.currentPage()).toBe(2);
      expect(component.expenses().length).toBe(2);
    });

    it('does not trigger loadMoreExpenses when far from the bottom', () => {
      mockExpensesService.getExpenses = jest
        .fn()
        .mockReturnValue(
          of({ data: [page1Item], meta: { totalItems: 5 } }),
        ) as any;

      fixture.detectChanges();

      const scrollTarget = {
        scrollHeight: 1000,
        scrollTop: 0,
        clientHeight: 200,
      } as unknown as HTMLElement;
      component.onExpenseListScroll({
        target: scrollTarget,
      } as unknown as Event);

      expect(mockExpensesService.getExpenses).toHaveBeenCalledTimes(1);
      expect(component.currentPage()).toBe(1);
    });
  });

  describe('lazy tab loading (Part 1)', () => {
    it('loads History only on first activation and retains it across revisits', () => {
      const qp = new Subject<any>();
      mockActivatedRoute.queryParams = qp.asObservable();
      fixture.detectChanges(); // ledger tab — History untouched
      expect(mockGroupsService.getHistoryLogs).not.toHaveBeenCalled();

      qp.next({ tab: 'history' });
      expect(mockGroupsService.getHistoryLogs).toHaveBeenCalledTimes(1);

      // Switch away and back — retained, no refetch.
      qp.next({ tab: 'ledger' });
      qp.next({ tab: 'history' });
      expect(mockGroupsService.getHistoryLogs).toHaveBeenCalledTimes(1);
    });

    it('loads Trash only on first activation of its tab, then retains it', () => {
      const qp = new Subject<any>();
      mockActivatedRoute.queryParams = qp.asObservable();
      fixture.detectChanges();
      expect(mockGroupsService.getDeletedExpenses).not.toHaveBeenCalled();

      qp.next({ tab: 'trash' });
      expect(mockGroupsService.getDeletedExpenses).toHaveBeenCalledTimes(1);
      qp.next({ tab: 'ledger' });
      qp.next({ tab: 'trash' });
      expect(mockGroupsService.getDeletedExpenses).toHaveBeenCalledTimes(1);
    });

    it('loads Recurring only on first activation of its tab, then retains it', () => {
      const qp = new Subject<any>();
      mockActivatedRoute.queryParams = qp.asObservable();
      fixture.detectChanges();
      expect(
        mockRecurringExpensesService.getRecurringExpenses,
      ).not.toHaveBeenCalled();

      qp.next({ tab: 'recurring' });
      expect(
        mockRecurringExpensesService.getRecurringExpenses,
      ).toHaveBeenCalledTimes(1);
      qp.next({ tab: 'ledger' });
      qp.next({ tab: 'recurring' });
      expect(
        mockRecurringExpensesService.getRecurringExpenses,
      ).toHaveBeenCalledTimes(1);
    });

    it('a deep-link to ?tab=history loads history once the groupId is known', () => {
      mockActivatedRoute.queryParams = of({ tab: 'history' });
      mockActivatedRoute.snapshot.queryParams = { tab: 'history' };

      fixture.detectChanges();

      expect(component.activeTab()).toBe('history');
      expect(mockGroupsService.getHistoryLogs).toHaveBeenCalledWith(
        'group-1',
        1,
        20,
        expect.anything(),
      );
    });

    it('onExpenseCreated refreshes an opened tab but never loads an unopened one', () => {
      const qp = new Subject<any>();
      mockActivatedRoute.queryParams = qp.asObservable();
      fixture.detectChanges();

      // History not opened → a create must not fetch it.
      (mockGroupsService.getHistoryLogs as jest.Mock).mockClear();
      component.onExpenseCreated();
      expect(mockGroupsService.getHistoryLogs).not.toHaveBeenCalled();

      // Open History (1 fetch), then create → refreshes it (2nd fetch).
      qp.next({ tab: 'history' });
      expect(mockGroupsService.getHistoryLogs).toHaveBeenCalledTimes(1);
      component.onExpenseCreated();
      expect(mockGroupsService.getHistoryLogs).toHaveBeenCalledTimes(2);
    });
  });

  describe('pagination consistency after creating an entry (Part 2 — reload window)', () => {
    // A deterministic newest-first dataset the mock slices by (page, limit), so
    // the test observes real page arithmetic rather than hand-fed pages.
    let dataset: { id: string; title: string; amountTotal: number }[];
    const row = (n: number) => ({
      id: `i${n}`,
      title: `E${n}`,
      amountTotal: n,
    });

    const wireSlicingBackend = () => {
      mockExpensesService.getExpenses = jest
        .fn()
        .mockImplementation(
          (_g: string, opts: { page: number; limit: number }) => {
            const start = (opts.page - 1) * opts.limit;
            return of({
              data: dataset.slice(start, start + opts.limit),
              meta: { totalItems: dataset.length },
            });
          },
        ) as any;
    };

    it('after paging to page 3 and creating a newest entry: no duplicates, no missing rows, order preserved, count consistent, load-more still correct', () => {
      // 6 rows, newest (i6) first; pageSize 2 → 3 pages.
      dataset = [row(6), row(5), row(4), row(3), row(2), row(1)];
      wireSlicingBackend();
      component.pageSize.set(2);

      fixture.detectChanges(); // page 1 → [i6, i5]
      expect(component.expenses().map((e) => e.id)).toEqual(['i6', 'i5']);

      component.loadMoreExpenses(); // page 2 → append [i4, i3]
      component.loadMoreExpenses(); // page 3 → append [i2, i1]
      expect(component.currentPage()).toBe(3);
      expect(component.expenses().map((e) => e.id)).toEqual([
        'i6',
        'i5',
        'i4',
        'i3',
        'i2',
        'i1',
      ]);
      expect(component.hasMoreExpenses()).toBe(false);

      // A new, newest-dated entry is created — it belongs at the FRONT of the
      // ordering, shifting every existing row down one position across pages.
      dataset = [row(7), row(6), row(5), row(4), row(3), row(2), row(1)];
      component.onExpenseCreated(); // → fetchExpenses('reload'): page 1, limit 3×2=6

      const idsAfter = component.expenses().map((e) => e.id);
      // New row is at the top; the loaded window is the newest 6 of 7.
      expect(idsAfter).toEqual(['i7', 'i6', 'i5', 'i4', 'i3', 'i2']);
      // No duplicates.
      expect(new Set(idsAfter).size).toBe(idsAfter.length);
      // Strictly descending → order preserved (no out-of-order rows).
      const nums = idsAfter.map((id) => Number(id.slice(1)));
      expect(nums).toEqual([...nums].sort((a, b) => b - a));
      // Count is refreshed and consistent; the row pushed off the window (i1) is
      // NOT lost — it is reachable because more remains.
      expect(component.totalExpenses()).toBe(7);
      expect(component.currentPage()).toBe(3);
      expect(component.hasMoreExpenses()).toBe(true);

      // Subsequent load-more brings the shifted row back with no duplication.
      component.loadMoreExpenses(); // page 4 → [i1]
      const finalIds = component.expenses().map((e) => e.id);
      expect(finalIds).toEqual(['i7', 'i6', 'i5', 'i4', 'i3', 'i2', 'i1']);
      expect(new Set(finalIds).size).toBe(finalIds.length);
      expect(component.hasMoreExpenses()).toBe(false);
    });

    it('reload clamps currentPage to the last page still holding data when a delete empties the final page', () => {
      dataset = [row(4), row(3), row(2), row(1)]; // 4 rows
      wireSlicingBackend();
      component.pageSize.set(2);

      fixture.detectChanges();
      // Pretend the user had scrolled to page 3 (only 2 pages of data exist).
      component.currentPage.set(3);

      component.fetchExpenses('group-1', 'reload'); // page 1, limit 3×2=6 → all 4

      expect(component.expenses().map((e) => e.id)).toEqual([
        'i4',
        'i3',
        'i2',
        'i1',
      ]);
      // ceil(4 / 2) = 2 → clamped from 3 so the user is never stranded past the end.
      expect(component.currentPage()).toBe(2);
      expect(component.totalExpenses()).toBe(4);
    });
  });

  describe('household month date filter', () => {
    it('requests a valid last-day-of-month endDate (never YYYY-MM-31 for short months)', () => {
      fixture.detectChanges(); // loads the household group
      (mockExpensesService.getExpenses as jest.Mock).mockClear();

      // June has 30 days — the old code emitted 2026-06-31, which 500s.
      component.currentTimelineMonth.set(new Date(2026, 5, 15));
      component.fetchExpenses('group-1');

      expect(mockExpensesService.getExpenses).toHaveBeenCalledWith(
        'group-1',
        expect.objectContaining({
          startDate: '2026-06-01',
          endDate: '2026-06-30',
        }),
      );
    });

    it('handles February (28 days) correctly', () => {
      fixture.detectChanges();
      (mockExpensesService.getExpenses as jest.Mock).mockClear();

      component.currentTimelineMonth.set(new Date(2026, 1, 10));
      component.fetchExpenses('group-1');

      expect(mockExpensesService.getExpenses).toHaveBeenCalledWith(
        'group-1',
        expect.objectContaining({
          startDate: '2026-02-01',
          endDate: '2026-02-28',
        }),
      );
    });

    it('shows the month navigator only for single-calendar-month date filters', () => {
      fixture.detectChanges(); // loads the household group (default This Month)
      expect(component.showMonthNav()).toBe(true);

      component.filterStore.openDraft();
      component.filterStore.setDraftPreset('last_30_days');
      component.filterStore.apply();
      expect(component.showMonthNav()).toBe(false);

      component.filterStore.setDraftPreset('last_month');
      component.filterStore.apply();
      expect(component.showMonthNav()).toBe(true);
    });

    it('does not reset an arrow-navigated month when an unrelated filter changes', () => {
      fixture.detectChanges();
      // Navigate back to June via the arrows.
      component.currentTimelineMonth.set(new Date(2026, 5, 1));

      // Change only the category through the drawer (date preset unchanged).
      component.filterStore.openDraft();
      component.filterStore.toggleDraftCategory('Food & Drinks');
      component.applyFilterDrawer();

      // The navigated month must be preserved (not re-anchored to the current month).
      expect(component.currentTimelineMonth().getMonth()).toBe(5);
    });
  });

  describe('infinite scroll history', () => {
    const log1 = { id: 'log-1', action: 'expense.created' };
    const log2 = { id: 'log-2', action: 'expense.updated' };

    beforeEach(() => {
      // History data is lazy — these tests exercise it, so open the History tab
      // (deep-link) before the initial detectChanges triggers the first load.
      mockActivatedRoute.queryParams = of({ tab: 'history' });
      mockActivatedRoute.snapshot.queryParams = { tab: 'history' };
    });

    it('appends the next page and increments historyPage', () => {
      mockGroupsService.getHistoryLogs = jest
        .fn()
        .mockReturnValueOnce(of({ data: [log1], meta: { totalItems: 2 } }))
        .mockReturnValueOnce(of({ data: [log2], meta: { totalItems: 2 } }))
        .mockReturnValue(of({ data: [], meta: { totalItems: 2 } })) as any;

      fixture.detectChanges();

      expect(component.historyLogs().length).toBe(1);
      expect(component.hasMoreHistory()).toBe(true);

      component.loadMoreHistory();

      expect(component.historyPage()).toBe(2);
      expect(component.historyLogs().map((l) => l.id)).toEqual([
        'log-1',
        'log-2',
      ]);
      expect(mockGroupsService.getHistoryLogs).toHaveBeenLastCalledWith(
        'group-1',
        2,
        20,
        expect.anything(),
      );
      expect(component.hasMoreHistory()).toBe(false);
    });

    it('does not fetch more when every page is already loaded', () => {
      mockGroupsService.getHistoryLogs = jest
        .fn()
        .mockReturnValue(of({ data: [log1], meta: { totalItems: 1 } })) as any;
      fixture.detectChanges();
      (mockGroupsService.getHistoryLogs as jest.Mock).mockClear();

      component.loadMoreHistory();

      expect(component.hasMoreHistory()).toBe(false);
      expect(mockGroupsService.getHistoryLogs).not.toHaveBeenCalled();
    });

    it('triggers loadMoreHistory via onHistoryScroll near the bottom', () => {
      mockGroupsService.getHistoryLogs = jest
        .fn()
        .mockReturnValue(of({ data: [log1], meta: { totalItems: 2 } })) as any;
      fixture.detectChanges();
      const spy = jest.spyOn(component, 'loadMoreHistory');

      const target = {
        scrollHeight: 900,
        scrollTop: 750,
        clientHeight: 100,
      } as HTMLElement;
      component.onHistoryScroll({ target } as unknown as Event);

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('ledger export date range', () => {
    const pad = (n: number) => String(n).padStart(2, '0');

    beforeEach(() => {
      component.group.set(mockGroup as any);
    });

    it('opens the modal defaulting to the current month', () => {
      component.openExportModal();

      expect(component.showExportModal()).toBe(true);
      expect(component.exportRangeMode()).toBe('month');
      const now = new Date();
      expect(component.exportFromDate()).toBe(
        `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
      );
    });

    it('exports only the current month by default (not the whole ledger)', async () => {
      const spy = jest
        .spyOn((component as any).expenseExportService, 'exportExpenses')
        .mockResolvedValue(undefined);

      component.openExportModal();
      await component.exportLedger();

      const now = new Date();
      const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
      const lastDay = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
      ).getDate();
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'group-1',
          type: 'group',
          from: `${month}-01`,
          to: `${month}-${pad(lastDay)}`,
        }),
        'xlsx',
        expect.any(String),
      );
      expect(component.showExportModal()).toBe(false);
    });

    it('exports the picked custom range', async () => {
      const spy = jest
        .spyOn((component as any).expenseExportService, 'exportExpenses')
        .mockResolvedValue(undefined);

      component.openExportModal();
      component.exportRangeMode.set('custom');
      component.exportFromDate.set('2026-05-01');
      component.exportToDate.set('2026-05-15');
      await component.exportLedger();

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2026-05-01', to: '2026-05-15' }),
        'xlsx',
        expect.any(String),
      );
    });

    it('rejects an inverted custom range without calling the export service', async () => {
      const spy = jest
        .spyOn((component as any).expenseExportService, 'exportExpenses')
        .mockResolvedValue(undefined);

      component.openExportModal();
      component.exportRangeMode.set('custom');
      component.exportFromDate.set('2026-05-20');
      component.exportToDate.set('2026-05-01');
      await component.exportLedger();

      expect(component.exportError()).toContain('from');
      expect(spy).not.toHaveBeenCalled();
      expect(component.showExportModal()).toBe(true);
    });
  });

  it('should handle toggle of contribution mode', () => {
    fixture.detectChanges();
    expect(component.contributionMode).toBe('amount');

    component.setContributionMode('percentage');
    expect(component.contributionMode).toBe('percentage');
  });

  it('should distribute remaining percentage to the member with max amount in amount mode', () => {
    fixture.detectChanges();
    component.contributionsList = [
      { memberId: 'm1', displayName: 'User 1', amount: 3, percentage: 0 },
      { memberId: 'm2', displayName: 'User 2', amount: 3, percentage: 0 },
      { memberId: 'm3', displayName: 'User 3', amount: 3, percentage: 0 },
    ];

    // 3 / 9 = 33.333... %
    // Rounding makes: 33.33%, 33.33%, 33.33% = 99.99%.
    // Difference is 0.01%, which should go to the member with max amount.
    // In our tie-breaker logic, the first member with max amount receives it.
    component.calculatePercentagesFromAmounts();

    expect(component.getContributionsSum()).toBe(100);
    // Let's verify how the remainder is distributed
    const p1 = component.contributionsList[0].percentage;
    const p2 = component.contributionsList[1].percentage;
    const p3 = component.contributionsList[2].percentage;

    expect(p1 + p2 + p3).toBe(100);
    expect(p1).toBe(33.34); // Got the +0.01% remainder
    expect(p2).toBe(33.33);
    expect(p3).toBe(33.33);
  });

  it('should correctly evaluate role-changing capabilities', () => {
    jest.spyOn(component, 'getCurrentUserId').mockReturnValue('user-admin');
    fixture.detectChanges(); // sets currentUserId, caller role is admin

    const contributor = mockMembers.find((m) => m.role === 'member')!;
    const owner = mockMembers.find((m) => m.role === 'owner')!;
    const otherAdmin = mockMembers.find((m) => m.role === 'admin')!;

    expect(component.canChangeRole(contributor)).toBe(true);
    expect(component.canChangeRole(owner)).toBe(true);
    expect(component.canChangeRole(otherAdmin)).toBe(true);

    // Switch caller to owner (set currentUserId signal directly)
    component.currentUserId.set('user-owner');
    jest.spyOn(component, 'getCallerRole').mockReturnValue('owner');
    expect(component.canChangeRole(otherAdmin)).toBe(true);
  });

  it('should call updateMember when updateMemberRole is called', () => {
    fixture.detectChanges();
    const contributor = mockMembers.find((m) => m.role === 'member')!;

    // `updateMemberRole` accepts `Event | string`; pass a string to avoid Event typing issues in unit tests
    component.updateMemberRole(contributor, 'admin');

    expect(mockGroupsService.updateMember).toHaveBeenCalledWith(
      'group-1',
      contributor.id,
      { role: 'admin' },
    );
  });

  it('should call removeMember when removeOrRevokeMember is confirmed', () => {
    fixture.detectChanges();
    const contributor = mockMembers.find((m) => m.role === 'member')!;
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    component.removeOrRevokeMember(contributor);

    expect(mockGroupsService.removeMember).toHaveBeenCalledWith(
      'group-1',
      contributor.id,
    );
  });

  it('should call initializeGroupKeysAndSelfHeal on members load', () => {
    const selfHealSpy = jest
      .spyOn(component, 'initializeGroupKeysAndSelfHeal')
      .mockResolvedValue();
    fixture.detectChanges(); // ngOnInit -> fetchMembers
    expect(selfHealSpy).toHaveBeenCalledWith('group-1');
  });

  describe('archiveGroup (Delete Group)', () => {
    beforeEach(() => {
      fixture.detectChanges();
      // Ensure owner is current user
      jest.spyOn(component, 'getCurrentUserId').mockReturnValue('user-owner');
    });

    it('isOwner() returns true when current user is the owner', () => {
      expect(component.isOwner()).toBe(true);
    });

    it('isOwner() returns false when current user is an admin', () => {
      jest.spyOn(component, 'getCurrentUserId').mockReturnValue('user-admin');
      component.currentUserId.set('user-admin');
      expect(component.isOwner()).toBe(false);
    });

    it('openArchiveDialog() resets state and opens the dialog', () => {
      component.archiveConfirmName.set('stale');
      component.archiveReason.set('old reason');
      component.archiveError.set('old error');

      component.openArchiveDialog();

      expect(component.isArchiveDialogOpen()).toBe(true);
      expect(component.archiveConfirmName()).toBe('');
      expect(component.archiveReason()).toBe('');
      expect(component.archiveError()).toBe('');
    });

    it('closeArchiveDialog() closes and resets state', () => {
      component.isArchiveDialogOpen.set(true);
      component.archiveConfirmName.set('some name');

      component.closeArchiveDialog();

      expect(component.isArchiveDialogOpen()).toBe(false);
      expect(component.archiveConfirmName()).toBe('');
    });

    it('archiveNameMatches() is false when typed name does not match group name', () => {
      component.archiveConfirmName.set('Wrong Name');
      expect(component.archiveNameMatches()).toBe(false);
    });

    it('archiveNameMatches() is true when typed name exactly matches group name', () => {
      component.archiveConfirmName.set(mockGroup.name);
      expect(component.archiveNameMatches()).toBe(true);
    });

    it('confirmArchiveGroup() does nothing if names do not match', () => {
      (mockGroupsService as any).archiveGroup = jest
        .fn()
        .mockReturnValue(of({}));
      component.archiveConfirmName.set('wrong');

      component.confirmArchiveGroup();

      expect((mockGroupsService as any).archiveGroup).not.toHaveBeenCalled();
    });

    it('confirmArchiveGroup() calls archiveGroup and navigates to /groups on success', () => {
      const archivedGroup = { ...mockGroup, isArchived: true };
      (mockGroupsService as any).archiveGroup = jest
        .fn()
        .mockReturnValue(of(archivedGroup));
      component.archiveConfirmName.set(mockGroup.name);
      component.archiveReason.set('no longer needed');

      const routerSpy = jest
        .spyOn(component['router'], 'navigate')
        .mockResolvedValue(true);

      component.confirmArchiveGroup();

      expect((mockGroupsService as any).archiveGroup).toHaveBeenCalledWith(
        mockGroup.id,
        'no longer needed',
      );
      expect(routerSpy).toHaveBeenCalledWith(['/groups']);
    });

    it('confirmArchiveGroup() sets archiveError on failure', () => {
      const { throwError } = require('rxjs');
      (mockGroupsService as any).archiveGroup = jest
        .fn()
        .mockReturnValue(
          throwError(() => ({ error: { message: 'Server error' } })),
        );
      component.archiveConfirmName.set(mockGroup.name);

      component.confirmArchiveGroup();

      expect(component.archiveError()).toBe('Server error');
      expect(component.isArchiving()).toBe(false);
    });
  });

  // ── Phase 2.1: Carry-Forward rendering (groupMemberId tracking) ──────────

  describe('Carry-Forward widget rendering', () => {
    /** Scopes to the carry-forward widget's rows, avoiding ambiguous shared classes. */
    const getCarryForwardRows = (): HTMLElement[] => {
      const heading = Array.from(
        fixture.nativeElement.querySelectorAll('h3'),
      ).find((h: any) =>
        h.textContent.includes('Household Target vs. Actual Contribution'),
      ) as HTMLElement | undefined;
      if (!heading) return [];
      const rowsContainer = heading.nextElementSibling as HTMLElement | null;
      if (!rowsContainer) return [];
      return Array.from(rowsContainer.children) as HTMLElement[];
    };

    it('renders one row for a single registered member', () => {
      mockGroupsService.getCarryForward = jest.fn().mockReturnValue(
        of([
          {
            groupMemberId: 'member-owner',
            userId: 'user-owner',
            displayName: 'Owner User',
            paid: 100,
            expected: 100,
            netBalance: 0,
            percentage: 50,
            currency: 'USD',
          },
        ]),
      );

      fixture.detectChanges();

      const rows = getCarryForwardRows();
      expect(rows.length).toBe(1);
      expect(rows[0].textContent).toContain('Owner User');
    });

    it('renders one row for a single pending member (userId null)', () => {
      mockGroupsService.getCarryForward = jest.fn().mockReturnValue(
        of([
          {
            groupMemberId: 'gm-pending-1',
            userId: null,
            displayName: 'Pending Person',
            paid: 0,
            expected: 100,
            netBalance: -100,
            percentage: 50,
            currency: 'USD',
          },
        ]),
      );

      fixture.detectChanges();

      const rows = getCarryForwardRows();
      expect(rows.length).toBe(1);
      expect(rows[0].textContent).toContain('Pending Person');
    });

    it('renders multiple pending members independently (no duplicate/missing DOM nodes when userId is null for all)', () => {
      mockGroupsService.getCarryForward = jest.fn().mockReturnValue(
        of([
          {
            groupMemberId: 'gm-pending-1',
            userId: null,
            displayName: 'Pending One',
            paid: 0,
            expected: 50,
            netBalance: -50,
            percentage: 25,
            currency: 'USD',
          },
          {
            groupMemberId: 'gm-pending-2',
            userId: null,
            displayName: 'Pending Two',
            paid: 0,
            expected: 50,
            netBalance: -50,
            percentage: 25,
            currency: 'USD',
          },
        ]),
      );

      fixture.detectChanges();

      const rows = getCarryForwardRows();
      // Both rows must render distinctly — a stale `track m.userId` would
      // collapse these (both userId: null) into a single tracked entry.
      expect(rows.length).toBe(2);
      expect(rows[0].textContent).toContain('Pending One');
      expect(rows[1].textContent).toContain('Pending Two');
    });

    it('renders correctly for a mixed household (registered + pending members)', () => {
      mockGroupsService.getCarryForward = jest.fn().mockReturnValue(
        of([
          {
            groupMemberId: 'member-owner',
            userId: 'user-owner',
            displayName: 'Owner User',
            paid: 100,
            expected: 50,
            netBalance: 50,
            percentage: 50,
            currency: 'USD',
          },
          {
            groupMemberId: 'gm-pending-1',
            userId: null,
            displayName: 'Pending Person',
            paid: 0,
            expected: 50,
            netBalance: -50,
            percentage: 50,
            currency: 'USD',
          },
        ]),
      );

      fixture.detectChanges();

      const rows = getCarryForwardRows();
      expect(rows.length).toBe(2);
      expect(rows[0].textContent).toContain('Owner User');
      expect(rows[1].textContent).toContain('Pending Person');
    });

    it('is stable across a refresh with unchanged data (no duplicated DOM)', () => {
      const balances = [
        {
          groupMemberId: 'gm-pending-1',
          userId: null,
          displayName: 'Pending Person',
          paid: 0,
          expected: 100,
          netBalance: -100,
          percentage: 50,
          currency: 'USD',
        },
      ];
      mockGroupsService.getCarryForward = jest
        .fn()
        .mockReturnValue(of(balances));

      fixture.detectChanges();
      expect(getCarryForwardRows().length).toBe(1);

      // Simulate a refresh (e.g. polling / re-navigation) with identical data
      component.fetchCarryForward('group-1');
      fixture.detectChanges();

      const rows = getCarryForwardRows();
      expect(rows.length).toBe(1);
      expect(rows[0].textContent).toContain('Pending Person');
    });

    it('is stable across a direct signal update (no duplicated DOM, correct final state)', () => {
      mockGroupsService.getCarryForward = jest.fn().mockReturnValue(
        of([
          {
            groupMemberId: 'gm-pending-1',
            userId: null,
            displayName: 'Pending One',
            paid: 0,
            expected: 50,
            netBalance: -50,
            percentage: 50,
            currency: 'USD',
          },
        ]),
      );
      fixture.detectChanges();
      expect(getCarryForwardRows().length).toBe(1);

      // Update the signal directly with a new set of pending members
      component.carryForwardBalances.set([
        {
          groupMemberId: 'gm-pending-1',
          userId: null,
          displayName: 'Pending One',
          paid: 25,
          expected: 50,
          netBalance: -25,
          percentage: 50,
          currency: 'USD',
        } as any,
        {
          groupMemberId: 'gm-pending-2',
          userId: null,
          displayName: 'Pending Two',
          paid: 0,
          expected: 50,
          netBalance: -50,
          percentage: 50,
          currency: 'USD',
        } as any,
      ]);
      fixture.detectChanges();

      const rows = getCarryForwardRows();
      expect(rows.length).toBe(2);
      expect(rows[0].textContent).toContain('Pending One');
      expect(rows[1].textContent).toContain('Pending Two');
    });

    it('regression: registered-only household renders exactly as before', () => {
      mockGroupsService.getCarryForward = jest.fn().mockReturnValue(
        of([
          {
            groupMemberId: 'member-owner',
            userId: 'user-owner',
            displayName: 'Owner User',
            paid: 150,
            expected: 75,
            netBalance: 75,
            percentage: 50,
            currency: 'USD',
          },
          {
            groupMemberId: 'member-admin',
            userId: 'user-admin',
            displayName: 'Admin User',
            paid: 0,
            expected: 75,
            netBalance: -75,
            percentage: 50,
            currency: 'USD',
          },
        ]),
      );

      fixture.detectChanges();

      const rows = getCarryForwardRows();
      expect(rows.length).toBe(2);
      expect(rows[0].textContent).toContain('Owner User');
      expect(rows[0].textContent).toContain('+$75.00');
      expect(rows[1].textContent).toContain('Admin User');
      expect(rows[1].textContent).toContain('-$75.00');
    });
  });

  // ── Issue 1: month-aware export (viewed period, never the system month) ──────
  describe('month-aware export', () => {
    const pad = (n: number) => String(n).padStart(2, '0');
    let exportSpy: jest.SpyInstance;

    beforeEach(() => {
      // Household group → the month navigator (currentTimelineMonth) is active,
      // so effectiveDateRange follows the on-screen month.
      component.group.set(mockGroup as any);
      exportSpy = jest
        .spyOn((component as any).expenseExportService, 'exportExpenses')
        .mockResolvedValue(undefined);
    });

    /** Drive the household month navigator to a specific calendar month. */
    const viewMonth = (year: number, month1: number) =>
      component.currentTimelineMonth.set(new Date(year, month1 - 1, 1));

    it('exports the current month when viewing the current month', async () => {
      const now = new Date();
      viewMonth(now.getFullYear(), now.getMonth() + 1);

      component.openExportModal();
      await component.exportLedger();

      const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
      const lastDay = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
      ).getDate();
      expect(exportSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          from: `${month}-01`,
          to: `${month}-${pad(lastDay)}`,
        }),
        'xlsx',
        expect.any(String),
      );
    });

    it('exports the previous month (July 2026) when the user navigated back', async () => {
      viewMonth(2026, 7);

      component.openExportModal();
      await component.exportLedger();

      expect(exportSpy).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2026-07-01', to: '2026-07-31' }),
        'xlsx',
        expect.stringContaining('July-2026'),
      );
    });

    it('exports an older month (June 2026) when viewing it', async () => {
      viewMonth(2026, 6);

      component.openExportModal();
      await component.exportLedger();

      expect(exportSpy).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2026-06-01', to: '2026-06-30' }),
        'xlsx',
        expect.stringContaining('June-2026'),
      );
    });

    it('updates the export period when the viewed month changes', async () => {
      viewMonth(2026, 7);
      component.openExportModal();
      await component.exportLedger();
      expect(exportSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: '2026-07-01', to: '2026-07-31' }),
        'xlsx',
        expect.anything(),
      );

      viewMonth(2026, 6);
      component.openExportModal();
      await component.exportLedger();
      expect(exportSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: '2026-06-01', to: '2026-06-30' }),
        'xlsx',
        expect.anything(),
      );
    });

    it('never silently falls back to the system current month', async () => {
      // A month guaranteed to differ from the real system month (one year back).
      const now = new Date();
      const target = new Date(now.getFullYear() - 1, now.getMonth(), 1);
      viewMonth(target.getFullYear(), target.getMonth() + 1);

      component.openExportModal();
      await component.exportLedger();

      const call = exportSpy.mock.calls.at(-1)![0];
      const systemMonthFrom = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
      const targetMonth = `${target.getFullYear()}-${pad(target.getMonth() + 1)}`;
      expect(call.from).not.toBe(systemMonthFrom);
      expect(call.from).toBe(`${targetMonth}-01`);
    });

    it('preserves the group scope in the export filter', async () => {
      viewMonth(2026, 7);
      component.openExportModal();
      await component.exportLedger();

      const call = exportSpy.mock.calls.at(-1)![0];
      expect(call.groupId).toBe('group-1');
      expect(call.type).toBe('group');
    });

    it('exportPeriodLabel names the viewed month', () => {
      viewMonth(2026, 7);
      expect(component.exportPeriodLabel()).toBe('July 2026');
    });
  });

  // ── Issue 2: pagination stays consistent after add/update/delete ─────────────
  describe('pagination consistency after mutations (infinite scroll)', () => {
    /** Backend-accurate paging mock over a mutable master list. */
    const makeLedgerMock = (master: () => any[], total: () => number) =>
      jest.fn().mockImplementation((_gid: string, opts: any) => {
        const page = opts.page ?? 1;
        const limit = opts.limit ?? 20;
        const start = (page - 1) * limit;
        return of({
          data: master().slice(start, start + limit),
          meta: { totalItems: total() },
        });
      });

    const item = (n: number) => ({
      id: `exp-${n}`,
      title: `E${n}`,
      amountTotal: n,
    });

    const lastCallOpts = () =>
      (mockExpensesService.getExpenses as jest.Mock).mock.calls.at(-1)![1];

    beforeEach(() => {
      // Small pages keep the fixtures readable (2 items per page).
      component.pageSize.set(2);
    });

    it('after ADD on page 3, keeps the user on page 3 and reloads pages 1..3 in one request', () => {
      let master = [1, 2, 3, 4, 5, 6].map(item);
      mockExpensesService.getExpenses = makeLedgerMock(
        () => master,
        () => master.length,
      ) as any;

      fixture.detectChanges(); // page 1
      component.loadMoreExpenses(); // page 2
      component.loadMoreExpenses(); // page 3
      expect(component.currentPage()).toBe(3);
      expect(component.expenses().length).toBe(6);

      // Add: the newest expense lands at the top of the ledger (date desc).
      master = [item(0), ...master]; // total 7
      const callsBefore = (mockExpensesService.getExpenses as jest.Mock).mock
        .calls.length;
      component.onExpenseCreated();

      // Exactly one authoritative reload for pages 1..3 (page 1, limit 3×2).
      expect(
        (mockExpensesService.getExpenses as jest.Mock).mock.calls.length,
      ).toBe(callsBefore + 1);
      expect(lastCallOpts()).toEqual(
        expect.objectContaining({ page: 1, limit: 6 }),
      );

      // Stays on page 3 (not bounced to page 1); newest is present; no stale
      // page mixing and no duplicates; total count refreshed.
      expect(component.currentPage()).toBe(3);
      expect(component.expenses().map((e) => e.id)).toEqual([
        'exp-0',
        'exp-1',
        'exp-2',
        'exp-3',
        'exp-4',
        'exp-5',
      ]);
      expect(new Set(component.expenses().map((e) => e.id)).size).toBe(6);
      expect(component.totalExpenses()).toBe(7);
    });

    it('after UPDATE, stays on the same page and preserves month/filter/sort in the reload', () => {
      const master = [1, 2, 3, 4].map(item);
      mockExpensesService.getExpenses = makeLedgerMock(
        () => master,
        () => master.length,
      ) as any;

      fixture.detectChanges(); // default load, page 1

      // Switch to a non-default month + sort through the drawer, then scroll.
      component.filterStore.openDraft();
      component.filterStore.setDraftPreset('last_month');
      component.filterStore.setDraftSort('amount', 'asc');
      component.applyFilterDrawer();
      fixture.detectChanges(); // applied() effect resets to page 1 + refetches
      expect(component.currentPage()).toBe(1);

      component.loadMoreExpenses(); // page 2
      expect(component.currentPage()).toBe(2);

      (mockExpensesService.getExpenses as jest.Mock).mockClear();
      component.onExpenseCreated(); // an edit refreshes via the same path

      expect(component.currentPage()).toBe(2);
      expect(lastCallOpts()).toEqual(
        expect.objectContaining({
          page: 1,
          limit: 4,
          sortBy: 'amount',
          sortOrder: 'asc',
        }),
      );
    });

    it('after deleting a middle item, stays on the page with a refreshed, de-duplicated list', () => {
      let master = [1, 2, 3, 4, 5, 6].map(item);
      mockExpensesService.getExpenses = makeLedgerMock(
        () => master,
        () => master.length,
      ) as any;
      mockExpensesService.deleteExpense = jest
        .fn()
        .mockReturnValue(of(undefined)) as any;

      fixture.detectChanges();
      component.loadMoreExpenses();
      component.loadMoreExpenses(); // page 3, 6 items
      expect(component.currentPage()).toBe(3);

      master = master.filter((e) => e.id !== 'exp-3'); // remove a middle item
      component.deleteExpenseId.set('exp-3');
      component.onDeleteConfirmed();

      expect(component.currentPage()).toBe(3);
      const ids = component.expenses().map((e) => e.id);
      expect(ids).toEqual(['exp-1', 'exp-2', 'exp-4', 'exp-5', 'exp-6']);
      expect(new Set(ids).size).toBe(ids.length);
      expect(component.totalExpenses()).toBe(5);
    });

    it('after deleting the final item on the final page, moves to the previous valid page', () => {
      let master = [1, 2, 3, 4, 5].map(item); // 3 pages (2,2,1)
      mockExpensesService.getExpenses = makeLedgerMock(
        () => master,
        () => master.length,
      ) as any;
      mockExpensesService.deleteExpense = jest
        .fn()
        .mockReturnValue(of(undefined)) as any;

      fixture.detectChanges(); // page 1 [1,2]
      component.loadMoreExpenses(); // page 2 [3,4]
      component.loadMoreExpenses(); // page 3 [5]
      expect(component.currentPage()).toBe(3);
      expect(component.expenses().length).toBe(5);

      master = master.filter((e) => e.id !== 'exp-5'); // 4 items → 2 pages
      component.deleteExpenseId.set('exp-5');
      component.onDeleteConfirmed();

      // Page 3 became invalid → clamped to the new last valid page (2).
      expect(component.currentPage()).toBe(2);
      expect(component.expenses().map((e) => e.id)).toEqual([
        'exp-1',
        'exp-2',
        'exp-3',
        'exp-4',
      ]);
      expect(component.totalExpenses()).toBe(4);
    });

    it('resets to page 1 when the household month navigator changes month', () => {
      const master = [1, 2, 3, 4].map(item);
      mockExpensesService.getExpenses = makeLedgerMock(
        () => master,
        () => master.length,
      ) as any;

      fixture.detectChanges();
      component.loadMoreExpenses(); // page 2
      expect(component.currentPage()).toBe(2);

      component.changeMonth(-1); // navigate to the previous month

      expect(component.currentPage()).toBe(1);
      expect(lastCallOpts()).toEqual(
        expect.objectContaining({ page: 1, limit: 2 }),
      );
    });
  });

  // ── TAG-BATCH-B1 — tag visibility on rows + chart→filter interaction ─────────
  describe('tag visibility + filtering (TAG-BATCH-B1)', () => {
    beforeEach(() => {
      mockExpensesService.getTaxonomy.mockReturnValue(
        of([
          {
            id: 'milk',
            canonicalName: 'Milk',
            normalizedKey: 'milk',
            parentId: 'dairy',
            status: 'active',
            version: 1,
          },
          {
            id: 'grocery',
            canonicalName: 'Grocery',
            normalizedKey: 'grocery',
            status: 'active',
            version: 1,
          },
        ]),
      );
      // Reload the taxonomy map now that the mock returns tags.
      (component as unknown as { loadTaxonomy(): void }).loadTaxonomy();
    });

    it('renders resolved tag chips, dropping unknown/deprecated ids safely', () => {
      const exp = {
        id: 'e1',
        tags: [
          { tagId: 'milk', authority: 'USER_CONFIRMED', source: 'user' },
          { tagId: 'grocery', authority: 'INFERRED', source: 'rule_based' },
          { tagId: 'zzz-unknown', authority: 'INFERRED', source: 'rule_based' },
        ],
      } as never;
      const chips = component.rowTagChips(exp);
      // Unknown id dropped; user-authored (milk) sorts before inferred (grocery).
      expect(chips.map((c) => c.label)).toEqual(['Milk', 'Grocery']);
      expect(chips.find((c) => c.tagId === 'grocery')?.inferred).toBe(true);
      expect(chips.find((c) => c.tagId === 'milk')?.inferred).toBe(false);
    });

    it('renders safely for expenses with missing or empty tags', () => {
      expect(component.rowTagChips({ id: 'e' } as never)).toEqual([]);
      expect(
        component.rowTagOverflowCount({ id: 'e', tags: [] } as never),
      ).toBe(0);
    });

    it('applyTagFromChip adds the tag to the unified filter, preserving other dimensions', () => {
      component.filterStore.initialize({
        date: { preset: 'this_month' },
        categories: ['Food'],
        transactionType: 'both',
      } as never);
      component.applyTagFromChip('milk');
      expect(component.filterStore.applied().tagIds).toEqual(['milk']);
      expect(component.filterStore.applied().categories).toEqual(['Food']);
    });

    it('applyTagFromChip is a no-op when the tag is already applied (no duplicate state)', () => {
      component.filterStore.initialize({
        date: { preset: 'this_month' },
        tagIds: ['milk'],
        transactionType: 'both',
      } as never);
      const applySpy = jest.spyOn(component.filterStore, 'apply');
      component.applyTagFromChip('milk');
      expect(applySpy).not.toHaveBeenCalled();
    });

    it('onAnalyticsTagSelected applies the tag and switches to the ledger tab', () => {
      const setTabSpy = jest
        .spyOn(component, 'setTab')
        .mockImplementation(() => undefined);
      component.filterStore.initialize({
        date: { preset: 'this_month' },
        transactionType: 'both',
      } as never);
      component.onAnalyticsTagSelected('grocery');
      expect(component.filterStore.applied().tagIds).toEqual(['grocery']);
      expect(setTabSpy).toHaveBeenCalledWith('ledger');
    });
  });
});
