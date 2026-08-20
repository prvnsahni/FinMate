import {
  Component,
  inject,
  OnInit,
  DestroyRef,
  signal,
  computed,
  effect,
  untracked,
  ViewChild,
  ElementRef,
  AfterViewInit,
  HostListener,
} from '@angular/core';
import {
  CurrencyPipe,
  DatePipe,
  DecimalPipe,
  NgTemplateOutlet,
} from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CreateExpenseModalComponent } from '../../components/create-expense-modal/create-expense-modal.component';
import { RecurringExpenseFormComponent } from '../../components/recurring-expense-form/recurring-expense-form.component';
import { RecurringExpensesService } from '../../services/recurring-expenses.service';
import { jwtDecode } from 'jwt-decode';
import { FormsModule } from '@angular/forms';
import { AnalyticsChartsComponent } from '../../components/analytics-charts/analytics-charts.component';
import { ConfirmModalComponent } from '../../../../shared/components/confirm-modal/confirm-modal.component';
import {
  GroupsService,
  GroupBalanceBreakdown,
} from '../../services/groups.service';
import {
  ExpensesService,
  GroupAnalyticsQuery,
} from '../../services/expenses.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  DropdownComponent,
  DropdownOption,
} from '../../../../shared/components/dropdown/dropdown.component';
import { Store } from '@ngxs/store';
import { ClientEncryptionService } from '../../../../core/services/encryption.service';
import { GroupKeyService } from '../../../../core/services/group-key.service';
import { DECRYPTION_FAILED_PLACEHOLDER } from '../../../../core/constants/crypto.constants';
import { MONTH_LOCK_DAY } from '../../../../core/constants/app.constants';
import { ExpenseDecryptCoordinator } from '../../../../core/services/expense-decrypt-coordinator.service';
import { ExpenseDecryptionService } from '../../../../core/services/expense-decryption.service';
import { classifyDecryptionError } from '../../../../core/models/decryption-state';
import { CryptoSessionManager } from '../../../../core/services/crypto-session-manager.service';
import { CryptoRecoveryQueueService } from '../../../../core/services/crypto-recovery-queue.service';
import { ExpenseExportService } from '../../../dashboard/services/expense-export.service';
import { ExportFilter } from '../../../dashboard/services/export/expense-export.types';

import {
  BalanceEntry,
  CarryForwardBalance,
  Expense,
  ExpenseSplitInputDto,
  Group,
  simplifyLedgerDebts,
  GroupContributionResponse,
  GroupMember,
  JwtPayload,
} from '@finmate/data-models';

import {
  GroupHistoryLogComponent,
  GroupAuditLog,
} from '../../components/group-history-log/group-history-log.component';
import { GroupTrashComponent } from '../../components/group-trash/group-trash.component';
import { SuggestedSettlement } from '../../components/group-balances/group-balances.component';
import { BalanceCarouselComponent } from '../../components/balance-cards/balance-carousel.component';
import { SuggestedSettlementsComponent } from '../../components/balance-cards/suggested-settlements.component';
import { GroupMembersComponent } from '../../components/group-members/group-members.component';
import { CryptoRecoveryPanelComponent } from '../../../../shared/components/crypto-recovery-panel/crypto-recovery-panel.component';
import {
  resolveMemberDisplayName,
  resolveUserDisplayName,
} from '../../utils/member-display.util';
import { GroupFilterStore } from '../../services/group-filter.store';
import {
  DatePreset,
  GroupFilter,
  TimeScope,
  filterFromQueryParams,
  filterToQueryParams,
} from '../../models/group-filter.model';
import { formatDateRangeLabel } from '../../utils/date-preset.util';

/** A single removable filter-summary chip. Per-value for multi-select dimensions. */
export interface FilterChip {
  kind: 'date' | 'category' | 'member' | 'paidBy' | 'type' | 'amount';
  key: string;
  label: string;
  value?: string;
}

export interface GroupExpense extends Expense {
  paidByUserId: string | null;
  paidByGroupMemberId?: string | null;
  ownerUserId: string;
  splits?: Array<
    ExpenseSplitInputDto & {
      participantUser?: {
        id: string;
        email: string;
        displayName?: string;
      };
      participantUserDisplayName?: string;
      participantUserEmail?: string;
      shareAmount?: number;
    }
  >;
  attachments?: Array<{
    storageKey: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
  }>;
}

/**
 * Scope-wide, pagination-independent monetary totals per currency, returned in
 * the expense listing's `meta.totals` (see backend `LedgerTotals`).
 */
export interface LedgerTotals {
  currency: string;
  totalExpense: number;
  totalRefund: number;
  net: number;
}

