import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  inject,
  DestroyRef,
  signal,
  computed,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { CurrencyPipe, DatePipe } from '@angular/common';
import {
  ReactiveFormsModule,
  FormsModule,
  FormBuilder,
  Validators,
} from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { jwtDecode } from 'jwt-decode';
import {
  DuplicateExpenseMatch,
  ExpensesService,
} from '../../services/expenses.service';
import { FriendsService } from '../../../../features/friends/services/friends.service';
import { SubmitButtonComponent } from '../../../../shared/components/submit-button/submit-button.component';
import {
  ExpenseSplitInputDto,
  GroupMember,
  JwtPayload,
  UpdateExpenseDto,
  UserSearchResult,
} from '@finmate/data-models';
import { Store } from '@ngxs/store';
import { ClientEncryptionService } from '../../../../core/services/encryption.service';
import {
  GroupKeyService,
  GroupKeyResult,
} from '../../../../core/services/group-key.service';
import { environment } from '../../../../../environments/environment';
import { GroupExpense } from '../../pages/group-detail/group-detail.component';
import {
  DropdownComponent,
  DropdownOption,
} from '../../../../shared/components/dropdown/dropdown.component';
import {
  CATEGORY_OPTIONS,
  CURRENCY_OPTIONS,
} from '../../../../core/constants/app.constants';
import { CryptoRecoveryPanelComponent } from '../../../../shared/components/crypto-recovery-panel/crypto-recovery-panel.component';
import { CryptoRecoveryQueueService } from '../../../../core/services/crypto-recovery-queue.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReceiptCaptureComponent } from '../../../documents/receipt-capture.component';
import { mapDraftToExpensePrefill } from '../../../documents/expense-draft-prefill';
import { ConfirmedDocumentDraft } from '../../../documents/document-review.model';

/**
 * One row of the edit-mode "Changes" summary. `key` matches the form control
 * name (or a synthetic name like 'participants'/'attachments') so the template
 * can both list the change and highlight the corresponding field.
 */
export interface ExpenseFieldChange {
  key: string;
  label: string;
  from: string;
  to: string;
}

/**
 * Snapshot of an expense's editable state, captured when the modal opens in
 * edit mode. Every field the form can touch is recorded here so the current
 * form state can be diffed against it (see `changeSummary`).
 */
type EditableSplitMode = 'equal' | 'fixed';

interface ExpenseSnapshot {
  title: string;
  description: string;
  amountTotal: number | null;
  currency: string;
  category: string;
  transactionType: 'expense' | 'refund';
  expenseDate: string;
  paidByUserId: string;
  participantIds: string[];
  attachmentKeys: string[];
}

/**
 * Additive create-mode pre-fill (DOC-3E). A document-review `ConfirmedDocumentDraft` is
 * mapped to this by `mapDraftToExpensePrefill` and passed via the `prefill` input to seed
 * ONLY these non-finance-calculation fields. It never sets payer, split, refund, or
 * settlement — the user still chooses those and must explicitly submit. Ignored in edit mode.
 */
export interface ExpenseDraftPrefill {
  title?: string | null;
  amountTotal?: number | null;
  currency?: string | null;
  category?: string | null;
  expenseDate?: string | null;
}

