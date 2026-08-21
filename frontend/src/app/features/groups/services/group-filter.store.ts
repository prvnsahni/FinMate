import { Injectable, computed, signal } from '@angular/core';
import {
  DEFAULT_GROUP_FILTER,
  DatePreset,
  GroupFilter,
  GroupSortBy,
  SortOrder,
  TimeScope,
  TransactionTypeFilter,
  cloneFilter,
  countActiveFilters,
  toggleInArray,
} from '../models/group-filter.model';
import {
  ResolvedRange,
  formatDateRangeLabel,
  resolveDatePreset,
} from '../utils/date-preset.util';

/**
 * Single source of truth for the group page's unified filter.
 *
 * Holds two states:
 *  - `applied`  — the committed filter that drives every fetch.
 *  - `draft`    — the drawer's working copy (Apply commits it, Cancel/Reset
 *                 discard it).
 *
 * Router-free by design so it stays trivially unit-testable; the owning
 * component persists `applied` to the URL and re-fetches when it changes.
 * Provided at the component level (not root) so each group page gets its own.
 */
@Injectable()
export class GroupFilterStore {
  private readonly _applied = signal<GroupFilter>(
    cloneFilter(DEFAULT_GROUP_FILTER),
  );
  private readonly _draft = signal<GroupFilter>(
    cloneFilter(DEFAULT_GROUP_FILTER),
  );

  readonly applied = this._applied.asReadonly();
  readonly draft = this._draft.asReadonly();

  /** Non-default filters on the applied set — drives the badge. */
  readonly activeCount = computed(() => countActiveFilters(this._applied()));
  readonly hasActiveFilters = computed(() => this.activeCount() > 0);

  /** Non-default filters on the draft — for a live count inside the drawer. */
  readonly draftCount = computed(() => countActiveFilters(this._draft()));

  /** Applied date preset resolved to concrete `{from,to}` bounds. */
  readonly resolvedRange = computed<ResolvedRange>(() => {
    const d = this._applied().date;
    return resolveDatePreset(d.preset, new Date(), {
      from: d.from,
      to: d.to,
    });
  });

  /** Header label for the applied date filter. */
  readonly dateRangeLabel = computed(() => {
    const d = this._applied().date;
    const { from, to } = this.resolvedRange();
    return formatDateRangeLabel(d.preset, from, to);
  });

  /**
   * The shared TimeScope derived purely from the applied date filter — the
   * single source of truth every date-driven surface should consume. Household
   * month navigation feeds through the same applied date (see the owning
   * component), so this stays authoritative in every mode.
   */
  readonly timeScope = computed<TimeScope>(() => {
    const { from, to } = this.resolvedRange();
    return {
      from,
      to,
      preset: this._applied().date.preset,
      label: this.dateRangeLabel(),
    };
  });

  /** Seed both applied and draft (e.g. from URL query params on load). */
  initialize(f: GroupFilter): void {
    this._applied.set(cloneFilter(f));
    this._draft.set(cloneFilter(f));
  }

  /** Copy applied → draft; call when the drawer opens. */
  openDraft(): void {
    this._draft.set(cloneFilter(this._applied()));
  }

  // ── Draft mutators (drawer controls bind through these) ───────────────────

  setDraftPreset(preset: DatePreset): void {
    this._draft.update((d) => ({
      ...d,
      date:
        preset === 'custom'
          ? { preset, from: d.date.from, to: d.date.to }
          : { preset },
    }));
  }

  setDraftCustomFrom(from: string): void {
    this._draft.update((d) => ({
      ...d,
      date: { ...d.date, preset: 'custom', from: from || undefined },
    }));
  }

  setDraftCustomTo(to: string): void {
    this._draft.update((d) => ({
      ...d,
      date: { ...d.date, preset: 'custom', to: to || undefined },
    }));
  }

  toggleDraftCategory(value: string): void {
    this._draft.update((d) => ({
      ...d,
      categories: toggleInArray(d.categories, value),
    }));
  }

  toggleDraftMember(value: string): void {
    this._draft.update((d) => ({
      ...d,
      memberIds: toggleInArray(d.memberIds, value),
    }));
  }

  toggleDraftPaidBy(value: string): void {
    this._draft.update((d) => ({
      ...d,
      paidByIds: toggleInArray(d.paidByIds, value),
    }));
  }

  toggleDraftTag(value: string): void {
    this._draft.update((d) => ({
      ...d,
      tagIds: toggleInArray(d.tagIds, value),
    }));
  }

  setDraftTxType(transactionType: TransactionTypeFilter): void {
    this._draft.update((d) => ({ ...d, transactionType }));
  }

  setDraftMinAmount(value: number | null): void {
    this._draft.update((d) => ({ ...d, minAmount: value ?? undefined }));
  }

  setDraftMaxAmount(value: number | null): void {
    this._draft.update((d) => ({ ...d, maxAmount: value ?? undefined }));
  }

  setDraftSort(sortBy: GroupSortBy, sortOrder: SortOrder): void {
    this._draft.update((d) => ({ ...d, sortBy, sortOrder }));
  }

  // ── Lifecycle actions ─────────────────────────────────────────────────────

  /** Commit draft → applied. Returns the newly applied filter. */
  apply(): GroupFilter {
    this._applied.set(cloneFilter(this._draft()));
    return this._applied();
  }

  /** Reset the draft to defaults (Clear All inside the drawer). */
  resetDraft(): void {
    this._draft.set(cloneFilter(DEFAULT_GROUP_FILTER));
  }

  /** Discard draft edits (Cancel closes the drawer without applying). */
  cancelDraft(): void {
    this._draft.set(cloneFilter(this._applied()));
  }

  // ── Remove a single applied filter (from a removable summary chip) ──────────
  // Each mutates the applied set directly and re-syncs the draft, so the owning
  // component's applied() effect re-fetches and updates the URL.

  private syncDraftToApplied(): void {
    this._draft.set(cloneFilter(this._applied()));
  }

  /** Reset the date filter back to the default (This Month). */
  clearAppliedDate(): void {
    this._applied.update((a) => ({ ...a, date: { preset: 'this_month' } }));
    this.syncDraftToApplied();
  }

  /** Remove one category value (chip); clears the field when empty. */
  removeAppliedCategory(value: string): void {
    this._applied.update((a) => ({
      ...a,
      categories: toggleInArray(a.categories, value),
    }));
    this.syncDraftToApplied();
  }

  removeAppliedMember(value: string): void {
    this._applied.update((a) => ({
      ...a,
      memberIds: toggleInArray(a.memberIds, value),
    }));
    this.syncDraftToApplied();
  }

  removeAppliedPaidBy(value: string): void {
    this._applied.update((a) => ({
      ...a,
      paidByIds: toggleInArray(a.paidByIds, value),
    }));
    this.syncDraftToApplied();
  }

  /** Remove one tag value (chip); clears the field when empty. */
  removeAppliedTag(value: string): void {
    this._applied.update((a) => ({
      ...a,
      tagIds: toggleInArray(a.tagIds, value),
    }));
    this.syncDraftToApplied();
  }

  clearAppliedTxType(): void {
    this._applied.update((a) => ({ ...a, transactionType: 'both' }));
    this.syncDraftToApplied();
  }

  clearAppliedAmount(): void {
    this._applied.update((a) => ({
      ...a,
      minAmount: undefined,
      maxAmount: undefined,
    }));
    this.syncDraftToApplied();
  }
}