@Component({
  selector: 'app-group-detail',
  standalone: true,
  imports: [
    CurrencyPipe,
    DatePipe,
    RouterLink,
    CreateExpenseModalComponent,
    RecurringExpenseFormComponent,
    FormsModule,
    AnalyticsChartsComponent,
    ConfirmModalComponent,
    GroupHistoryLogComponent,
    GroupTrashComponent,
    BalanceCarouselComponent,
    SuggestedSettlementsComponent,
    GroupMembersComponent,
    DropdownComponent,
    CryptoRecoveryPanelComponent,
    DecimalPipe,
    NgTemplateOutlet,
  ],
  templateUrl: './group-detail.component.html',
  styleUrls: ['./group-detail.component.scss'],
  providers: [GroupFilterStore],
})
export class GroupDetailComponent implements OnInit, AfterViewInit {
  private groupsService = inject(GroupsService);
  private expensesService = inject(ExpensesService);
  private recurringExpensesService = inject(RecurringExpensesService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private encryptionService = inject(ClientEncryptionService);
  private groupKeyService = inject(GroupKeyService);
  private decryptCoordinator = inject(ExpenseDecryptCoordinator);
  private expenseDecryption = inject(ExpenseDecryptionService);
  private store = inject(Store);
  private cryptoSession = inject(CryptoSessionManager);
  private recoveryQueue = inject(CryptoRecoveryQueueService);
  private expenseExportService = inject(ExpenseExportService);
  /** Single source of truth for the unified group filter (component-scoped). */
  readonly filterStore = inject(GroupFilterStore);
  private retryCooldownIntervalId?: ReturnType<typeof setInterval>;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.retryCooldownIntervalId) {
        clearInterval(this.retryCooldownIntervalId);
        this.retryCooldownIntervalId = undefined;
      }
      // Cancel any in-flight decryption retry loop for this group.
      this.decryptCoordinator.stop();
    });

    // Whenever CryptoSessionManager reports the crypto session Ready —
    // whether from this page's own <app-crypto-recovery-panel> unlock, or
    // from another tab (BroadcastChannel) — re-run key provisioning and
    // decryption. initializeGroupKeysAndSelfHeal()/startDecryption() are
    // documented as safe to call repeatedly (cancel-and-restart, no server
    // round-trip), so this also harmlessly re-fires on a normal first-load
    // success; the alternative (tracking "already handled" state) isn't
    // worth the extra complexity for an idempotent operation.
    effect(() => {
      if (this.cryptoSession.isReady()) {
        const g = this.group();
        if (g?.id) {
          this.initializeGroupKeysAndSelfHeal(g.id);
        }
      }
    });

    // Whenever the applied filter changes, re-fetch every filter-driven surface
    // and mirror it into the URL (so refresh/deep-links restore it). The first
    // run is skipped: the initial fetch is owned by the route handlers (which
    // read the same store), so this effect only handles *subsequent* changes.
    // group()/currentPage are read untracked so it fires only on filter changes.
    let filterEffectPrimed = false;
    effect(() => {
      this.filterStore.applied();
      if (!filterEffectPrimed) {
        filterEffectPrimed = true;
        return;
      }
      untracked(() => {
        const g = this.group();
        if (!g?.id) return;
        this.syncFilterToUrl();
        this.currentPage.set(1);
        this.fetchExpenses(g.id);
        this.fetchBalances(g.id);
        // History and Trash honor the date period too (reset to page 1).
        this.fetchHistoryLogs(g.id);
        this.fetchDeletedExpenses(g.id);
        // Household contribution graph / period card follow the same TimeScope.
        if (g.groupType === 'household') {
          this.fetchCarryForward(g.id);
        }
      });
    });
  }

  filterCategoryOptions: DropdownOption[] = [
    { value: '', label: 'All Categories' },
    { value: 'Food & Drinks', label: 'Food & Drinks' },
    { value: 'Travel', label: 'Travel' },
    { value: 'Utilities', label: 'Utilities' },
    { value: 'Entertainment', label: 'Entertainment' },
    { value: 'Shopping', label: 'Shopping' },
    { value: 'Housing', label: 'Housing' },
    { value: 'Others', label: 'Others' },
  ];

  /** Date-preset options for the filter drawer (day-level first, then ranges). */
  readonly datePresetOptions: { value: DatePreset; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'last_7_days', label: 'Last 7 Days' },
    { value: 'last_30_days', label: 'Last 30 Days' },
    { value: 'this_month', label: 'This Month' },
    { value: 'last_month', label: 'Last Month' },
    { value: 'last_3_months', label: 'Last 3 Months' },
    { value: 'last_6_months', label: 'Last 6 Months' },
    { value: 'this_year', label: 'This Year' },
    { value: 'last_year', label: 'Last 1 Year' },
    { value: 'all_time', label: 'All Time' },
    { value: 'custom', label: 'Custom Range' },
  ];

  /** Member (participant) dropdown options, sourced from group members. */
  memberFilterOptions = computed<DropdownOption[]>(() => [
    { value: '', label: 'All Members' },
    ...this.members().map((m) => ({
      value: m.id,
      label: this.memberDisplayName(m),
    })),
  ]);

  /** Paid-by (payer) dropdown options, sourced from group members. */
  paidByFilterOptions = computed<DropdownOption[]>(() => [
    { value: '', label: 'Anyone' },
    ...this.members().map((m) => ({
      value: m.id,
      label: this.memberDisplayName(m),
    })),
  ]);

  /** Category pills for the multi-select drawer (the plain 7 categories). */
  readonly categoryPillOptions = this.filterCategoryOptions.slice(1);

  /** Member pills (id + display name) for the multi-select member/payer controls. */
  memberPillOptions = computed(() =>
    this.members().map((m) => ({
      value: m.id,
      label: this.memberDisplayName(m),
    })),
  );

  /** Sort options (field + direction combined into one dropdown value). */
  readonly sortOptions: DropdownOption[] = [
    { value: 'date_desc', label: 'Newest first' },
    { value: 'date_asc', label: 'Oldest first' },
    { value: 'amount_desc', label: 'Amount: high → low' },
    { value: 'amount_asc', label: 'Amount: low → high' },
  ];

  /** Current draft sort as a single `field_order` string for the dropdown. */
  draftSortValue = computed(() => {
    const d = this.filterStore.draft();
    return d.sortBy ? `${d.sortBy}_${d.sortOrder ?? 'desc'}` : 'date_desc';
  });

  onSortChange(value: string): void {
    const [by, order] = value.split('_') as ['date' | 'amount', 'asc' | 'desc'];
    this.filterStore.setDraftSort(by, order);
  }

  onDraftCategoriesChange(nextValues: string[]): void {
    this.syncDraftArray(
      this.filterStore.draft().categories ?? [],
      nextValues,
      (value) => this.filterStore.toggleDraftCategory(value),
    );
  }

  onDraftMembersChange(nextValues: string[]): void {
    this.syncDraftArray(
      this.filterStore.draft().memberIds ?? [],
      nextValues,
      (value) => this.filterStore.toggleDraftMember(value),
    );
  }

  onDraftPaidByChange(nextValues: string[]): void {
    this.syncDraftArray(
      this.filterStore.draft().paidByIds ?? [],
      nextValues,
      (value) => this.filterStore.toggleDraftPaidBy(value),
    );
  }

  private syncDraftArray(
    currentValues: string[],
    nextValues: string[],
    toggleValue: (value: string) => void,
  ): void {
    const nextSet = new Set(nextValues);
    for (const value of currentValues) {
      if (!nextSet.has(value)) toggleValue(value);
    }
    const currentSet = new Set(currentValues);
    for (const value of nextValues) {
      if (!currentSet.has(value)) toggleValue(value);
    }
  }

  /**
   * Date presets that represent a single calendar month. For a household group
   * these are the only states where the month ◀ ▶ navigator is meaningful (it
   * steps the navigated month); every other preset/custom range is a
   * multi-day/range state where the navigator is hidden to avoid two conflicting
   * date controls fighting over the same state.
   */
  private readonly MONTH_MODE_PRESETS: DatePreset[] = [
    'this_month',
    'last_month',
  ];

  /**
   * True when the household month navigator (◀ ▶) should be shown: household
   * group AND the applied date filter is a single calendar month. In every other
   * date state the date filter is the single source of truth and the arrows hide.
   */
  showMonthNav = computed(
    () =>
      this.group()?.groupType === 'household' &&
      this.MONTH_MODE_PRESETS.includes(this.filterStore.applied().date.preset),
  );

  /**
   * The effective date range every filter-driven surface should use. In household
   * "month mode" (This Month / Last Month) it follows the navigated month; every
   * other state uses the unified filter's resolved range. Recomputes on filter
   * change and, for household month mode, on month navigation.
   */
  effectiveDateRange = computed<{ from?: string; to?: string }>(() => {
    if (this.showMonthNav()) {
      const month = this.getCurrentMonthString();
      return {
        from: `${month}-01`,
        to: `${month}-${this.lastDayOfMonth(month)}`,
      };
    }
    return this.filterStore.resolvedRange();
  });

  /**
   * The single shared TimeScope for this page — the one object every date-driven
   * surface (header label, ledger, analytics, balance period card, suggested
   * settlements, household contribution graph, export) must read. It layers
   * household month navigation on top of the store's filter and derives the label
   * from the same `formatDateRangeLabel` generator, so the period and its label
   * are always consistent. Overall/all-time surfaces deliberately ignore it.
   */
  timeScope = computed<TimeScope>(() => {
    const { from, to } = this.effectiveDateRange();
    return {
      from,
      to,
      preset: this.filterStore.applied().date.preset,
      label: formatDateRangeLabel(
        this.filterStore.applied().date.preset,
        from,
        to,
      ),
    };
  });

  /**
   * Active (non-default) filters as removable summary chips. The date chip only
   * appears when the date is not the default (This Month).
   */
  activeFilterChips = computed<FilterChip[]>(() => {
    const f = this.filterStore.applied();
    const chips: FilterChip[] = [];
    if (f.date.preset !== 'this_month') {
      chips.push({
        kind: 'date',
        key: 'date',
        label: this.filterStore.dateRangeLabel(),
      });
    }
    for (const c of f.categories ?? []) {
      chips.push({ kind: 'category', key: 'cat:' + c, value: c, label: c });
    }
    for (const m of f.memberIds ?? []) {
      chips.push({
        kind: 'member',
        key: 'mem:' + m,
        value: m,
        label: 'Member: ' + this.memberNameById(m),
      });
    }
    for (const p of f.paidByIds ?? []) {
      chips.push({
        kind: 'paidBy',
        key: 'pb:' + p,
        value: p,
        label: 'Paid by: ' + this.memberNameById(p),
      });
    }
    if (f.transactionType && f.transactionType !== 'both') {
      chips.push({
        kind: 'type',
        key: 'type',
        label:
          f.transactionType === 'refund' ? 'Refunds only' : 'Expenses only',
      });
    }
    if (f.minAmount != null || f.maxAmount != null) {
      chips.push({
        kind: 'amount',
        key: 'amount',
        label: this.amountChipLabel(f),
      });
    }
    return chips;
  });

  private amountChipLabel(f: GroupFilter): string {
    const cur = this.group()?.currency ?? '';
    const fmt = (n: number) => `${cur} ${n}`.trim();
    if (f.minAmount != null && f.maxAmount != null) {
      return `${fmt(f.minAmount)} – ${fmt(f.maxAmount)}`;
    }
    if (f.minAmount != null) return `≥ ${fmt(f.minAmount)}`;
    return `≤ ${fmt(f.maxAmount as number)}`;
  }

  /** Display name for a group-member id (used by the member/payer chips). */
  memberNameById(id: string): string {
    const m = this.members().find((mem) => mem.id === id);
    return m ? this.memberDisplayName(m) : 'Unknown';
  }

  /** Remove one applied filter from its summary chip. */
  removeFilterChip(chip: FilterChip): void {
    switch (chip.kind) {
      case 'date':
        this.filterStore.clearAppliedDate();
        // Date reverted to This Month → re-anchor the household navigator.
        this.anchorHouseholdMonth();
        break;
      case 'category':
        if (chip.value) this.filterStore.removeAppliedCategory(chip.value);
        break;
      case 'member':
        if (chip.value) this.filterStore.removeAppliedMember(chip.value);
        break;
      case 'paidBy':
        if (chip.value) this.filterStore.removeAppliedPaidBy(chip.value);
        break;
      case 'type':
        this.filterStore.clearAppliedTxType();
        break;
      case 'amount':
        this.filterStore.clearAppliedAmount();
        break;
    }
  }

  /**
   * Re-anchor the household month navigator to match the applied date preset —
   * This Month → the current month, Last Month → the previous month. Called only
   * when the date preset actually changes (via Apply / chip removal / Clear all),
   * never on plain arrow navigation, so stepping through months isn't reset by
   * unrelated filter edits.
   */
  private anchorHouseholdMonth(): void {
    if (this.group()?.groupType !== 'household') return;
    const preset = this.filterStore.applied().date.preset;
    const now = new Date();
    if (preset === 'this_month') {
      this.currentTimelineMonth.set(
        new Date(now.getFullYear(), now.getMonth(), 1),
      );
    } else if (preset === 'last_month') {
      this.currentTimelineMonth.set(
        new Date(now.getFullYear(), now.getMonth() - 1, 1),
      );
    }
  }

  /**
   * Custom-range validity for the drawer: an explicit From must not be after an
   * explicit To. Incomplete ranges (only one bound) are allowed as open bounds.
   */
  draftDateRangeValid = computed(() => {
    const d = this.filterStore.draft().date;
    if (d.preset !== 'custom' || !d.from || !d.to) return true;
    return d.from <= d.to;
  });

  /**
   * The applied filter projected into the analytics query shape (resolved date
   * range + dimensions), passed to <app-analytics-charts>.
   */
  analyticsFilter = computed<GroupAnalyticsQuery>(() => {
    const applied = this.filterStore.applied();
    const { from, to } = this.effectiveDateRange();
    return {
      startDate: from,
      endDate: to,
      categories: applied.categories,
      memberIds: applied.memberIds,
      paidByIds: applied.paidByIds,
      transactionType:
        applied.transactionType === 'both'
          ? undefined
          : applied.transactionType,
      minAmount: applied.minAmount,
      maxAmount: applied.maxAmount,
    };
  });

  /** The applied dimension filters shared by the ledger, export and balances. */
  private appliedDimensionOptions() {
    const a = this.filterStore.applied();
    return {
      categories: a.categories,
      memberIds: a.memberIds,
      paidByIds: a.paidByIds,
      transactionType:
        a.transactionType === 'both' ? undefined : a.transactionType,
      minAmount: a.minAmount,
      maxAmount: a.maxAmount,
    };
  }

  /** Full filter options (effective date range + dimensions) for balances/trash. */
  private appliedFilterOptions() {
    const { from, to } = this.effectiveDateRange();
    return { from, to, ...this.appliedDimensionOptions() };
  }

  visibilityOptions: DropdownOption[] = [
    { value: 'private', label: 'Private' },
    { value: 'invite_only', label: 'Invite Only' },
    { value: 'public_readonly', label: 'Public Read-Only' },
  ];

  currencyOptions: DropdownOption[] = [
    { value: 'USD', label: 'USD ($)' },
    { value: 'EUR', label: 'EUR (€)' },
    { value: 'GBP', label: 'GBP (£)' },
    { value: 'INR', label: 'INR (₹)' },
    { value: 'CAD', label: 'CAD ($)' },
    { value: 'AUD', label: 'AUD ($)' },
    { value: 'JPY', label: 'JPY (¥)' },
  ];

  memberRoleOptions: DropdownOption[] = [
    { value: 'member', label: 'Contributor' },
    { value: 'admin', label: 'Admin' },
    { value: 'spectator', label: 'Spectator' },
    { value: 'viewer', label: 'Viewer' },
    { value: 'owner', label: 'Transfer Owner' },
  ];

  // Signals for Group State
  group = signal<Group | null>(null);
  expenses = signal<GroupExpense[]>([]);
  members = signal<GroupMember[]>([]);
  balances = signal<BalanceEntry[]>([]);
  suggestedSettlements = signal<SuggestedSettlement[]>([]);
  /** Filtered balances/settlements (shown alongside overall when filters active). */
  filteredBalances = signal<BalanceEntry[]>([]);
  filteredSuggestedSettlements = signal<SuggestedSettlement[]>([]);
  /** Caller's Opening/Current-Period/Closing decomposition (backend-computed). */
  balanceBreakdown = signal<GroupBalanceBreakdown | null>(null);
  historyLogs = signal<GroupAuditLog[]>([]);
  deletedExpenses = signal<Expense[]>([]);
  carryForwardBalances = signal<CarryForwardBalance[]>([]);
  recurringExpenses = signal<any[]>([]);

  // Signals for ledger closure settings
  closeMonthSelected = signal<string>('');
  isClosingMonth = signal<boolean>(false);
  closeMonthError = signal<string | null>(null);
  closeMonthSuccess = signal<string | null>(null);
  isConfirmCloseMonthOpen = signal<boolean>(false);

  // Signals for UI state
  isLoading = signal<boolean>(true);
  activeTab = signal<
    'ledger' | 'analytics' | 'history' | 'trash' | 'settings' | 'recurring'
  >('ledger');
  isRecurringExpenseFormOpen = signal<boolean>(false);
  selectedRecurringExpenseForEdit = signal<any | null>(null);
  isExpenseModalOpen = signal<boolean>(false);
  isDeleteConfirmOpen = signal<boolean>(false);
  deleteExpenseId = signal<string | null>(null);
  currentPage = signal<number>(1);
  pageSize = signal<number>(20);
  totalExpenses = signal<number>(0);
  /**
   * Monotonic id for ledger fetches. Every `fetchExpenses` call bumps it and
   * captures the value; a response is only applied when it is still the latest
   * request. This drops a late/out-of-order response (e.g. a slow page-3 reply
   * arriving after a newer reload/replace) so it can never overwrite fresher
   * data — the request-sequence equivalent of switchMap for this subscribe.
   */
  private fetchSeq = 0;
  /**
   * Scope-wide monetary totals per currency from the backend, independent of
   * pagination — so the summary tiles show the true totals for the whole
   * filtered ledger, not just the pages loaded so far. Null until the first
   * page response arrives.
   */
  ledgerTotals = signal<LedgerTotals[] | null>(null);
  currentUserId = signal<string | null>(null);
  currentTimelineMonth = signal<Date>(new Date());
  isMonthLocked = signal<boolean>(false);
  isViewer = signal<boolean>(false);
  rateLimitError = this.groupKeyService.rateLimitError;
  readonly DECRYPTION_FAILED_PLACEHOLDER = DECRYPTION_FAILED_PLACEHOLDER;
  isRefreshingKey = signal<boolean>(false);
  requiresKeyProvisioning = this.groupKeyService.requiresKeyProvisioning;
  showLeftScrollCue = signal<boolean>(false);
  showRightScrollCue = signal<boolean>(false);
  isExporting = signal<boolean>(false);
  // ── Ledger export date-range dialog ───────────────────────────────────────
  showExportModal = signal<boolean>(false);
  exportRangeMode = signal<'month' | 'custom'>('month');
  exportFromDate = signal<string>('');
  exportToDate = signal<string>('');
  exportError = signal<string>('');
  isFilterBottomSheetOpen = signal<boolean>(false);
  showSkeleton = signal<boolean>(false);
  isLoadingExpenses = signal<boolean>(false);
  isOffline = signal<boolean>(
    typeof window !== 'undefined' ? !navigator.onLine : false,
  );
  private skeletonTimeoutId?: any;
  membersError = signal<boolean>(false);
  balancesError = signal<boolean>(false);
  analyticsError = signal<boolean>(false);

  // Per-section loading/error state (Phase 2 — each section owns its own,
  // independent of the page shell and of every sibling section).
  isLoadingMembers = signal<boolean>(false);
  isLoadingBalances = signal<boolean>(false);
  isLoadingHistory = signal<boolean>(false);
  historyError = signal<boolean>(false);
  /** Infinite scroll state for the History tab, mirroring the ledger. */
  historyPage = signal<number>(1);
  totalHistoryLogs = signal<number>(0);
  isLoadingMoreHistory = signal<boolean>(false);
  hasMoreHistory = computed(
    () => this.historyLogs().length < this.totalHistoryLogs(),
  );
  isLoadingTrash = signal<boolean>(false);
  trashError = signal<boolean>(false);
  isLoadingRecurring = signal<boolean>(false);
  recurringError = signal<boolean>(false);

  // Decryption lifecycle state (owned by the coordinator).
  decryptionPhase = this.decryptCoordinator.phase;
  decryptionSummary = this.decryptCoordinator.summary;

  /** Some expenses are still waiting for keys after the retry budget settled. */
  showKeysWaitingBanner = computed(
    () =>
      this.decryptionPhase() === 'settled' &&
      this.decryptionSummary().waiting > 0,
  );

  /** Some expenses can never be decrypted (no access / corrupted). */
  showKeysPermanentBanner = computed(
    () => this.decryptionSummary().permanent > 0,
  );

  /** Active automatic recovery in progress (drives the "retrying" hint). */
  isRecoveringKeys = computed(
    () =>
      this.decryptionPhase() === 'loading' ||
      this.decryptionPhase() === 'recovering',
  );

  // Categories list
  categories = [
    'Food & Drinks',
    'Travel',
    'Utilities',
    'Entertainment',
    'Shopping',
    'Housing',
    'Others',
  ];
  selectedExpenseForEdit = signal<GroupExpense | null>(null);

  // Expense Version History panel
  isHistoryPanelOpen = signal<boolean>(false);
  historyExpenseId = signal<string | null>(null);
  historyExpenseTitle = signal<string>('');
  expenseVersions = signal<any[]>([]);
  isLoadingVersions = signal<boolean>(false);
  historyLoadError = signal<string>('');

  // Error Banner & Cooldown State
  ledgerError = signal<boolean>(false);
  retryCooldown = signal<number>(0);
  expandedExpenseIds = signal<Record<string, boolean>>({});

  toggleExpenseExpand(expenseId: string) {
    this.expandedExpenseIds.update((ids) => ({
      ...ids,
      [expenseId]: !ids[expenseId],
    }));
  }

  retryLoadLedger() {
    if (this.retryCooldown() > 0) return;

    if (this.retryCooldownIntervalId) {
      clearInterval(this.retryCooldownIntervalId);
      this.retryCooldownIntervalId = undefined;
    }

    this.retryCooldown.set(5);
    this.retryCooldownIntervalId = setInterval(() => {
      this.retryCooldown.update((c) => c - 1);
      if (this.retryCooldown() <= 0) {
        if (this.retryCooldownIntervalId) {
          clearInterval(this.retryCooldownIntervalId);
          this.retryCooldownIntervalId = undefined;
        }
      }
    }, 1000);

    const g = this.group();
    if (g?.id) {
      this.fetchExpenses(g.id);
    }
  }

  isOwnerOrAdmin = computed(() => {
    const userId = this.currentUserId();
    if (!userId) return false;
    const member = this.members().find((m) => m.user?.id === userId);
    return member?.role === 'owner' || member?.role === 'admin';
  });

  isOwner = computed(() => {
    const userId = this.currentUserId();
    if (!userId) return false;
    const member = this.members().find((m) => m.user?.id === userId);
    return member?.role === 'owner';
  });

  /**
   * Derived, not imperatively set — group() and balances() now resolve
   * independently (they're fetched in parallel), so computing this reactively
   * means it's always correct regardless of which one lands first, instead of
   * being frozen at whatever group()'s value was at the moment balances
   * happened to resolve.
   */
  userBalance = computed(() => {
    const g = this.group();
    const currentUserId = this.currentUserId();
    const entry = this.balances().find(
      (b) => b.userId === currentUserId && b.currency === g?.currency,
    );
    return entry ? entry.netBalance : 0;
  });

  /** The caller's balance within the current filter (for the Filtered section). */
  filteredUserBalance = computed(() => {
    const g = this.group();
    const currentUserId = this.currentUserId();
    const entry = this.filteredBalances().find(
      (b) => b.userId === currentUserId && b.currency === g?.currency,
    );
    return entry ? entry.netBalance : 0;
  });

  /** True for household (contribution/carry-forward) groups. */
  isHousehold = computed(() => this.group()?.groupType === 'household');

  /**
   * The caller's row in the household carry-forward summary for the navigated
   * month. Null for non-household groups (they use the settlements engine).
   * Household balances follow the *contribution* model (paid vs. target %), not
   * expense splits, so the balance card must read from here — the settlements
   * engine both mis-models household shares and double-counts closed months.
   */
  private callerCarryForward = computed(() => {
    if (!this.isHousehold()) return null;
    const uid = this.currentUserId();
    return this.carryForwardBalances().find((b) => b.userId === uid) ?? null;
  });

  /**
   * Overall balance for the card. Household uses the full-history running
   * balance (independent of the navigated month); everyone else the settlements
   * all-time balance.
   */
  overallCardBalance = computed(() => {
    const cf = this.callerCarryForward();
    return cf ? cf.overallBalance : this.userBalance();
  });

  /** Period/"This Month" balance for the card — this month's own net for household. */
  periodCardBalance = computed(() => {
    const cf = this.callerCarryForward();
    return cf ? cf.currentMonthNet : this.filteredUserBalance();
  });

  /**
   * Opening / current-period / closing decomposition for the breakdown. Household
   * reconstructs it from the running carry-forward summary (opening = all prior
   * months, closing = opening + this month); everyone else uses the settlements
   * breakdown.
   */
  balanceBreakdownForCard = computed<GroupBalanceBreakdown | null>(() => {
    const cf = this.callerCarryForward();
    if (cf) {
      return {
        currency: cf.currency,
        openingBalance: cf.openingBalance,
        currentPeriodBalance: cf.currentMonthNet,
        closingBalance: cf.closingBalance,
      };
    }
    return this.balanceBreakdown();
  });

  /** GroupMember.id → display name, for resolving household settlement rows. */
  householdMemberNameByKey = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const r of this.carryForwardBalances()) {
      map[r.groupMemberId] = r.displayName ?? 'Member';
    }
    return map;
  });

  /**
   * Household suggested settlements, derived from the SAME running-balance model
   * as the cards (so they stay consistent) via the shared debt simplifier —
   * `overallBalance` for the Overall scope, `currentMonthNet` for This Month.
   * Keyed by GroupMember.id (resolved to names via householdMemberNameByKey).
   */
  private simplifyHousehold(
    field: 'overallBalance' | 'currentMonthNet',
  ): SuggestedSettlement[] {
    const currency = this.group()?.currency ?? 'USD';
    const balances = this.carryForwardBalances().map((r) => ({
      key: r.groupMemberId,
      balance: r[field],
    }));
    return simplifyLedgerDebts(balances, currency).map((t) => ({
      fromUserId: t.fromKey,
      toUserId: t.toKey,
      amount: t.amount,
      currency: t.currency,
    }));
  }

  householdOverallSettlements = computed<SuggestedSettlement[]>(() =>
    this.isHousehold() ? this.simplifyHousehold('overallBalance') : [],
  );

  householdMonthSettlements = computed<SuggestedSettlement[]>(() =>
    this.isHousehold() ? this.simplifyHousehold('currentMonthNet') : [],
  );

  /** True when any non-date filter dimension is active. */
  hasDimensionFilters = computed(() => {
    const a = this.filterStore.applied();
    return !!(
      a.categories?.length ||
      a.memberIds?.length ||
      a.paidByIds?.length ||
      (a.transactionType && a.transactionType !== 'both') ||
      a.minAmount != null ||
      a.maxAmount != null
    );
  });

  /**
   * Title for the second ("period") balance card. Always the neutral
   * "Current Period" — the exact selection is shown in the subtitle. The Overall
   * card is never affected by filters; only this one.
   */
  periodCardTitle = computed(() => 'Current Period');

  /**
   * Subtitle for the period card: the shared date-range label for the effective
   * scope (so it reflects month navigation and every preset via the single
   * `formatDateRangeLabel` generator), suffixed with "· Filtered" when non-date
   * dimensions are also active. No hand-rolled month formatting.
   */
  periodCardSubtitle = computed(() => {
    const label = this.timeScope().label;
    // Household ignores non-date dimensions (contribution model is date-scoped),
    // so only suffix "· Filtered" where dimensions actually change the figure.
    return !this.isHousehold() && this.hasDimensionFilters()
      ? `${label} · Filtered`
      : label;
  });

  // Archive (Delete Group) dialog state
  isArchiveDialogOpen = signal<boolean>(false);
  archiveConfirmName = signal<string>('');
  archiveReason = signal<string>('');
  isArchiving = signal<boolean>(false);
  archiveError = signal<string>('');

  archiveNameMatches = computed(() => {
    const g = this.group();
    return g ? this.archiveConfirmName().trim() === g.name.trim() : false;
  });

  ngOnInit() {
    this.currentUserId.set(this.getCurrentUserId());
    this.closeMonthSelected.set(this.getCurrentMonthString());

    // Subscribe to query parameters to sync the active tab. Filter query params
    // are owned by the GroupFilterStore + its effect (see the constructor), not
    // handled here — so navigating the filter into the URL never triggers a
    // duplicate refetch through this subscription.
    this.route.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((qParams) => {
        const tab = qParams['tab'] || 'ledger';
        if (
          [
            'ledger',
            'analytics',
            'history',
            'trash',
            'settings',
            'recurring',
          ].includes(tab)
        ) {
          this.activeTab.set(tab as any);

          // Load settings or recurring data if target tab is active
          if (tab === 'settings') {
            const g = this.group();
            if (g) {
              this.editGroupName = g.name;
              this.editGroupDescription = g.description || '';
              this.editGroupVisibility = g.visibility || 'private';
              this.editGroupCurrency = g.currency || 'USD';
              this.editGroupCarryForward = g.carryForwardEnabled || false;
              this.loadContributionsForMonth();
            }
          } else if (tab === 'recurring') {
            const g = this.group();
            if (g?.id) {
              this.fetchRecurringExpenses(g.id);
            }
          }
        }

        this.scrollToActiveTab();
        this.checkScrollCues();
      });

    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const groupId = params.get('id');
        if (groupId) {
          this.startLoading();
          this.currentPage.set(1);

          // Seed the unified filter from the URL before any initial fetch, so
          // deep-links / refresh restore the previously applied filter.
          this.filterStore.initialize(
            filterFromQueryParams(this.route.snapshot.queryParams),
          );

          // Fired independently of getGroup() — none of these need the Group
          // response, only the groupId already available from the route.
          // (docs/audits/group-detail-progressive-loading-audit.md §6.1)
          this.fetchMembers(groupId);
          this.fetchBalances(groupId);
          this.fetchHistoryLogs(groupId);
          this.fetchDeletedExpenses(groupId);
          this.fetchRecurringExpenses(groupId);

          this.groupsService.getGroup(groupId).subscribe({
            next: (res) => {
              this.group.set(res);
              this.stopLoading();
              // Stays gated on getGroup(): needs res.groupType to decide the
              // household current-month date range before building its
              // request (see fetchExpenses below), the same real exception
              // already noted for fetchCarryForward in the audit.
              this.fetchExpenses(groupId);
              if (res.groupType === 'household') {
                this.fetchCarryForward(groupId);
              }
            },
            error: () => this.stopLoading(),
          });
        }
      });
  }

  /**
   * Called once membership (and therefore the caller's role) is known.
   * Proactively provisions key material, then hands the expense list to the
   * decryption coordinator which owns the decrypt → retry → success lifecycle.
   *
   * Routes the master-key check through CryptoSessionManager.
   * ensureCryptoContext() rather than calling encryptionService directly —
   * this keeps CryptoSessionManager.state accurate even for a brand-new or
   * empty group with nothing yet to decrypt (which would otherwise never
   * exercise the crypto session at all), so the shared
   * <app-crypto-recovery-panel> always reflects reality.
   */
  async initializeGroupKeysAndSelfHeal(groupId: string) {
    try {
      await this.cryptoSession.ensureCryptoContext('group_detail_init');
    } catch {
      // CryptoSessionManager.state already reflects the failure; the
      // shared recovery panel picks it up. Key provisioning below still
      // needs an attempt so an owner/admin's background self-heal keeps
      // working once their own session recovers.
    }

    const role = this.getCallerRole();
    // Proactively ensure keys exist / are provisioned for all members, even
    // before any expense is decrypted (matters for empty or new groups).
    await this.decryptCoordinator.provision(groupId, role);
    this.startDecryption();
  }

  /**
   * Start (or restart) the coordinator over the current expense list. Safe to
   * call repeatedly — it cancels any prior session and re-decrypts from the
   * ciphertext preserved on each item (no server round-trip needed).
   */
  private startDecryption() {
    const g = this.group();
    if (!g?.id) return;
    this.decryptCoordinator.start({
      groupId: g.id,
      role: this.getCallerRole(),
      getExpenses: () => this.expenses(),
      publish: (list) => this.expenses.set(list),
    });
  }

  async refreshGroupKey() {
    const g = this.group();
    if (!g?.id || this.isRefreshingKey()) return;

    this.isRefreshingKey.set(true);
    try {
      this.groupKeyService.invalidateGroupKey(g.id);
      await this.initializeGroupKeysAndSelfHeal(g.id);
      this.fetchExpenses(g.id);
      this.fetchBalances(g.id);
    } catch (e) {
      console.error('Failed to refresh group key:', e);
    } finally {
      this.isRefreshingKey.set(false);
    }
  }

  @ViewChild('tabBarContainer') tabBarContainer!: ElementRef<HTMLDivElement>;

  ngAfterViewInit() {
    this.checkScrollCues();
    this.scrollToActiveTab();
  }

  scrollToActiveTab() {
    setTimeout(() => {
      const activeEl =
        this.tabBarContainer?.nativeElement?.querySelector('.tab-active');
      if (activeEl) {
        activeEl.scrollIntoView({
          behavior: 'smooth',
          inline: 'center',
          block: 'nearest',
        });
      }
    }, 150);
  }

  onTabBarScroll() {
    const el = this.tabBarContainer?.nativeElement;
    if (!el) return;
    requestAnimationFrame(() => {
      this.showLeftScrollCue.set(el.scrollLeft > 5);
      this.showRightScrollCue.set(
        el.scrollLeft < el.scrollWidth - el.clientWidth - 5,
      );
    });
  }

  checkScrollCues() {
    setTimeout(() => this.onTabBarScroll(), 200);
  }

  startLoading() {
    this.isLoading.set(true);
    this.showSkeleton.set(false);
    if (this.skeletonTimeoutId) {
      clearTimeout(this.skeletonTimeoutId);
    }
    this.skeletonTimeoutId = setTimeout(() => {
      if (this.isLoading()) {
        this.showSkeleton.set(true);
      }
    }, 200);
  }

  stopLoading() {
    this.isLoading.set(false);
    this.showSkeleton.set(false);
    if (this.skeletonTimeoutId) {
      clearTimeout(this.skeletonTimeoutId);
      this.skeletonTimeoutId = undefined;
    }
  }

  /** Mirror the applied filter into the URL (merge, no history entry). */
  private syncFilterToUrl() {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: filterToQueryParams(this.filterStore.applied()),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ── Filter drawer lifecycle ─────────────────────────────────────────────────

  /** Open the drawer, seeding its draft from the currently applied filter. */
  openFilterDrawer() {
    this.filterStore.openDraft();
    this.setFilterBottomSheet(true);
  }

  /** Commit the drawer's draft. The applied() effect handles refetch + URL sync. */
  applyFilterDrawer() {
    if (!this.draftDateRangeValid()) return;
    const previousPreset = this.filterStore.applied().date.preset;
    this.filterStore.apply();
    // Only re-anchor the household navigator when the date preset itself changed,
    // so editing category/member etc. never resets an arrow-navigated month.
    if (this.filterStore.applied().date.preset !== previousPreset) {
      this.anchorHouseholdMonth();
    }
    this.setFilterBottomSheet(false);
  }

  /** Clear the drawer's controls back to defaults (does not close or apply). */
  resetFilterDrawer() {
    this.filterStore.resetDraft();
  }

  /** Discard the drawer's draft edits and close without applying. */
  cancelFilterDrawer() {
    this.filterStore.cancelDraft();
    this.setFilterBottomSheet(false);
  }

  /** Clear every applied filter immediately (used by inline "Clear Filters"). */
  clearAllFilters() {
    this.filterStore.resetDraft();
    this.filterStore.apply();
    this.anchorHouseholdMonth();
  }

  @ViewChild('filterBtn') filterBtn!: ElementRef<HTMLButtonElement>;

  setFilterBottomSheet(isOpen: boolean) {
    this.isFilterBottomSheetOpen.set(isOpen);
    if (!isOpen) {
      setTimeout(() => {
        this.filterBtn?.nativeElement?.focus();
      }, 100);
    } else {
      setTimeout(() => {
        const firstEl = document.querySelector(
          '#filterDrawer button',
        ) as HTMLElement;
        firstEl?.focus();
      }, 150);
    }
  }

  onBottomSheetKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.cancelFilterDrawer();
      return;
    }

    if (event.key === 'Tab') {
      const modalEl = document.querySelector('.z-\\[100\\]');
      if (!modalEl) return;

      const focusableEls = modalEl.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusableEls.length === 0) return;
      const firstEl = focusableEls[0] as HTMLElement;
      const lastEl = focusableEls[focusableEls.length - 1] as HTMLElement;

      if (event.shiftKey) {
        if (document.activeElement === firstEl) {
          lastEl.focus();
          event.preventDefault();
        }
      } else {
        if (document.activeElement === lastEl) {
          firstEl.focus();
          event.preventDefault();
        }
      }
    }
  }

  @HostListener('window:online')
  onOnline() {
    this.isOffline.set(false);
    const g = this.group();
    if (g?.id) {
      this.fetchExpenses(g.id);
      this.fetchBalances(g.id);
    }
  }

  @HostListener('window:offline')
  onOffline() {
    this.isOffline.set(true);
  }

  // unlockVault() removed — superseded by <app-crypto-recovery-panel>,
  // which owns the unlock action for every encrypted feature. The
  // constructor's isReady() effect above re-runs
  // initializeGroupKeysAndSelfHeal (and therefore re-fetches nothing extra
  // beyond what that already retriggers) once the panel restores the
  // session, so this page doesn't need its own copy of that flow anymore.

  getCurrentMonthString(): string {
    const d = this.currentTimelineMonth();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  /** Zero-padded last calendar day of a `YYYY-MM` month (e.g. '30' for June,
   *  '28'/'29' for February). Avoids emitting impossible dates like
   *  `2026-06-31`, which the backend's date column rejects. */
  private lastDayOfMonth(yearMonth: string): string {
    const [year, month] = yearMonth.split('-').map(Number);
    // Day 0 of the next month is the last day of `month` (month is 1-based).
    const day = new Date(year, month, 0).getDate();
    return String(day).padStart(2, '0');
  }

  changeMonth(delta: number) {
    const g = this.group();
    if (g?.groupType !== 'household') return;

    const nextDate = new Date(this.currentTimelineMonth());
    nextDate.setMonth(nextDate.getMonth() + delta);
    this.currentTimelineMonth.set(nextDate);

    // A household ledger month closes on the same cadence as every other
    // group: the previous month stays editable through MONTH_LOCK_DAY of the
    // following month (grace period), only then does it lock. Mirrors the
    // backend ExpenseEditPolicyService.
    const y = nextDate.getFullYear();
    const m = String(nextDate.getMonth() + 1).padStart(2, '0');
    this.isMonthLocked.set(this.isPastEditWindow(`${y}-${m}-01`));

    if (g?.id) {
      // A new month is a fresh list — start at page 1 so the replace fetch loads
      // the new month's first page, never a stale deep page from the old month.
      this.currentPage.set(1);
      this.fetchExpenses(g.id);
      this.fetchCarryForward(g.id);
      // Balances feed the "This Month" card + breakdown, whose period is the
      // navigated household month (effectiveDateRange follows currentTimelineMonth
      // in month mode). Without this refetch the card/breakdown stay on the old
      // month even though the ledger and carry-forward bars move.
      this.fetchBalances(g.id);
      // History and Trash follow the navigated household month too.
      this.fetchHistoryLogs(g.id);
      this.fetchDeletedExpenses(g.id);
    }
  }

  /** True while a subsequent page is being appended via infinite scroll
   *  (distinct from isLoadingExpenses, which covers the initial/replace load
   *  and drives the full-list skeleton/dim state). */
  isLoadingMoreExpenses = signal<boolean>(false);

  /** More pages remain to fetch for the current filter set. */
  hasMoreExpenses = computed(
    () => this.expenses().length < this.totalExpenses(),
  );

  /**
   * Owns its own section-scoped loading/error state (isLoadingExpenses /
   * ledgerError) — it no longer touches the page-wide isLoading/showSkeleton
   * gate, which now only covers the brief window until getGroup() resolves.
   *
   * `mode`:
   *  - 'replace' (default) fetches exactly the current page and replaces the
   *    list — initial load, retry, and filter/group changes (which reset
   *    currentPage to 1 first).
   *  - 'append' fetches the next page and appends it — infinite scroll.
   *  - 'reload' re-fetches every page the user has already scrolled through
   *    (1..currentPage) in one authoritative request and replaces the list in
   *    place. Used after a create/update/delete so the whole visible list stays
   *    consistent with the backend instead of collapsing to a single page or
   *    dropping the newest rows; it also clamps currentPage down when a delete
   *    empties the final page (see below), so the user is never stranded past
   *    the end of the ledger. Month/filter/sort are untouched throughout.
   */
  fetchExpenses(
    groupId: string,
    mode: 'replace' | 'append' | 'reload' = 'replace',
  ) {
    const append = mode === 'append';
    if (append) {
      this.isLoadingMoreExpenses.set(true);
    } else {
      this.isLoadingExpenses.set(true);
    }
    const applied = this.filterStore.applied();
    // Household ledgers stay month-driven (months lock); everything else uses the
    // unified filter's resolved range. Either way, the other dimensions apply.
    const { from, to } = this.effectiveDateRange();

    // 'reload' collapses pages 1..currentPage into a single request (page 1,
    // limit = loadedPages × pageSize) so a mutation refreshes the entire
    // scrolled-through list at once; 'append'/'replace' fetch one page as before.
    const loadedPages = Math.max(1, this.currentPage());
    const requestPage = mode === 'reload' ? 1 : this.currentPage();
    const requestLimit =
      mode === 'reload' ? loadedPages * this.pageSize() : this.pageSize();

    // Race/stale-response protection: only the latest fetch may apply its result.
    const seq = ++this.fetchSeq;

    this.expensesService
      .getExpenses(groupId, {
        page: requestPage,
        limit: requestLimit,
        startDate: from,
        endDate: to,
        ...this.appliedDimensionOptions(),
        sortBy: applied.sortBy,
        sortOrder: applied.sortOrder,
      })
      .subscribe({
        next: (res) => {
          // A newer fetch superseded this one — drop the stale response.
          if (seq !== this.fetchSeq) return;
          const mappedExpenses = (res.data as any[]).map((expense) => {
            const mappedSplits = (expense.splits || []).map((split: any) => {
              let email = split.participantUserEmail;
              let displayName = split.participantUserDisplayName;
              let participantUser = split.participantUser;

              if (!email || !displayName || !participantUser) {
                if (split.participantUserId) {
                  const member = this.members().find(
                    (m) => m.user?.id === split.participantUserId,
                  );
                  if (member) {
                    email = member.user?.email;
                    displayName = member.user?.displayName;
                    participantUser = member.user;
                  }
                } else if (split.participantGroupMemberId) {
                  const member = this.members().find(
                    (m) => m.id === split.participantGroupMemberId,
                  );
                  if (member) {
                    email = member.user?.email;
                    displayName = member.user?.displayName;
                    participantUser = member.user;
                  }
                }
              }

              return {
                ...split,
                shareAmount: split.amountOwed,
                participantUserEmail: email,
                participantUserDisplayName: displayName,
                participantUser,
              };
            });

            return {
              ...expense,
              splits: mappedSplits,
            } as GroupExpense;
          });
          if (append) {
            this.expenses.update((prev) => [...prev, ...mappedExpenses]);
          } else {
            this.expenses.set(mappedExpenses);
          }
          const total = res.meta?.totalItems || 0;
          this.totalExpenses.set(total);
          // After a reload, clamp currentPage to the last page that still holds
          // data so a delete that emptied the final page moves the user to the
          // previous valid page rather than stranding them past the end.
          if (mode === 'reload') {
            const lastValidPage = Math.max(
              1,
              Math.ceil(total / this.pageSize()),
            );
            if (this.currentPage() > lastValidPage) {
              this.currentPage.set(lastValidPage);
            }
          }
          // Authoritative totals for the whole filtered scope — same on every
          // page, so setting on append is harmless and keeps them fresh.
          this.ledgerTotals.set(
            (res.meta as { totals?: LedgerTotals[] } | undefined)?.totals ??
              null,
          );
          this.isLoadingExpenses.set(false);
          this.isLoadingMoreExpenses.set(false);
          this.ledgerError.set(false);
          // Hand the freshly-fetched list to the coordinator for
          // classification + automatic retry/recovery. Safe to call
          // repeatedly over the full (old + newly-appended) list — it
          // re-decrypts from each item's preserved ciphertext and skips
          // anything already successfully decrypted.
          this.startDecryption();
        },
        error: () => {
          // A newer fetch superseded this one — its failure is no longer relevant.
          if (seq !== this.fetchSeq) return;
          this.isLoadingExpenses.set(false);
          this.isLoadingMoreExpenses.set(false);
          this.ledgerError.set(true);
        },
      });
  }

  /**
   * Infinite scroll: called when the ledger's scrollable list nears its
   * bottom (see onExpenseListScroll in the template). Guards against
   * duplicate in-flight requests and stops once every page has loaded.
   */
  loadMoreExpenses(): void {
    if (this.isLoadingExpenses() || this.isLoadingMoreExpenses()) return;
    if (!this.hasMoreExpenses()) return;
    const g = this.group();
    if (!g?.id) return;
    this.currentPage.update((v) => v + 1);
    this.fetchExpenses(g.id, 'append');
  }

  /** Scroll handler for the bounded expense-list container — triggers the
   *  next page once the user is within `threshold`px of the bottom. */
  onExpenseListScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const threshold = 200;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
      this.loadMoreExpenses();
    }
  }

  fetchMembers(groupId: string) {
    this.isLoadingMembers.set(true);
    this.membersError.set(false);
    this.groupsService.getMembers(groupId).subscribe({
      next: (res) => {
        this.members.set(res);
        this.isLoadingMembers.set(false);

        const currentUserId = this.currentUserId();
        const myMember = res.find((m) => m.user?.id === currentUserId);
        this.isViewer.set(myMember?.role === 'viewer');

        this.initializeGroupKeysAndSelfHeal(groupId);
      },
      error: (err) => {
        console.error('Failed to fetch group members', err);
        this.isLoadingMembers.set(false);
        this.membersError.set(true);
      },
    });
  }

  fetchBalances(groupId: string) {
    // Fires in parallel with getGroup(); userBalance is a computed() derived from
    // group()+balances(), so it's correct regardless of arrival order.
    this.isLoadingBalances.set(true);
    this.balancesError.set(false);
    // The backend returns both `overall` (all-time, carry-forward intact) and
    // `filtered` (for the active filter). We always request both; the Filtered
    // block is only shown in the UI when filters are actually active.
    this.groupsService
      .getBalances(groupId, this.appliedFilterOptions())
      .subscribe({
        next: (res) => {
          this.balances.set(res.overall.balances);
          this.suggestedSettlements.set(res.overall.suggestedSettlements);
          this.filteredBalances.set(res.filtered.balances);
          this.filteredSuggestedSettlements.set(
            res.filtered.suggestedSettlements,
          );
          this.balanceBreakdown.set(res.breakdown ?? null);
          this.isLoadingBalances.set(false);
        },
        error: (err) => {
          console.error('Failed to fetch balances', err);
          this.isLoadingBalances.set(false);
          this.balancesError.set(true);
        },
      });
  }

  /**
   * `append`: false (default) replaces the list — initial load / retry, resets
   * to page 1. true appends the fetched page — used by infinite scroll
   * (loadMoreHistory). Mirrors fetchExpenses.
   */
  fetchHistoryLogs(groupId: string, append = false) {
    if (append) {
      this.isLoadingMoreHistory.set(true);
    } else {
      this.historyPage.set(1);
      this.isLoadingHistory.set(true);
    }
    this.historyError.set(false);
    this.groupsService
      .getHistoryLogs(
        groupId,
        this.historyPage(),
        20,
        this.effectiveDateRange(),
      )
      .subscribe({
        next: (res) => {
          const logs = res.data || [];
          if (append) {
            this.historyLogs.update((prev) => [...prev, ...logs]);
          } else {
            this.historyLogs.set(logs);
          }
          this.totalHistoryLogs.set(res.meta?.totalItems ?? logs.length);
          this.isLoadingHistory.set(false);
          this.isLoadingMoreHistory.set(false);
        },
        error: (err) => {
          console.error('Failed to fetch history logs', err);
          this.isLoadingHistory.set(false);
          this.isLoadingMoreHistory.set(false);
          this.historyError.set(true);
        },
      });
  }

  /**
   * Infinite scroll for the History tab: fetch and append the next page.
   * Guards against duplicate in-flight requests and stops once every page has
   * loaded. Mirrors loadMoreExpenses.
   */
  loadMoreHistory(): void {
    if (this.isLoadingHistory() || this.isLoadingMoreHistory()) return;
    if (!this.hasMoreHistory()) return;
    const g = this.group();
    if (!g?.id) return;
    this.historyPage.update((v) => v + 1);
    this.fetchHistoryLogs(g.id, true);
  }

  /** Scroll handler for the bounded history-list container — triggers the next
   *  page once the user is within `threshold`px of the bottom. */
  onHistoryScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const threshold = 200;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
      this.loadMoreHistory();
    }
  }

  fetchDeletedExpenses(groupId: string) {
    this.isLoadingTrash.set(true);
    this.trashError.set(false);
    this.groupsService
      .getDeletedExpenses(groupId, this.appliedFilterOptions())
      .subscribe({
        next: (res) => {
          this.deletedExpenses.set(res.data || []);
          this.isLoadingTrash.set(false);
        },
        error: (err) => {
          console.error('Failed to fetch deleted expenses', err);
          this.isLoadingTrash.set(false);
          this.trashError.set(true);
        },
      });
  }

  fetchCarryForward(groupId: string) {
    // Household summary follows the shared TimeScope (effective date range),
    // aggregating every month in range — never a single hardcoded month.
    this.groupsService
      .getCarryForward(groupId, this.appliedFilterOptions())
      .subscribe({
        next: (res) => {
          this.carryForwardBalances.set(res || []);
        },
        error: (err) =>
          console.error('Failed to fetch carry-forward data', err),
      });
  }

  getMaxCarryForwardValue(): number {
    const balances = this.carryForwardBalances();
    if (balances.length === 0) return 1;
    return Math.max(
      ...balances.map((b) => Math.max(b.paid || 0, b.expected || 0, 1)),
    );
  }

  getCurrentUserId(): string | null {
    const token = localStorage.getItem('finmate_token');
    if (!token) return null;
    try {
      const decoded = jwtDecode<JwtPayload>(token);
      return decoded.userId || null;
    } catch {
      return null;
    }
  }

  getUserName(userId: string | null | undefined): string {
    return resolveUserDisplayName(this.members(), userId);
  }

  /** True when a transaction is a refund (money returned to the group) rather
   *  than a normal expense — drives every visual distinction in the ledger. */
  isRefundTx(entity: { transactionType?: string | null }): boolean {
    return entity.transactionType === 'refund';
  }

  /**
   * Whether the current user may act (history/edit/delete) on this expense at
   * all — i.e. the action cluster should render. Not a viewer, not voided, and
   * either an owner/admin or the expense's own owner/payer. The lock state then
   * decides *which* controls show (lock badge vs. the edit buttons).
   */
  canActOnExpense(expense: GroupExpense): boolean {
    if (this.isViewer() || expense.status === 'void') return false;
    const uid = this.currentUserId();
    return (
      this.isOwnerOrAdmin() ||
      expense.ownerUserId === uid ||
      expense.paidByUserId === uid
    );
  }

  /**
   * Mirrors the backend's editing-window rule (see ExpenseEditPolicyService):
   * the current calendar month is always editable; the previous month is
   * editable through MONTH_LOCK_DAY (inclusive) of the current month; anything
   * older is read-only. Household groups follow the same rule — their
   * month-navigation lock (isMonthLocked) is computed from this same window.
   */
  private isPastEditWindow(expenseDate: string): boolean {
    const [yearStr, monthStr] = expenseDate.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr); // 1-based
    if (!Number.isFinite(year) || !Number.isFinite(month)) return false;
    // Passing the 1-based month as JS's 0-based index lands on the next
    // month, rolling the year over automatically (e.g. Dec -> Jan).
    const graceEnd = new Date(year, month, MONTH_LOCK_DAY, 23, 59, 59, 999);
    return Date.now() > graceEnd.getTime();
  }

  /** True if this expense can no longer be added/edited/deleted per the
   *  previous-month editing window (or the household ledger-close lock). */
  isExpenseEditLocked(expense: GroupExpense): boolean {
    const g = this.group();
    if (g?.groupType === 'household') {
      return this.isMonthLocked();
    }
    return this.isPastEditWindow(expense.expenseDate);
  }

  /**
   * Group spending summary for the whole filtered ledger scope: total
   * expenses, total refunds, and net spending (expenses − refunds), in the
   * group's base currency. Prefers the backend's pagination-independent totals
   * (`ledgerTotals`) so the tiles stay correct no matter how many pages have
   * loaded; falls back to summing the loaded rows only until those arrive.
   */
  ledgerSpendingSummary = computed(() => {
    const g = this.group();
    const currency = g?.currency;

    const totals = this.ledgerTotals();
    if (totals) {
      const scoped = currency
        ? totals.filter((t) => t.currency === currency)
        : totals;
      const totalExpense = scoped.reduce((s, t) => s + t.totalExpense, 0);
      const totalRefund = scoped.reduce((s, t) => s + t.totalRefund, 0);
      return {
        totalExpense,
        totalRefund,
        netSpending: totalExpense - totalRefund,
      };
    }

    // Fallback: page-scoped sum of the rows loaded so far.
    let totalExpense = 0;
    let totalRefund = 0;
    for (const expense of this.expenses()) {
      if (expense.status === 'void') continue;
      if (currency && expense.currency !== currency) continue;
      const amount = Number(expense.amountTotal) || 0;
      if (this.isRefundTx(expense)) {
        totalRefund += amount;
      } else {
        totalExpense += amount;
      }
    }
    return {
      totalExpense,
      totalRefund,
      netSpending: totalExpense - totalRefund,
    };
  });

  /** User-facing explanation for why a locked transaction can't be touched. */
  expenseLockMessage(expense: GroupExpense): string {
    const g = this.group();
    if (g?.groupType === 'household') {
      return `Household expenses from ${expense.ledgerMonth ?? 'a previous month'} are locked and cannot be modified.`;
    }
    const d = new Date(expense.expenseDate);
    const txMonth = d.toLocaleDateString('en-US', { month: 'long' });
    const lockDeadline = new Date(
      d.getFullYear(),
      d.getMonth() + 1,
      1,
    ).toLocaleDateString('en-US', { month: 'long' });
    return `Transactions from ${txMonth} could only be modified until ${MONTH_LOCK_DAY} ${lockDeadline} and are now locked.`;
  }

  /** Resolves the payer display name for a group expense or recurring template.
   *  Prefers paidByUserId; falls back to paidByGroupMemberId so contact-backed
   *  (pending) payers are handled correctly via memberDisplayName(). */
  payerDisplayName(entity: {
    paidByUserId?: string | null;
    paidByGroupMemberId?: string | null;
  }): string {
    if (entity.paidByUserId) {
      const m = this.members().find((m) => m.user?.id === entity.paidByUserId);
      if (m) return this.memberDisplayName(m);
    }
    if (entity.paidByGroupMemberId) {
      const m = this.members().find((m) => m.id === entity.paidByGroupMemberId);
      if (m) return this.memberDisplayName(m);
    }
    return 'Unknown User';
  }

  /** Display name for a member, whichever identity backs it (registered or pending). */
  memberDisplayName(member: GroupMember): string {
    return resolveMemberDisplayName(member);
  }

  openExpenseModal(expense?: GroupExpense) {
    this.selectedExpenseForEdit.set(expense || null);
    this.isExpenseModalOpen.set(true);
  }

  closeExpenseModal() {
    this.selectedExpenseForEdit.set(null);
    this.isExpenseModalOpen.set(false);
  }

  openExpenseHistory(expense: GroupExpense) {
    this.historyExpenseId.set(expense.id);
    this.historyExpenseTitle.set(String(expense.title ?? ''));
    this.expenseVersions.set([]);
    this.historyLoadError.set('');
    this.isLoadingVersions.set(true);
    this.isHistoryPanelOpen.set(true);

    this.expensesService.getExpenseVersionHistory(expense.id).subscribe({
      next: (versions) => {
        this.expenseVersions.set(versions);
        this.isLoadingVersions.set(false);
      },
      error: (err) => {
        this.historyLoadError.set(
          err.error?.message || 'Failed to load version history.',
        );
        this.isLoadingVersions.set(false);
      },
    });
  }

  closeExpenseHistory() {
    this.isHistoryPanelOpen.set(false);
    this.historyExpenseId.set(null);
    this.expenseVersions.set([]);
  }

  onExpenseCreated() {
    const g = this.group();
    if (g?.id) {
      // 'reload' keeps the user on the pages they've scrolled through: it
      // refreshes the whole loaded list in place (newest row lands at the top
      // naturally) instead of collapsing it to the current page, and clamps the
      // page down if a delete emptied the final one. Month/filter/sort are kept.
      this.fetchExpenses(g.id, 'reload');
      this.fetchBalances(g.id);
      this.fetchHistoryLogs(g.id);
      this.fetchDeletedExpenses(g.id);
      if (g.groupType === 'household') {
        this.fetchCarryForward(g.id);
      }
    }
  }

  confirmDeleteExpense(expenseId: string) {
    this.deleteExpenseId.set(expenseId);
    this.isDeleteConfirmOpen.set(true);
  }

  onDeleteConfirmed() {
    const id = this.deleteExpenseId();
    if (id) {
      this.expensesService.deleteExpense(id).subscribe({
        next: () => {
          this.isDeleteConfirmOpen.set(false);
          this.deleteExpenseId.set(null);
          this.onExpenseCreated();
        },
        error: (err) => {
          this.isDeleteConfirmOpen.set(false);
          this.deleteExpenseId.set(null);
          alert(err.error?.message || 'Failed to delete expense');
        },
      });
    }
  }

  onDeleteCancelled() {
    this.isDeleteConfirmOpen.set(false);
    this.deleteExpenseId.set(null);
  }

  restoreExpense(expenseId: string) {
    this.expensesService.restoreExpense(expenseId).subscribe({
      next: () => {
        alert('Expense restored successfully!');
        this.onExpenseCreated();
      },
      error: (err) => alert(err.error?.message || 'Failed to restore expense'),
    });
  }

  /** Open the ledger export dialog, seeded from the currently applied filter's
   *  date range so the export defaults to exactly what's on screen. Household
   *  ledgers seed from the active month; all-time seeds blank (whole ledger). */
  openExportModal(): void {
    const g = this.group();
    if (g?.groupType === 'household') {
      // Household exports the month currently on screen (via 'month' mode) —
      // effectiveDateRange follows the household month navigator, so exporting
      // while viewing July uses July, not the system month.
      const { from, to } = this.effectiveDateRange();
      this.exportFromDate.set(from ?? '');
      this.exportToDate.set(to ?? '');
      this.exportRangeMode.set('month');
    } else {
      // Non-household seeds the currently applied filter's date range so the
      // export defaults to exactly what's on screen. 'custom' so the seeded
      // dates are used verbatim (all-time seeds blank = whole ledger).
      const range = this.filterStore.resolvedRange();
      this.exportFromDate.set(range.from ?? '');
      this.exportToDate.set(range.to ?? '');
      this.exportRangeMode.set('custom');
    }
    this.exportError.set('');
    this.showExportModal.set(true);
  }

  /** Close the export dialog (no-op mid-export so the download isn't abandoned). */
  closeExportModal(): void {
    if (this.isExporting()) return;
    this.showExportModal.set(false);
  }

  /** Resolve the effective [from, to] for the export based on the chosen mode:
   *  'month' = the period currently being viewed (household month navigation and
   *  every date preset flow through the shared effectiveDateRange, so the export
   *  always matches the on-screen month — never the system month); 'custom' = the
   *  picked date inputs. */
  private resolveExportRange(): { from: string; to: string } {
    if (this.exportRangeMode() === 'month') {
      const { from, to } = this.effectiveDateRange();
      return { from: from ?? '', to: to ?? '' };
    }
    return { from: this.exportFromDate(), to: this.exportToDate() };
  }

  /**
   * Human label for the period the export will cover (e.g. "July 2026"), derived
   * from the same shared TimeScope that drives the ledger — so the export button
   * and the modal's period toggle always name the month/range on screen.
   */
  exportPeriodLabel = computed(() => this.timeScope().label);

  /**
   * Export the group ledger for the chosen date range to Excel.
   *
   * The backend returns every expense in the group as ciphertext (it can't
   * decrypt — zero-knowledge); this client fetches those rows, decrypts the
   * title/description with the group key, and builds the .xlsx locally. That's
   * why the old server-side CSV/xlsx export is gone: it wrote ciphertext into
   * the file. Respects the ledger's active category filter.
   */
  async exportLedger() {
    const g = this.group();
    if (!g || this.isExporting()) return;

    const { from, to } = this.resolveExportRange();
    // Both blank = whole ledger (the "All Time" filter). Only one blank is an error.
    if ((from && !to) || (!from && to)) {
      this.exportError.set('Please choose both a from and to date.');
      return;
    }
    if (from && to && from > to) {
      this.exportError.set(
        'The "from" date must be on or before the "to" date.',
      );
      return;
    }
    this.exportError.set('');

    this.isExporting.set(true);
    try {
      // The export automatically uses every currently applied filter dimension.
      const dims = this.appliedDimensionOptions();
      const filter: ExportFilter = {
        groupId: g.id,
        type: 'group',
        from,
        to,
        categories: dims.categories,
        memberIds: dims.memberIds,
        paidByIds: dims.paidByIds,
        transactionType: dims.transactionType,
        minAmount: dims.minAmount,
        maxAmount: dims.maxAmount,
      };
      await this.expenseExportService.exportExpenses(
        filter,
        'xlsx',
        this.buildExportFilenameBase(g.name, from, to),
      );
      this.isExporting.set(false);
      this.showExportModal.set(false);
    } catch (err: any) {
      this.exportError.set(
        'Failed to export ledger: ' +
          (err?.error?.message || err?.message || 'Unknown error'),
      );
      this.isExporting.set(false);
    }
  }

  /**
   * Make a group name safe to drop into a download filename: strip characters
   * that are invalid on Windows/macOS filesystems (`< > : " / \ | ? *` and
   * control chars), collapse whitespace, and trim trailing dots/spaces
   * (which Windows also rejects). Falls back to `group` when nothing is left.
   */
  private sanitizeForFilename(name: string): string {
    const cleaned = (name ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '');
    return cleaned || 'group';
  }

  /**
   * Download filename base for a ledger export, naming the selected period so the
   * file is self-describing: a single whole calendar month → `<group>-July-2026`;
   * any other explicit range → `<group>-<from>_to_<to>`; the whole ledger (both
   * bounds blank, i.e. All Time) → `<group>-all-time`.
   */
  private buildExportFilenameBase(
    groupName: string,
    from: string,
    to: string,
  ): string {
    const name = this.sanitizeForFilename(groupName);
    if (!from && !to) return `${name}-all-time`;
    if (from && to && this.isWholeCalendarMonth(from, to)) {
      // formatDateRangeLabel yields "July 2026" for a single month.
      const label = formatDateRangeLabel('this_month', from, to).replace(
        /\s+/g,
        '-',
      );
      return `${name}-${label}`;
    }
    return `${name}-${from || 'start'}_to_${to || 'end'}`;
  }

  /** True when [from, to] spans exactly one whole calendar month (first day
   *  through its real last day, e.g. 2026-07-01 → 2026-07-31). */
  private isWholeCalendarMonth(from: string, to: string): boolean {
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    if (!fy || !fm || !fd || !ty || !tm || !td) return false;
    if (fy !== ty || fm !== tm || fd !== 1) return false;
    return td === new Date(fy, fm, 0).getDate();
  }

  onImportFileSelected(event: Event) {
    const g = this.group();
    if (!g) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('groupId', g.id);

      this.expensesService.importExpenses(formData).subscribe({
        next: () => {
          alert('Expenses imported successfully!');
          this.onExpenseCreated();
        },
        error: (err) =>
          alert(err.error?.message || 'Import failed. Check file format.'),
      });
    }
  }

  async downloadAttachment(file: any) {
    if (file.encryptedFileKey && file.encryptedOriginalName) {
      try {
        const expense = this.expenses().find((e) => e.id === file.expenseId);
        if (!expense) {
          throw new Error('Expense context not found for attachment');
        }

        // Reuse the central pipeline's scope-key resolution + classification
        // instead of re-implementing it here. resolveExpenseKey() never
        // rejects (it swallows session failures into keyStatus:'no_session'),
        // so the null-key check has to throw *inside* the operation passed to
        // runWithRecovery — only then can its catch see the failure, verify
        // it's a genuine session block, and queue+auto-resume the whole
        // decrypt-and-save flow once unlocked, instead of failing with an
        // alert the user has to dismiss before clicking download again.
        const scopeKey = await this.recoveryQueue.runWithRecovery(async () => {
          const result = await this.expenseDecryption.resolveExpenseKey(
            expense as any,
          );
          if (!result.key) {
            throw new Error(
              classifyDecryptionError({ keyStatus: result.keyStatus }).message,
            );
          }
          return result.key;
        });

        const fileKey = await this.encryptionService.unwrapKey(
          file.encryptedFileKey,
          scopeKey,
        );
        const decryptedName = await this.encryptionService.decrypt(
          file.encryptedOriginalName,
          fileKey,
        );

        const encryptedBytes = localStorage.getItem(
          `sim_storage:${file.storageKey}`,
        );
        if (!encryptedBytes) {
          throw new Error(
            'Attachment file data not found in simulation storage',
          );
        }

        const decryptedBytes = await this.encryptionService.decryptBytes(
          encryptedBytes,
          fileKey,
        );

        const blob = new Blob([decryptedBytes], {
          type: file.mimeType || 'application/octet-stream',
        });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = decryptedName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } catch (err: any) {
        console.error(err);
        alert('Failed to decrypt attachment: ' + (err.message || err));
      }
    } else {
      alert(`Downloading attachment (Legacy): ${file.originalName}`);
      const blob = new Blob(
        [`Decrypted content of: ${file.originalName} (${file.storageKey})`],
        { type: 'text/plain' },
      );
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.originalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }
  }

  // Group Settings Form State
  editGroupName = '';
  editGroupDescription = '';
  editGroupVisibility: 'private' | 'invite_only' | 'public_readonly' =
    'private';
  editGroupCurrency = 'USD';
  editGroupCarryForward = false;

  isSavingSettings = false;
  settingsError = '';
  settingsSuccess = '';

  // Contributions State
  contributionMonth = new Date().toISOString().slice(0, 7);
  contributionsList: GroupContributionResponse[] = [];
  isLoadingContributions = false;
  isSavingContributions = false;
  contributionError = '';
  contributionSuccess = '';

  fetchRecurringExpenses(groupId: string) {
    this.isLoadingRecurring.set(true);
    this.recurringError.set(false);
    this.recurringExpensesService.getRecurringExpenses(groupId).subscribe({
      next: (res) => {
        this.recurringExpenses.set(res || []);
        this.isLoadingRecurring.set(false);
      },
      error: (err) => {
        console.error('Failed to fetch recurring expenses', err);
        this.isLoadingRecurring.set(false);
        this.recurringError.set(true);
      },
    });
  }

  openRecurringExpenseForm(template?: any) {
    this.selectedRecurringExpenseForEdit.set(template || null);
    this.isRecurringExpenseFormOpen.set(true);
  }

  closeRecurringExpenseForm() {
    this.selectedRecurringExpenseForEdit.set(null);
    this.isRecurringExpenseFormOpen.set(false);
  }

  onRecurringExpenseSaved(saved?: { firstOccurrenceGenerated?: boolean }) {
    const g = this.group();
    if (g?.id) {
      this.fetchRecurringExpenses(g.id);
      // When the template's start date is today, the backend materializes the
      // first occurrence immediately — refresh the ledger (and balances/history)
      // exactly like a manual expense create so it shows without a reload.
      if (saved?.firstOccurrenceGenerated) {
        this.onExpenseCreated();
      }
    }
    this.closeRecurringExpenseForm();
  }

  deleteRecurringExpense(id: string) {
    if (
      confirm(
        'Are you sure you want to delete this recurring expense schedule?',
      )
    ) {
      this.recurringExpensesService.deleteRecurringExpense(id).subscribe({
        next: () => {
          const g = this.group();
          if (g?.id) {
            this.fetchRecurringExpenses(g.id);
          }
        },
        error: (err) =>
          alert(err.error?.message || 'Failed to delete recurring expense'),
      });
    }
  }

  toggleRecurringExpenseStatus(template: any) {
    const nextStatus = template.status === 'active' ? 'paused' : 'active';
    this.recurringExpensesService
      .updateRecurringExpense(template.id, {
        status: nextStatus,
        version: template.version,
      })
      .subscribe({
        next: () => {
          const g = this.group();
          if (g?.id) {
            this.fetchRecurringExpenses(g.id);
          }
        },
        error: (err) => alert(err.error?.message || 'Failed to update status'),
      });
  }

  setTab(
    tab:
      | 'ledger'
      | 'analytics'
      | 'history'
      | 'trash'
      | 'settings'
      | 'recurring',
  ) {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab },
      queryParamsHandling: 'merge',
    });
  }

  saveGroupSettings() {
    const g = this.group();
    if (!g) return;
    this.isSavingSettings = true;
    this.settingsError = '';
    this.settingsSuccess = '';

    this.groupsService
      .updateGroup(g.id, {
        name: this.editGroupName,
        description: this.editGroupDescription,
        visibility: this.editGroupVisibility,
        currency: this.editGroupCurrency,
        carryForwardEnabled: this.editGroupCarryForward,
        version: g.version,
      })
      .subscribe({
        next: (res) => {
          this.group.set(res);
          this.isSavingSettings = false;
          this.settingsSuccess = 'Group settings updated successfully!';
          setTimeout(() => (this.settingsSuccess = ''), 3000);
        },
        error: (err) => {
          this.isSavingSettings = false;
          this.settingsError =
            err.error?.message || 'Failed to update group settings.';
        },
      });
  }

  openArchiveDialog() {
    this.archiveConfirmName.set('');
    this.archiveReason.set('');
    this.archiveError.set('');
    this.isArchiveDialogOpen.set(true);
  }

  closeArchiveDialog() {
    this.isArchiveDialogOpen.set(false);
    this.archiveConfirmName.set('');
    this.archiveReason.set('');
    this.archiveError.set('');
  }

  confirmArchiveGroup() {
    const g = this.group();
    if (!g || !this.archiveNameMatches()) return;
    this.isArchiving.set(true);
    this.archiveError.set('');

    this.groupsService
      .archiveGroup(g.id, this.archiveReason() || undefined)
      .subscribe({
        next: () => {
          this.isArchiving.set(false);
          this.closeArchiveDialog();
          this.router.navigate(['/groups']);
        },
        error: (err) => {
          this.isArchiving.set(false);
          this.archiveError.set(
            err.error?.message || 'Failed to delete group. Please try again.',
          );
        },
      });
  }

  loadContributionsForMonth() {
    const g = this.group();
    if (!g) return;
    this.isLoadingContributions = true;
    this.contributionError = '';
    this.contributionSuccess = '';

    this.groupsService
      .getContributions(g.id, this.contributionMonth)
      .subscribe({
        next: (res) => {
          this.contributionsList = res.map((c) => ({
            ...c,
            amount: Number(c.percentage || 0), // Initialize amount to percentage
          }));
          this.isLoadingContributions = false;
        },
        error: (err) => {
          this.contributionError =
            err.error?.message || 'Failed to load contributions.';
          this.isLoadingContributions = false;
        },
      });
  }

  contributionMode: 'amount' | 'percentage' = 'amount';

  setContributionMode(mode: 'amount' | 'percentage') {
    this.contributionMode = mode;
  }

  getContributionsSum(): number {
    const sum = this.contributionsList.reduce(
      (acc, c) => acc + Number(c.percentage || 0),
      0,
    );
    return Math.round(sum * 100) / 100;
  }

  getCallerRole(): string {
    const userId = this.currentUserId();
    if (!userId) return 'viewer';
    const member = this.members().find((m) => m.user?.id === userId);
    return member ? member.role : 'viewer';
  }

  canChangeRole(member: GroupMember): boolean {
    void member;
    return true;
  }

  canRemoveMember(member: GroupMember): boolean {
    const currentUserId = this.currentUserId();
    if (!currentUserId) return false;

    // Cannot remove self
    if (member.user?.id === currentUserId) return false;

    const callerRole = this.getCallerRole();
    if (callerRole === 'owner') return true;

    // Admin can remove members that are not owner or admin
    if (callerRole === 'admin') {
      const targetRole = member.role as string;
      return targetRole !== 'owner' && targetRole !== 'admin';
    }

    return false;
  }

  updateMemberRole(member: GroupMember, event: Event | string) {
    let newRole: GroupMember['role'];
    if (typeof event === 'string') {
      newRole = event as GroupMember['role'];
    } else {
      const target = event.target as HTMLSelectElement;
      newRole = target.value as GroupMember['role'];
    }
    const g = this.group();
    if (!g) return;

    this.groupsService
      .updateMember(g.id, member.id, { role: newRole })
      .subscribe({
        next: () => {
          alert(
            `Successfully updated role for ${member.user?.displayName || member.user?.email}`,
          );
          this.fetchMembers(g.id);
        },
        error: (err) => {
          alert(err.error?.message || 'Failed to update member role');
        },
      });
  }

  removeOrRevokeMember(member: GroupMember) {
    const actionText =
      member.joinStatus === 'invited' ? 'revoke invitation for' : 'remove';
    if (
      confirm(
        `Are you sure you want to ${actionText} ${member.user?.displayName || member.user?.email}?`,
      )
    ) {
      const g = this.group();
      if (!g) return;

      this.groupsService.removeMember(g.id, member.id).subscribe({
        next: () => {
          alert(
            `Successfully removed ${member.user?.displayName || member.user?.email}`,
          );
          this.fetchMembers(g.id);
        },
        error: (err) => {
          alert(err.error?.message || 'Failed to remove member');
        },
      });
    }
  }

  onAmountChange() {
    this.calculatePercentagesFromAmounts();
  }

  calculatePercentagesFromAmounts() {
    const totalAmount = this.contributionsList.reduce(
      (sum, c) => sum + (Number(c.amount) || 0),
      0,
    );
    if (totalAmount <= 0) {
      this.contributionsList.forEach((c) => (c.percentage = 0));
      return;
    }

    let sum = 0;
    this.contributionsList.forEach((c) => {
      const rawPct = ((Number(c.amount) || 0) / totalAmount) * 100;
      c.percentage = Math.round(rawPct * 100) / 100;
      sum += c.percentage;
    });

    let diff = 100 - sum;
    diff = Math.round(diff * 100) / 100;

    if (diff !== 0 && this.contributionsList.length > 0) {
      let targetMember = this.contributionsList[0];
      let maxAmount = -1;
      for (const c of this.contributionsList) {
        const amt = Number(c.amount) || 0;
        if (amt > maxAmount) {
          maxAmount = amt;
          targetMember = c;
        }
      }
      if (targetMember) {
        targetMember.percentage =
          Math.round((targetMember.percentage + diff) * 100) / 100;
      }
    }
  }

  getContributionsAmountSum(): number {
    const sum = this.contributionsList.reduce(
      (acc, c) => acc + Number(c.amount || 0),
      0,
    );
    return Math.round(sum * 100) / 100;
  }

  saveContributions() {
    const g = this.group();
    if (!g) return;

    // Run calculation once more to be completely sure percentages are correct
    if (this.contributionMode === 'amount') {
      this.calculatePercentagesFromAmounts();
    }

    const sum = this.contributionsList.reduce(
      (acc, c) => acc + Number(c.percentage || 0),
      0,
    );
    const roundedSum = Math.round(sum * 100) / 100;
    if (roundedSum !== 100) {
      if (
        this.contributionMode === 'amount' &&
        this.getContributionsAmountSum() > 0
      ) {
        this.contributionError =
          'Internal calculation failed to distribute exactly 100%';
      } else {
        this.contributionError =
          'Total contribution percentages must equal exactly 100% (currently ' +
          roundedSum +
          '%).';
      }
      return;
    }

    this.isSavingContributions = true;
    this.contributionError = '';
    this.contributionSuccess = '';

    const payload = {
      ledgerMonth: this.contributionMonth,
      contributions: this.contributionsList.map((c) => ({
        memberId: c.memberId,
        percentage: Number(c.percentage),
      })),
    };

    this.groupsService.updateContributions(g.id, payload).subscribe({
      next: () => {
        this.isSavingContributions = false;
        this.contributionSuccess =
          this.contributionMode === 'amount'
            ? 'Contribution amounts saved successfully!'
            : 'Contribution percentages saved successfully!';
        this.fetchCarryForward(g.id);
        setTimeout(() => (this.contributionSuccess = ''), 3000);
      },
      error: (err) => {
        this.isSavingContributions = false;
        this.contributionError =
          err.error?.message || 'Failed to save contributions.';
      },
    });
  }

  openConfirmCloseMonth() {
    this.closeMonthError.set(null);
    this.closeMonthSuccess.set(null);
    this.isConfirmCloseMonthOpen.set(true);
  }

  onCloseMonthConfirmed() {
    this.isConfirmCloseMonthOpen.set(false);
    const g = this.group();
    if (!g) return;

    this.isClosingMonth.set(true);
    this.closeMonthError.set(null);
    this.closeMonthSuccess.set(null);

    this.groupsService.closeMonth(g.id, this.closeMonthSelected()).subscribe({
      next: (res) => {
        this.isClosingMonth.set(false);
        this.closeMonthSuccess.set(
          `Month ${this.closeMonthSelected()} closed successfully! ${res.carryForwardExpenseCount} rollover expense(s) created.`,
        );
        this.fetchExpenses(g.id);
        this.fetchBalances(g.id);
        this.fetchHistoryLogs(g.id);
        this.fetchCarryForward(g.id);
        setTimeout(() => this.closeMonthSuccess.set(null), 5000);
      },
      error: (err) => {
        this.isClosingMonth.set(false);
        this.closeMonthError.set(
          err.error?.message || 'Failed to close the billing month.',
        );
      },
    });
  }

  onCloseMonthCancelled() {
    this.isConfirmCloseMonthOpen.set(false);
  }
}