@Component({
  selector: 'app-create-expense-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    SubmitButtonComponent,
    DropdownComponent,
    CryptoRecoveryPanelComponent,
    CurrencyPipe,
    DatePipe,
    ReceiptCaptureComponent,
  ],
  templateUrl: './create-expense-modal.component.html',
})
export class CreateExpenseModalComponent implements OnChanges {
  private expensesService = inject(ExpensesService);
  private friendsService = inject(FriendsService);
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);
  private encryptionService = inject(ClientEncryptionService);
  private groupKeyService = inject(GroupKeyService);
  private store = inject(Store);
  private http = inject(HttpClient);
  private recoveryQueue = inject(CryptoRecoveryQueueService);
  private baseUrl = environment.apiBaseUrl;

  currencyOptions: DropdownOption[] = CURRENCY_OPTIONS;

  categoryOptions: DropdownOption[] = CATEGORY_OPTIONS;

  get payerOptions(): DropdownOption[] {
    return this.availablePayers.map((p) => ({
      value: p.id,
      label: p.name,
    }));
  }

  @Input() groupId: string | null = null;
  @Input() groupCurrency!: string;
  /** Group type from the group model; drives the household-specific UX. */
  @Input() groupType: string | null = null;
  @Input() members: GroupMember[] = [];
  @Input() expense: GroupExpense | null = null; // To support edit mode
  @Input() defaultCategory: string = CATEGORY_OPTIONS[0].value;
  /**
   * Optional create-mode pre-fill from a confirmed document/receipt draft (DOC-3E).
   * Seeds only non-finance-calculation fields (title/amount/currency/category/date);
   * never payer/split/refund/settlement. Ignored in edit mode. The user still submits.
   */
  @Input() prefill: ExpenseDraftPrefill | null = null;

  @Output() expenseCreated = new EventEmitter<void>();
  @Output() closeModalEvent = new EventEmitter<void>();

  selectedUserIds = new Set<string>();
  splitMode: EditableSplitMode = 'equal';
  splitDraftAmounts = new Map<string, number>();
  participantSearchTerm = signal('');
  private splitExplicitlyChanged = false;
  isSubmitting = false;
  errorMessage = '';
  attachedFiles: { name: string; size: string; key: string }[] = [];

  // --- Possible-duplicate warning (amount + date + scope + type match) ---
  showDuplicateDialog = signal(false);
  potentialDuplicates = signal<DuplicateExpenseMatch[]>([]);
  isCheckingDuplicates = signal(false);
  /** Consumed by the very next onSubmit() call only — set when the user
   *  confirms "This is a New Transaction" so that specific resubmit skips
   *  the check it already showed them, without suppressing future checks. */
  private skipDuplicateCheckOnce = false;

  /**
   * Reactive group-key availability, checked proactively as soon as groupId
   * is known (see ngOnChanges) so the form can warn/disable before the user
   * fills it out, rather than only discovering a blocked key mid-submit.
   */
  scopeKeyStatus = signal<GroupKeyResult['status'] | 'idle'>('idle');

  scopeKeyBlocked = computed(() => {
    const status = this.scopeKeyStatus();
    if (!this.groupId || status === 'ready' || status === 'idle') {
      return false;
    }
    // Owners/admins facing 'pending' can still submit — resolveGroupScopeKey
    // will mint the key for them inline. Every other status (and 'pending'
    // for non-owners/admins) genuinely blocks submission.
    return !(status === 'pending' && this.isCurrentUserOwnerOrAdmin());
  });

  private isCurrentUserOwnerOrAdmin(): boolean {
    const currentUserId = this.getCurrentUserId();
    return this.members.some(
      (m) =>
        m.user?.id === currentUserId &&
        (m.role === 'owner' || m.role === 'admin'),
    );
  }

  scopeKeyMessage = computed(() => {
    switch (this.scopeKeyStatus()) {
      // 'no_session' has no case here — that's the crypto session being
      // unavailable, shown via the shared <app-crypto-recovery-panel>
      // instead of a component-local message (see the template). Every
      // other case below is about this specific group's key, not the
      // session, and keeps its own message.
      case 'pending':
        return "This group's encryption key isn't available on this device yet. Try refreshing, or ask the group owner to open the group once to share it.";
      case 'no_access':
        return 'You no longer have access to this group.';
      case 'rate_limited':
        return 'Too many requests. Please wait a moment and try again.';
      case 'error':
        return 'Could not check the group encryption key. Please try again.';
      default:
        return '';
    }
  });

  // Direct splits with friends fields
  splitWithFriend = false;
  searchQuery = '';
  searchResults: UserSearchResult[] = [];
  resolvedFriends: Map<string, UserSearchResult> = new Map();
  isSearching = false;
  private searchTimeoutId?: ReturnType<typeof setTimeout>;
  private searchSub?: Subscription;

  // --- Edit-mode change detection ---------------------------------------
  /**
   * The expense's editable state as it was when the modal opened in edit
   * mode. Null in create mode (nothing to diff against).
   */
  private originalSnapshot: ExpenseSnapshot | null = null;

  /**
   * The expense's original split rows, preserved verbatim so an edit that
   * doesn't touch the participant set keeps the exact split configuration
   * (equal / fixed / percent / share). Without this, onSubmit() would rebuild
   * every split as `equal`, silently flattening a non-equal split just because
   * the user changed an unrelated field like the title.
   */
  private originalSplits: ExpenseSplitInputDto[] | null = null;

  /**
   * Monotonic counter bumped on every edit (form value change, participant
   * toggle, attachment add/remove). Read inside the change-detection computeds
   * purely as a reactive dependency: the underlying state (reactive form,
   * `selectedUserIds` Set, `attachedFiles` array) is mutated imperatively and
   * isn't otherwise signal-tracked, so this is what makes the summary recompute.
   */
  private changeTick = signal(0);

  private markChanged(): void {
    this.changeTick.update((n) => n + 1);
  }

  // --- DOC-3F: receipt-capture launcher (additive, create-mode, flag-gated) ----------
  /** Mirrors the backend `document.intelligence` flag; default OFF (hides the entry point). */
  readonly docIntelEnabled = environment.documentIntelligence === true;
  /** Whether the in-modal receipt-capture overlay is open. */
  readonly showReceiptCapture = signal(false);

  /** Open receipt capture. Create-mode + flag only; scope (group/personal) is already this modal's. */
  openReceiptCapture(): void {
    if (this.isEditMode || !this.docIntelEnabled) return;
    this.showReceiptCapture.set(true);
  }

  /**
   * A receipt draft was explicitly confirmed. Map ONLY the safe header fields and seed the
   * form via the existing create-mode pre-fill — never payer/split/refund/settlement, never
   * an expense. The user still reviews and explicitly submits through the normal flow.
   */
  onReceiptConfirmed(draft: ConfirmedDocumentDraft): void {
    if (this.isEditMode) return;
    this.prefill = mapDraftToExpensePrefill(draft);
    this.applyPrefill(this.prefill);
    this.showReceiptCapture.set(false);
  }

  /** Total-only / cancelled — no extraction result is applied; return to the normal flow. */
  closeReceiptCapture(): void {
    this.showReceiptCapture.set(false);
  }

  /**
   * Seed create-mode form fields from a confirmed document draft (DOC-3E). Patches ONLY the
   * provided, non-empty non-finance-calculation fields — payer, split, refund, and
   * settlement are never touched, so the user's explicit choices and submit still govern.
   */
  private applyPrefill(prefill: ExpenseDraftPrefill): void {
    const patch: Partial<{
      title: string;
      amountTotal: number | null;
      currency: string;
      category: string;
      expenseDate: string;
    }> = {};
    if (prefill.title != null && prefill.title !== '') patch.title = prefill.title;
    if (prefill.amountTotal != null) patch.amountTotal = prefill.amountTotal;
    if (prefill.currency != null && prefill.currency !== '') patch.currency = prefill.currency;
    if (prefill.category != null && prefill.category !== '') patch.category = prefill.category;
    if (prefill.expenseDate != null && prefill.expenseDate !== '') patch.expenseDate = prefill.expenseDate;
    this.expenseForm.patchValue(patch);
    this.markChanged();
  }

  get isEditMode(): boolean {
    return !!this.expense;
  }

  /**
   * Only the fields that actually differ from the original, in display order.
   * Empty when nothing changed (or in create mode).
   */
  changeSummary = computed<ExpenseFieldChange[]>(() => {
    this.changeTick(); // reactive dependency — see changeTick doc
    const snap = this.originalSnapshot;
    if (!snap) return [];

    const v = this.expenseForm.getRawValue();
    const changes: ExpenseFieldChange[] = [];

    const title = v.title ?? '';
    if (title !== snap.title) {
      changes.push({
        key: 'title',
        label: 'Title',
        from: snap.title,
        to: title,
      });
    }

    // Coerce both sides: `amountTotal` is typed number but a decimal column
    // can serialize as a string at runtime, which would otherwise read as a
    // spurious change the moment the modal opens.
    const amount =
      v.amountTotal === null || v.amountTotal === undefined
        ? null
        : Number(v.amountTotal);
    if (amount !== snap.amountTotal) {
      changes.push({
        key: 'amountTotal',
        label: 'Amount',
        from: this.formatAmount(snap.amountTotal, snap.currency),
        to: this.formatAmount(amount, v.currency ?? snap.currency),
      });
    }

    const currency = v.currency ?? '';
    if (currency !== snap.currency) {
      changes.push({
        key: 'currency',
        label: 'Currency',
        from: snap.currency,
        to: currency,
      });
    }

    const category = v.category ?? '';
    if (category !== snap.category) {
      changes.push({
        key: 'category',
        label: 'Category',
        from: this.categoryLabel(snap.category),
        to: this.categoryLabel(category),
      });
    }

    const transactionType = (v.transactionType ?? 'expense') as
      | 'expense'
      | 'refund';
    if (transactionType !== snap.transactionType) {
      changes.push({
        key: 'transactionType',
        label: 'Type',
        from: snap.transactionType === 'refund' ? 'Refund' : 'Expense',
        to: transactionType === 'refund' ? 'Refund' : 'Expense',
      });
    }

    const expenseDate = v.expenseDate ?? '';
    if (expenseDate !== snap.expenseDate) {
      changes.push({
        key: 'expenseDate',
        label: 'Date',
        from: snap.expenseDate,
        to: expenseDate,
      });
    }

    const paidBy = v.paidByUserId ?? '';
    if (paidBy !== snap.paidByUserId) {
      changes.push({
        key: 'paidByUserId',
        label: 'Paid by',
        from: this.userName(snap.paidByUserId),
        to: this.userName(paidBy),
      });
    }

    const description = v.description ?? '';
    if (description !== snap.description) {
      changes.push({
        key: 'description',
        label: 'Note',
        from: snap.description || '—',
        to: description || '—',
      });
    }

    const currentParticipants = Array.from(this.selectedUserIds).sort();
    const participantsChanged = !this.arraysEqual(
      currentParticipants,
      snap.participantIds,
    );
    if (participantsChanged) {
      changes.push({
        key: 'participants',
        label: 'Participants',
        from: this.participantNames(snap.participantIds),
        to: this.participantNames(currentParticipants),
      });
    } else if (this.splitExplicitlyChanged) {
      changes.push({
        key: 'participants',
        label: 'Split',
        from: 'Original split',
        to: this.splitSummary(),
      });
    }

    const currentExisting = this.attachedFiles
      .filter((f) => !f.key.startsWith('pending:'))
      .map((f) => f.key)
      .sort();
    const pendingCount = this.attachedFiles.length - currentExisting.length;
    const removedExisting = snap.attachmentKeys.filter(
      (k) => !currentExisting.includes(k),
    );
    if (pendingCount > 0 || removedExisting.length > 0) {
      changes.push({
        key: 'attachments',
        label: 'Receipts',
        from: this.fileCountLabel(snap.attachmentKeys.length),
        to: this.fileCountLabel(this.attachedFiles.length),
      });
    }

    return changes;
  });

  /** Field keys that differ from the original — used to highlight inputs. */
  modifiedFields = computed(
    () => new Set(this.changeSummary().map((c) => c.key)),
  );

  hasChanges = computed(() => this.changeSummary().length > 0);

  isFieldModified(key: string): boolean {
    return this.modifiedFields().has(key);
  }

  private arraysEqual(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  private symbolFor(currency?: string): string {
    if (currency === 'INR') return '₹';
    if (currency === 'EUR') return '€';
    return '$';
  }

  private formatAmount(amount: number | null, currency?: string): string {
    if (amount === null || amount === undefined) return '—';
    return `${this.symbolFor(currency)}${Number(amount).toFixed(2)}`;
  }

  private categoryLabel(value: string): string {
    return this.categoryOptions.find((o) => o.value === value)?.label ?? value;
  }

  /**
   * True for household groups. Household expenses are contribution records
   * attributed to the payer (payer-based personal spending), not cost-sharing,
   * so the split editor is hidden and the full amount is shown as the payer's
   * household contribution. Normal groups are unaffected.
   */
  isHousehold(): boolean {
    return this.groupType === 'household';
  }

  /**
   * Display name of the currently selected payer, for the household helper text.
   * Falls back to a neutral phrase when no payer is resolved yet.
   */
  householdPayerName(): string {
    const id = this.expenseForm.get('paidByUserId')?.value ?? '';
    const name = id ? this.userName(id) : '';
    return name && name !== '—' ? name : 'the selected member';
  }

  private userName(id: string): string {
    if (!id) return '—';
    const payer = this.payerOptions.find((o) => o.value === id);
    if (payer) return payer.label;
    const participant = this.availableParticipants.find((p) => p.id === id);
    if (participant) return participant.name ?? 'Member';
    const split = this.originalSplits?.find(
      (s) => s.participantUserId === id,
    ) as
      | {
          participantUser?: { displayName?: string };
          participantUserDisplayName?: string;
        }
      | undefined;
    return (
      split?.participantUser?.displayName ||
      split?.participantUserDisplayName ||
      'Member'
    );
  }

  private participantNames(ids: string[]): string {
    if (ids.length === 0) return 'None';
    return ids.map((id) => this.userName(id)).join(', ');
  }

  private fileCountLabel(count: number): string {
    return count === 1 ? '1 file' : `${count} files`;
  }
  private amountCents(value: number | null | undefined): number {
    if (
      value === null ||
      value === undefined ||
      !Number.isFinite(Number(value))
    ) {
      return 0;
    }
    return Math.round((Number(value) + Number.EPSILON) * 100);
  }

  private fromCents(value: number): number {
    return Math.round(value) / 100;
  }

  participantName(participant: { name?: string | null }): string {
    return participant.name || 'Member';
  }

  participantInitials(name: string | null | undefined): string {
    return (
      (name || 'Member')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('') || '?'
    );
  }

  filteredParticipants = computed(() => {
    this.changeTick();
    const term = this.participantSearchTerm().trim().toLowerCase();
    const participants = this.availableParticipants;
    if (participants.length < 8 || !term) return participants;
    return participants.filter((participant) =>
      this.participantName(participant).toLowerCase().includes(term),
    );
  });

  selectedParticipants = computed(() => {
    this.changeTick();
    return this.availableParticipants.filter((participant) =>
      this.selectedUserIds.has(participant.id),
    );
  });

  splitTotalCents = computed(() => {
    this.changeTick();
    return this.amountCents(this.expenseForm.get('amountTotal')?.value);
  });

  /**
   * Live per-participant equal share (in cents), recomputed from the total and
   * the current selection. Drives the read-only amounts shown in Equal mode so
   * they update instantly as the amount or participant set changes — the equal
   * split is never stored in `splitDraftAmounts` (that map is only meaningful in
   * Custom/fixed mode). Remainder cents go to the first N participants, matching
   * `seedSplitDraftAmounts` so switching Equal → Custom pre-fills identical rows.
   */
  equalShareCents = computed<Map<string, number>>(() => {
    this.changeTick();
    const participants = this.selectedParticipants();
    const map = new Map<string, number>();
    if (!participants.length) return map;
    const totalCents = this.splitTotalCents();
    const baseCents = Math.floor(totalCents / participants.length);
    const remainder = totalCents - baseCents * participants.length;
    participants.forEach((participant, index) => {
      map.set(participant.id, baseCents + (index < remainder ? 1 : 0));
    });
    return map;
  });

  splitAssignedCents = computed(() => {
    this.changeTick();
    if (this.splitMode !== 'fixed') return this.splitTotalCents();
    return this.selectedParticipants().reduce(
      (sum, participant) =>
        sum + this.amountCents(this.splitDraftAmounts.get(participant.id) ?? 0),
      0,
    );
  });

  splitRemainingCents = computed(
    () => this.splitTotalCents() - this.splitAssignedCents(),
  );

  splitIsValid = computed(() => {
    this.changeTick();
    if (this.selectedUserIds.size === 0) return false;
    if (this.splitMode === 'equal') return true;
    return this.splitRemainingCents() === 0;
  });

  splitSummary = computed(() => {
    this.changeTick();
    const count = this.selectedUserIds.size;
    if (count === 0) return 'No people selected';
    if (!this.splitExplicitlyChanged && this.originalSplits?.length) {
      const originalType = this.originalSplits[0]?.splitType;
      if (originalType === 'percent')
        return `Percentage split between ${count} people`;
      if (originalType === 'share')
        return `Share split between ${count} people`;
      if (originalType === 'fixed') return `Exact amounts for ${count} people`;
    }
    if (this.splitMode === 'fixed') return `Exact amounts for ${count} people`;
    return `Equal between ${count} ${count === 1 ? 'person' : 'people'}`;
  });

  splitAssignedLabel = computed(() =>
    this.formatAmount(
      this.fromCents(this.splitAssignedCents()),
      this.expenseForm.get('currency')?.value ?? undefined,
    ),
  );

  splitRemainingLabel = computed(() =>
    this.formatAmount(
      Math.abs(this.fromCents(this.splitRemainingCents())),
      this.expenseForm.get('currency')?.value ?? undefined,
    ),
  );

  splitTotalLabel = computed(() =>
    this.formatAmount(
      this.fromCents(this.splitTotalCents()),
      this.expenseForm.get('currency')?.value ?? undefined,
    ),
  );

  constructor() {
    this.expenseForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.markChanged());

    this.destroyRef.onDestroy(() => {
      if (this.searchTimeoutId) {
        clearTimeout(this.searchTimeoutId);
      }
      this.searchSub?.unsubscribe();
    });
  }

  expenseForm = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(160)]],
    description: [''],
    transactionType: ['expense' as 'expense' | 'refund', [Validators.required]],
    amountTotal: [
      null as number | null,
      [Validators.required, Validators.min(0.01)],
    ],
    currency: ['', [Validators.required]],
    category: [
      CATEGORY_OPTIONS[0].value,
      [Validators.required, Validators.maxLength(64)],
    ],
    expenseDate: [this.getTodayDateString(), [Validators.required]],
    paidByUserId: ['', [Validators.required]],
  });

  /** True when the user is recording a refund (money returning to the group). */
  isRefund = computed(() => {
    this.changeTick(); // reactive dependency — form is mutated imperatively
    return this.expenseForm.get('transactionType')?.value === 'refund';
  });

  get transactionNoun(): string {
    return this.isRefund() ? 'Refund' : 'Expense';
  }

  setTransactionType(type: 'expense' | 'refund'): void {
    this.expenseForm.patchValue({ transactionType: type });
    this.markChanged();
  }

  get currencySymbol(): string {
    const cur = this.expenseForm.get('currency')?.value;
    if (cur === 'INR') return '₹';
    if (cur === 'EUR') return '€';
    return '$';
  }

  getTodayDateString(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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

  /**
   * Resolves the group data key for encryption, self-healing inline if it
   * isn't cached yet — mirrors GroupMembersComponent.ensureGroupKey().
   *
   * The naive `getGroupDataKey() ?? createGroupKey()` fallback this replaced
   * would unconditionally try to mint a brand-new key for ANY member whose
   * key wasn't cached yet, including when the real cause is simply that
   * their own master key/session isn't loaded (a `no_session` result) — in
   * which case createGroupKey() also needs the master key and throws the
   * unrelated-sounding "Master key not loaded", and, in the case where a
   * key already exists but isn't yet provisioned to this member, minting
   * blind would risk generating a second, divergent key. Only owners/admins
   * facing a genuinely un-minted (`pending`) key attempt to create one.
   */
  private scopeKeyInFlight?: Promise<CryptoKey>;

  /**
   * De-duplicates concurrent resolutions (e.g. a fast double-submit before the
   * disabled attribute reflects, or a submit racing a proactive re-check) so
   * `createAndStoreGroupKey()` — which has no in-flight guard of its own and
   * would otherwise mint and POST a second key — can only run once per window.
   */
  private resolveGroupScopeKey(groupId: string): Promise<CryptoKey> {
    if (this.scopeKeyInFlight) {
      return this.scopeKeyInFlight;
    }
    const inFlight = this.doResolveGroupScopeKey(groupId).finally(() => {
      this.scopeKeyInFlight = undefined;
    });
    this.scopeKeyInFlight = inFlight;
    return inFlight;
  }

  private async doResolveGroupScopeKey(groupId: string): Promise<CryptoKey> {
    const result = await this.groupKeyService.resolveGroupKey(groupId);
    this.scopeKeyStatus.set(result.status);
    if (result.status === 'ready') {
      return result.key;
    }

    if (result.status === 'pending') {
      if (this.isCurrentUserOwnerOrAdmin()) {
        const key = await this.groupKeyService.createAndStoreGroupKey(groupId);
        this.scopeKeyStatus.set('ready');
        return key;
      }
      throw new Error(
        "Your group key hasn't been shared with you yet. Try refreshing, or contact the group owner.",
      );
    }

    if (result.status === 'no_session') {
      // The template already shows <app-crypto-recovery-panel> and disables
      // Save via scopeKeyBlocked() for this status — reaching here at all
      // means a race beat that gate. Point at the same recovery action
      // rather than inventing a different message here.
      throw new Error(
        'Your session needs to be unlocked. Use the "Unlock" panel above, then try again.',
      );
    }

    throw new Error('Encryption key not loaded/derived. Please try again.');
  }

  get availablePayers(): { id: string; name: string }[] {
    if (this.groupId) {
      // Pending (Contact-backed) members have no User account and can't be
      // selected as payer in this User-keyed flow.
      return this.members
        .filter((m) => !!m.user)
        .map((m) => ({
          id: m.user!.id,
          name: m.user!.displayName || m.user!.username || m.user!.email || '',
        }));
    } else {
      const currentUserId = this.getCurrentUserId();
      const list = [];
      if (currentUserId) {
        list.push({ id: currentUserId, name: 'You' });
      }
      for (const friend of this.resolvedFriends.values()) {
        list.push({
          id: friend.id,
          name: friend.displayName || friend.username || friend.email || '',
        });
      }
      return list;
    }
  }

  get availableParticipants() {
    if (this.groupId) {
      return this.members
        .filter((m) => m.role !== 'spectator' && !!m.user)
        .map((m) => ({
          id: m.user!.id,
          name: m.user!.displayName || m.user!.email,
        }));
    } else {
      const currentUserId = this.getCurrentUserId();
      const list = [];
      if (currentUserId) {
        list.push({ id: currentUserId, name: 'You' });
      }
      for (const friend of this.resolvedFriends.values()) {
        list.push({ id: friend.id, name: friend.displayName });
      }
      return list;
    }
  }

  /**
   * Resolves a split/payer reference to a *user* id — the id space the payer
   * dropdown and participant checkboxes are keyed by. Group expenses carry the
   * reference as a GroupMember id (participantUserId/paidByUserId come back
   * null), so fall back to looking the member up in `members`. Returns null for
   * pending (userless) members, which can't be represented in the user-keyed
   * selection.
   */
  private resolveParticipantUserId(
    userId?: string | null,
    groupMemberId?: string | null,
  ): string | null {
    if (userId) return userId;
    if (groupMemberId) {
      const member = this.members.find((m) => m.id === groupMemberId);
      return member?.user?.id ?? null;
    }
    return null;
  }

  ngOnChanges(changes: SimpleChanges) {
    // Runs before the edit-mode early return below so the proactive key check
    // also happens when the modal opens in edit mode (both `expense` and
    // `groupId` arrive in the same change). Re-checked on `members` changes so
    // that when the parent's background key self-heal finishes and re-emits
    // members, a previously-blocked banner clears automatically.
    if (changes['groupId'] || changes['members']) {
      if (this.groupId) {
        if (changes['groupId'] || this.scopeKeyStatus() !== 'ready') {
          void this.refreshScopeKeyStatus(this.groupId);
        }
      } else {
        this.scopeKeyStatus.set('idle');
      }
    }

    if (!this.expense && changes['defaultCategory'] && this.defaultCategory) {
      this.expenseForm.patchValue({ category: this.defaultCategory });
    }

    // DOC-3E: additive create-mode pre-fill from a confirmed receipt draft. Seeds only
    // non-finance-calculation fields; never payer/split/refund/settlement. Edit mode ignores it.
    if (!this.expense && changes['prefill'] && this.prefill) {
      this.applyPrefill(this.prefill);
    }

    if (changes['expense'] && this.expense) {
      // Group expenses store the payer and split participants against
      // GroupMember rows (frozen rule), so the server returns paidByUserId /
      // participantUserId as null and carries the ids in paidByGroupMemberId /
      // participantGroupMemberId. The payer dropdown and participant checkboxes
      // are keyed by *user* id, so resolve member ids back to user ids here or
      // "Paid By" and "Split Equally Among" render empty in edit mode.
      const resolvedPayerUserId = this.resolveParticipantUserId(
        this.expense.paidByUserId,
        this.expense.paidByGroupMemberId,
      );

      this.expenseForm.patchValue({
        title: this.expense.title,
        description: this.expense.description || '',
        transactionType:
          (this.expense.transactionType as 'expense' | 'refund') ?? 'expense',
        amountTotal: this.expense.amountTotal,
        currency: this.expense.currency,
        category: this.expense.category,
        expenseDate: this.expense.expenseDate,
        paidByUserId: resolvedPayerUserId,
      });

      this.selectedUserIds.clear();
      if (this.expense.splits) {
        this.expense.splits.forEach((s) => {
          const uid = this.resolveParticipantUserId(
            s.participantUserId,
            s.participantGroupMemberId,
          );
          if (uid) {
            this.selectedUserIds.add(uid);
          }
        });
      }

      // If group-less direct split expense
      if (!this.groupId && this.expense.splits) {
        const currentUserId = this.getCurrentUserId();
        const otherSplits = this.expense.splits.filter(
          (s) => s.participantUserId && s.participantUserId !== currentUserId,
        );
        if (otherSplits.length > 0) {
          this.splitWithFriend = true;
          otherSplits.forEach((s) => {
            if (s.participantUser) {
              const u = s.participantUser;
              this.resolvedFriends.set(u.id, {
                id: u.id,
                displayName: u.displayName || u.email.split('@')[0],
                email: u.email,
              });
              this.selectedUserIds.add(u.id);
            } else if (s.participantUserId) {
              this.resolvedFriends.set(s.participantUserId, {
                id: s.participantUserId,
                displayName: s.participantUserDisplayName || 'Friend',
                email: '',
              });
              this.selectedUserIds.add(s.participantUserId);
            }
          });
        }
      }

      this.attachedFiles = [];
      if (this.expense.attachments) {
        this.expense.attachments.forEach((a) => {
          this.attachedFiles.push({
            name: a.originalName,
            size: (a.sizeBytes / 1024).toFixed(1) + ' KB',
            key: a.storageKey,
          });
        });
      }

      // Preserve the exact original split rows so an edit that leaves the
      // participant set untouched keeps their split configuration verbatim
      // (see originalSplits doc). Snapshot the whole editable state so the
      // "Changes" summary can diff against it.
      this.originalSplits = this.expense.splits
        ? this.expense.splits.map((s) => ({
            participantUserId: s.participantUserId,
            participantGroupMemberId: s.participantGroupMemberId,
            splitType: s.splitType,
            shareValue: s.shareValue,
          }))
        : null;
      this.splitExplicitlyChanged = false;
      const originalSplitType = this.originalSplits?.[0]?.splitType;
      this.splitMode = originalSplitType === 'fixed' ? 'fixed' : 'equal';
      this.splitDraftAmounts.clear();
      for (const split of this.expense.splits ?? []) {
        const uid = this.resolveParticipantUserId(
          split.participantUserId,
          split.participantGroupMemberId,
        );
        if (uid && split.splitType === 'fixed') {
          this.splitDraftAmounts.set(uid, Number(split.shareValue));
        }
      }
      this.seedSplitDraftAmounts();
      this.originalSnapshot = {
        title: this.expense.title ?? '',
        description: this.expense.description ?? '',
        amountTotal:
          this.expense.amountTotal === null ||
          this.expense.amountTotal === undefined
            ? null
            : Number(this.expense.amountTotal),
        currency: this.expense.currency ?? '',
        category: this.expense.category ?? '',
        transactionType:
          (this.expense.transactionType as 'expense' | 'refund') ?? 'expense',
        expenseDate: this.expense.expenseDate ?? '',
        paidByUserId: resolvedPayerUserId ?? '',
        participantIds: Array.from(this.selectedUserIds).sort(),
        attachmentKeys: (this.expense.attachments ?? [])
          .map((a) => a.storageKey)
          .sort(),
      };
      this.markChanged();
      return;
    }

    // Create mode only. In edit mode the participant selection comes from the
    // expense's own splits (handled in the `expense` branch above, which
    // returns before reaching here); a later members re-emit must not clobber
    // that selection or reset the payer.
    if (changes['members'] && this.members && !this.expense) {
      this.selectedUserIds.clear();
      this.members.forEach((m) => {
        if (
          m.user &&
          (m.joinStatus === 'active' || m.joinStatus === 'invited') &&
          m.role !== 'spectator'
        ) {
          this.selectedUserIds.add(m.user.id);
        }
      });

      const currentUserId = this.getCurrentUserId();
      const registeredMembers = this.members.filter((m) => !!m.user);
      if (
        currentUserId &&
        registeredMembers.some((m) => m.user!.id === currentUserId)
      ) {
        this.expenseForm.patchValue({ paidByUserId: currentUserId });
      } else if (registeredMembers.length > 0) {
        this.expenseForm.patchValue({
          paidByUserId: registeredMembers[0].user!.id,
        });
      }
    }

    if (changes['groupCurrency'] && this.groupCurrency) {
      this.expenseForm.patchValue({ currency: this.groupCurrency });
    }

    if (!this.groupId) {
      const currentUserId = this.getCurrentUserId();
      if (currentUserId) {
        this.expenseForm.patchValue({ paidByUserId: currentUserId });
        this.selectedUserIds.clear();
        this.selectedUserIds.add(currentUserId);
      }
      if (!this.expenseForm.get('currency')?.value) {
        this.expenseForm.patchValue({ currency: 'USD' });
      }
    }
  }

  /** Proactively checks group-key availability and publishes it to scopeKeyStatus. */
  private async refreshScopeKeyStatus(groupId: string): Promise<void> {
    try {
      const result = await this.groupKeyService.resolveGroupKey(groupId);
      // A submit-triggered mint (resolveGroupScopeKey) owns the authoritative
      // status while it runs; don't let a concurrent proactive read stomp it
      // back to a stale pre-mint value.
      if (!this.scopeKeyInFlight) {
        this.scopeKeyStatus.set(result.status);
      }
    } catch {
      if (!this.scopeKeyInFlight) {
        this.scopeKeyStatus.set('error');
      }
    }
  }

  toggleParticipant(userId: string) {
    if (this.selectedUserIds.has(userId)) {
      this.selectedUserIds.delete(userId);
    } else {
      this.selectedUserIds.add(userId);
      if (this.splitMode === 'fixed' && !this.splitDraftAmounts.has(userId)) {
        this.splitDraftAmounts.set(userId, 0);
      }
    }
    this.markChanged();
  }
  selectSplitMode(mode: EditableSplitMode): void {
    const previousMode = this.splitMode;
    if (mode === 'fixed' && previousMode !== 'fixed') {
      this.splitMode = 'equal';
      this.seedSplitDraftAmounts();
    }
    this.splitMode = mode;
    this.splitExplicitlyChanged = true;
    this.seedSplitDraftAmounts();
    this.markChanged();
  }

  /**
   * Focusing an amount field while in Equal mode flips the whole split to
   * Custom (fixed) — the second way to enter Custom mode besides the segmented
   * control (the first is the "Custom" toggle). `selectSplitMode('fixed')` seeds
   * every draft amount from the current equal shares, so the field the user
   * tapped (and every other) starts pre-filled with its equal value, ready to
   * edit. No-op once already in Custom mode.
   */
  onAmountFocus(): void {
    if (this.splitMode === 'equal') {
      this.selectSplitMode('fixed');
    }
  }

  setExactSplitAmount(userId: string, value: number | string | null): void {
    const amount = value === null || value === '' ? 0 : Number(value);
    this.splitDraftAmounts.set(userId, Number.isFinite(amount) ? amount : 0);
    this.splitMode = 'fixed';
    this.splitExplicitlyChanged = true;
    this.markChanged();
  }

  selectAllParticipants(): void {
    this.availableParticipants.forEach((participant) => {
      this.selectedUserIds.add(participant.id);
    });
    this.seedSplitDraftAmounts();
    this.markChanged();
  }

  clearParticipants(): void {
    this.selectedUserIds.clear();
    this.markChanged();
  }

  splitDisplayAmount(userId: string): number {
    // Equal mode reads the live computed share (never the draft map, which only
    // holds Custom/fixed amounts); Custom mode reads the user-entered draft.
    if (this.splitMode === 'equal') {
      return this.fromCents(this.equalShareCents().get(userId) ?? 0);
    }
    return this.splitDraftAmounts.get(userId) ?? 0;
  }

  private seedSplitDraftAmounts(): void {
    const participants = this.selectedParticipants();
    if (!participants.length) return;

    if (this.splitMode === 'fixed') {
      for (const participant of participants) {
        if (!this.splitDraftAmounts.has(participant.id)) {
          this.splitDraftAmounts.set(participant.id, 0);
        }
      }
      return;
    }

    const totalCents = this.splitTotalCents();
    const baseCents = Math.floor(totalCents / participants.length);
    const remainder = totalCents - baseCents * participants.length;
    participants.forEach((participant, index) => {
      this.splitDraftAmounts.set(
        participant.id,
        this.fromCents(baseCents + (index < remainder ? 1 : 0)),
      );
    });
  }

  private currentSplitPayload(): ExpenseSplitInputDto[] {
    if (this.splitMode === 'fixed') {
      return Array.from(this.selectedUserIds).map((userId) => ({
        participantUserId: userId,
        splitType: 'fixed' as const,
        shareValue: this.splitDraftAmounts.get(userId) ?? 0,
      }));
    }

    return Array.from(this.selectedUserIds).map((userId) => ({
      participantUserId: userId,
      splitType: 'equal' as const,
      shareValue: 1,
    }));
  }

  onSplitToggleChange() {
    const currentUserId = this.getCurrentUserId();
    if (!this.splitWithFriend) {
      this.resolvedFriends.clear();
      this.selectedUserIds.clear();
      if (currentUserId) {
        this.selectedUserIds.add(currentUserId);
        this.expenseForm.patchValue({ paidByUserId: currentUserId });
      }
    }
    this.markChanged();
  }

  onSearchChange(query: string) {
    if (this.searchTimeoutId) {
      clearTimeout(this.searchTimeoutId);
      this.searchTimeoutId = undefined;
    }
    this.searchSub?.unsubscribe();

    if (query.trim().length < 2) {
      this.searchResults = [];
      this.isSearching = false;
      return;
    }

    this.isSearching = true;
    this.searchTimeoutId = setTimeout(() => {
      this.searchSub = this.friendsService.searchUsers(query).subscribe({
        next: (users) => {
          this.searchResults = users;
          this.isSearching = false;
        },
        error: () => {
          this.isSearching = false;
        },
      });
    }, 250);
  }

  addFriendToSplit(user: UserSearchResult) {
    this.resolvedFriends.set(user.id, {
      id: user.id,
      displayName: user.displayName || user.email.split('@')[0],
      email: user.email,
    });
    this.selectedUserIds.add(user.id);
    this.searchQuery = '';
    this.searchResults = [];
    this.markChanged();
  }

  removeFriendFromSplit(userId: string) {
    const currentUserId = this.getCurrentUserId();
    if (userId === currentUserId) return;
    this.selectedUserIds.delete(userId);
    this.resolvedFriends.delete(userId);
    this.markChanged();
  }

  closeModal() {
    this.closeModalEvent.emit();
  }

  /** "This is a New Transaction": dismiss the warning and resubmit once,
   *  skipping the check that just ran (it already showed the user these
   *  matches — no need to ask again for this same submit). */
  async confirmNewTransaction(): Promise<void> {
    this.showDuplicateDialog.set(false);
    this.potentialDuplicates.set([]);
    this.skipDuplicateCheckOnce = true;
    await this.onSubmit();
  }

  /** "This is the Same Transaction": cancel the save and return to the form. */
  confirmSameTransaction(): void {
    this.showDuplicateDialog.set(false);
    this.potentialDuplicates.set([]);
  }

  /** Payer/receiver display name for a duplicate-match row in the warning
   *  dialog — falls back gracefully since the match may involve a member
   *  not in the current payer list (e.g. a pending/removed member). */
  duplicatePayerName(item: DuplicateExpenseMatch): string {
    const id = item.paidByUserId;
    if (!id) return 'Unknown';
    const payer = this.availablePayers.find((p) => p.id === id);
    return payer?.name ?? 'Unknown';
  }

  filesToEncrypt: Array<{
    name: string;
    type: string;
    size: number;
    arrayBuffer: ArrayBuffer;
  }> = [];

  async onSubmit() {
    if (!this.groupId && !this.splitWithFriend) {
      const currentUserId = this.getCurrentUserId();
      if (currentUserId) {
        this.selectedUserIds.clear();
        this.selectedUserIds.add(currentUserId);
        this.expenseForm.patchValue({ paidByUserId: currentUserId });
      }
    }

    // Guard against no-op updates: if editing and nothing actually changed,
    // don't touch the API. The Save button is already disabled in this state,
    // so this is a belt-and-suspenders check (e.g. an Enter-key submit). Only
    // enforced when we have an original snapshot to diff against — otherwise
    // fail open and let the save proceed.
    if (this.isEditMode && this.originalSnapshot && !this.hasChanges()) {
      this.errorMessage = 'No changes detected.';
      return;
    }

    if (this.expenseForm.valid && this.selectedUserIds.size > 0) {
      if (!this.splitIsValid()) {
        this.errorMessage = 'Split amounts must add up to the total.';
        return;
      }

      this.isSubmitting = true;
      this.errorMessage = '';

      const formValue = this.expenseForm.value;

      // Preserve the original split configuration when the participant set is
      // untouched — the UI only builds `equal` splits, so rebuilding blindly
      // would flatten a fixed/percent/share expense on any unrelated edit.
      // Once participants change, the preserved shares no longer map cleanly,
      // so fall back to an equal split across the current selection.
      const participantsUnchanged =
        !!this.originalSnapshot &&
        this.arraysEqual(
          Array.from(this.selectedUserIds).sort(),
          this.originalSnapshot.participantIds,
        );
      const splits: ExpenseSplitInputDto[] =
        participantsUnchanged &&
        !this.splitExplicitlyChanged &&
        this.originalSplits?.length
          ? this.originalSplits.map((s) => ({
              participantUserId: s.participantUserId,
              participantGroupMemberId: s.participantGroupMemberId,
              splitType: s.splitType,
              shareValue: s.shareValue,
            }))
          : this.currentSplitPayload();

      const title = formValue.title;
      const amountTotal = formValue.amountTotal;
      const currency = formValue.currency;
      const category = formValue.category;
      const transactionType = (formValue.transactionType ?? 'expense') as
        | 'expense'
        | 'refund';
      const expenseDate = formValue.expenseDate;
      const paidByUserId = formValue.paidByUserId;

      if (
        !title ||
        amountTotal === null ||
        amountTotal === undefined ||
        !currency ||
        !category ||
        !expenseDate ||
        !paidByUserId
      ) {
        this.isSubmitting = false;
        return;
      }

      // Soft duplicate check: amount + date + scope + type only (never
      // title). Purely advisory — shows a confirmation dialog and returns
      // without saving; skipDuplicateCheckOnce lets the very next resubmit
      // (after the user picks "This is a New Transaction") through without
      // re-showing the same warning.
      if (!this.skipDuplicateCheckOnce) {
        this.isCheckingDuplicates.set(true);
        try {
          const duplicates = await firstValueFrom(
            this.expensesService.checkDuplicates({
              amountTotal,
              expenseDate,
              currency,
              transactionType,
              groupId: this.groupId ?? undefined,
              excludeId: this.expense?.id,
            }),
          );
          if (duplicates.length > 0) {
            this.isSubmitting = false;
            this.potentialDuplicates.set(duplicates);
            this.showDuplicateDialog.set(true);
            return;
          }
        } catch {
          // Advisory only — a failed check must never block a legitimate save.
        } finally {
          this.isCheckingDuplicates.set(false);
        }
      }
      this.skipDuplicateCheckOnce = false;

      try {
        const user = this.getCurrentUserId();
        const email = this.store.selectSnapshot(
          (state: any) => state.auth?.user?.email,
        );
        let scopeKey: CryptoKey | null = null;
        let scope: 'personal' | 'group' | 'direct_shared' = 'personal';

        if (this.groupId) {
          scope = 'group';
          // Wrapped so a no_session failure here doesn't abandon the
          // submit: it's queued and this call (and everything after it —
          // encrypt, POST) automatically resumes once the crypto session
          // recovers, instead of the user needing to unlock and click Save
          // again. Non-session failures (pending/no_access/rate_limited)
          // are unaffected — runWithRecovery only queues when
          // CryptoSessionManager itself isn't Ready; a group-key-specific
          // block with a Ready session re-throws immediately, same as
          // before.
          scopeKey = await this.recoveryQueue.runWithRecovery(() =>
            this.resolveGroupScopeKey(this.groupId!),
          );
        } else {
          const otherParticipants = splits.filter(
            (s) => s.participantUserId && s.participantUserId !== user,
          );
          if (otherParticipants.length > 0) {
            scope = 'direct_shared';
          } else {
            scope = 'personal';
            scopeKey = await this.encryptionService.loadKeyFromSession(email);
          }
        }

        if (scope === 'direct_shared') {
          scopeKey = await this.encryptionService.generateDataKey();
        }

        if (!scopeKey) {
          throw new Error(
            'Encryption key not loaded/derived. Please try again.',
          );
        }

        // Encrypt new attachments
        const encryptedAttachments = [];
        const existingAttachments = this.attachedFiles
          .filter((f) => !f.key.startsWith('pending:'))
          .map((f) => ({
            storageKey: f.key,
            encryptedOriginalName: '',
            encryptedFileKey: '',
            mimeType: 'application/octet-stream',
            sizeBytes: 0,
          }));

        for (const fileObj of this.filesToEncrypt) {
          const fileKey = await this.encryptionService.generateDataKey();
          const encryptedBytes = await this.encryptionService.encryptBytes(
            fileObj.arrayBuffer,
            fileKey,
          );
          const encryptedName = await this.encryptionService.encrypt(
            fileObj.name,
            fileKey,
          );
          const wrappedFileKey = await this.encryptionService.wrapKey(
            fileKey,
            scopeKey,
          );

          const randomUuid = Math.random().toString(36).substring(2, 15);
          const storageKey = `receipts/${randomUuid}.enc`;
          localStorage.setItem(`sim_storage:${storageKey}`, encryptedBytes);

          encryptedAttachments.push({
            storageKey,
            encryptedOriginalName: encryptedName,
            encryptedFileKey: wrappedFileKey,
            mimeType: fileObj.type,
            sizeBytes: fileObj.size,
          });
        }

        const wrappedContentKeys = [];
        if (scope === 'direct_shared' && scopeKey) {
          const masterKey =
            await this.encryptionService.loadKeyFromSession(email);
          const currentUserId = user;

          const wrappedSelf = await this.encryptionService.wrapKey(
            scopeKey,
            masterKey!,
          );
          wrappedContentKeys.push({
            userId: currentUserId!,
            wrappedKey: wrappedSelf,
          });

          const otherParticipants = splits.filter(
            (s) => s.participantUserId && s.participantUserId !== user,
          );
          for (const split of otherParticipants) {
            const participantId = split.participantUserId!;
            try {
              const pubKeyRes = await firstValueFrom(
                this.http.get<{ data: { publicWrappingKey: string | null } }>(
                  `${this.baseUrl}/users/${participantId}/public-key`,
                ),
              );
              const pubKeyStr = pubKeyRes?.data?.publicWrappingKey;
              if (pubKeyStr) {
                const subtle =
                  typeof window !== 'undefined'
                    ? window.crypto.subtle
                    : (globalThis as any).crypto.subtle;
                const pubKey = await subtle.importKey(
                  'jwk',
                  JSON.parse(pubKeyStr),
                  { name: 'RSA-OAEP', hash: 'SHA-256' },
                  true,
                  ['wrapKey'],
                );
                const wrappedFriendKey = await this.encryptionService.wrapKey(
                  scopeKey,
                  pubKey,
                );
                wrappedContentKeys.push({
                  userId: participantId,
                  wrappedKey: wrappedFriendKey,
                });
              }
            } catch (e) {
              console.error(
                `Failed to wrap content key for participant ${participantId}`,
                e,
              );
            }
          }
        }

        const payload: any = {
          title,
          description: formValue.description ?? undefined,
          transactionType: formValue.transactionType ?? 'expense',
          amountTotal,
          currency,
          category,
          expenseDate,
          paidByUserId,
          groupId: this.groupId ?? undefined,
          splits,
          encryptionScope: scope,
          wrappedContentKeys:
            wrappedContentKeys.length > 0 ? wrappedContentKeys : undefined,
          encryptedAttachments: [
            ...existingAttachments,
            ...encryptedAttachments,
          ],
        };

        // ExpensesService.createExpense()/updateExpense() do their own,
        // separate ensureCryptoContext()/ensureGroupKey('write') resolution
        // internally (encryptPayload()) — a different check than
        // resolveGroupScopeKey() above, which only informs scopeKeyStatus/UI.
        // Wrapped in runWithRecovery too so a session recovery that happens
        // to land between that check and this one still auto-resumes the
        // save, instead of surfacing a one-off failure the user has to retry
        // by hand. Calling createExpense()/updateExpense() fresh inside the
        // operation (rather than subscribing to an already-built Observable)
        // matters here: encryptPayload() runs as soon as it's called, so a
        // requeued retry must re-invoke it, not re-subscribe to the first,
        // already-failed attempt.
        try {
          await this.recoveryQueue.runWithRecovery(() =>
            firstValueFrom(
              this.expense
                ? this.expensesService.updateExpense(this.expense.id, {
                    ...payload,
                    version: this.expense.version,
                  } satisfies UpdateExpenseDto)
                : this.expensesService.createExpense(payload),
            ),
          );
        } catch (err: any) {
          this.isSubmitting = false;
          this.errorMessage =
            err.error?.message || 'Failed to save expense. Please try again.';
          return;
        }

        this.isSubmitting = false;
        this.expenseCreated.emit();
        this.closeModal();
      } catch (err: any) {
        this.isSubmitting = false;
        this.errorMessage =
          err?.message || 'Failed to encrypt and save expense.';
      }
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        reader.onload = () => {
          const arrayBuffer = reader.result as ArrayBuffer;
          this.filesToEncrypt.push({
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            arrayBuffer,
          });
          this.attachedFiles.push({
            name: file.name,
            size: (file.size / 1024).toFixed(1) + ' KB',
            key: `pending:${Math.random().toString(36).substring(2, 10)}`,
          });
          this.markChanged();
        };
        reader.readAsArrayBuffer(file);
      }
    }
  }

  removeAttachment(index: number) {
    const fileItem = this.attachedFiles[index];
    if (fileItem && fileItem.key.startsWith('pending:')) {
      const encryptIndex = this.filesToEncrypt.findIndex(
        (f) => f.name === fileItem.name,
      );
      if (encryptIndex !== -1) {
        this.filesToEncrypt.splice(encryptIndex, 1);
      }
    }
    this.attachedFiles.splice(index, 1);
    this.markChanged();
  }
}
