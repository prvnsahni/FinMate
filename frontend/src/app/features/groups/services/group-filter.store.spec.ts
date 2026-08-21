import { GroupFilterStore } from './group-filter.store';
import {
  filterFromQueryParams,
  filterToQueryParams,
} from '../models/group-filter.model';

describe('GroupFilterStore', () => {
  let store: GroupFilterStore;

  beforeEach(() => {
    store = new GroupFilterStore();
  });

  it('defaults to this_month with no active filters (no badge)', () => {
    expect(store.applied().date.preset).toBe('this_month');
    expect(store.activeCount()).toBe(0);
    expect(store.hasActiveFilters()).toBe(false);
  });

  it('apply() commits the draft to applied', () => {
    store.openDraft();
    store.setDraftPreset('last_3_months');
    store.toggleDraftCategory('Food & Drinks');
    // Not yet applied.
    expect(store.applied().date.preset).toBe('this_month');

    store.apply();
    expect(store.applied().date.preset).toBe('last_3_months');
    expect(store.applied().categories).toEqual(['Food & Drinks']);
    expect(store.activeCount()).toBe(2);
  });

  it('toggling a category twice removes it', () => {
    store.openDraft();
    store.toggleDraftCategory('Food & Drinks');
    store.toggleDraftCategory('Travel');
    expect(store.draft().categories).toEqual(['Food & Drinks', 'Travel']);
    store.toggleDraftCategory('Food & Drinks');
    expect(store.draft().categories).toEqual(['Travel']);
  });

  // ── TAG-BATCH-B — tag filter facet ───────────────────────────────────────────
  it('toggles tags in the draft and counts them toward the badge', () => {
    store.openDraft();
    store.toggleDraftTag('milk');
    store.toggleDraftTag('grocery');
    expect(store.draft().tagIds).toEqual(['milk', 'grocery']);
    store.toggleDraftTag('milk');
    expect(store.draft().tagIds).toEqual(['grocery']);
    store.apply();
    // one date-default (no) + one tag = activeCount 1
    expect(store.applied().tagIds).toEqual(['grocery']);
    expect(store.activeCount()).toBe(1);
  });

  it('removeAppliedTag drops a single applied tag and re-syncs the draft', () => {
    store.openDraft();
    store.toggleDraftTag('milk');
    store.toggleDraftTag('fuel');
    store.apply();
    store.removeAppliedTag('milk');
    expect(store.applied().tagIds).toEqual(['fuel']);
    expect(store.draft().tagIds).toEqual(['fuel']);
  });

  it('cancelDraft() discards draft edits', () => {
    store.openDraft();
    store.toggleDraftCategory('Travel');
    store.cancelDraft();
    expect(store.draft().categories).toBeUndefined();
    expect(store.applied().categories).toBeUndefined();
  });

  it('resetDraft() clears the draft back to defaults', () => {
    store.openDraft();
    store.setDraftPreset('all_time');
    store.toggleDraftMember('m1');
    store.resetDraft();
    expect(store.draft().date.preset).toBe('this_month');
    expect(store.draft().memberIds).toBeUndefined();
    expect(store.draftCount()).toBe(0);
  });

  it('transactionType=both does not count toward the badge', () => {
    store.openDraft();
    store.setDraftTxType('both');
    store.apply();
    expect(store.activeCount()).toBe(0);

    store.setDraftTxType('refund');
    store.apply();
    expect(store.activeCount()).toBe(1);
  });

  it('switching away from custom drops the custom bounds', () => {
    store.openDraft();
    store.setDraftCustomFrom('2026-07-15');
    store.setDraftCustomTo('2026-09-10');
    expect(store.draft().date.preset).toBe('custom');

    store.setDraftPreset('this_month');
    expect(store.draft().date.from).toBeUndefined();
    expect(store.draft().date.to).toBeUndefined();
  });

  it('dateRangeLabel reflects the applied preset', () => {
    store.openDraft();
    store.setDraftPreset('all_time');
    store.apply();
    expect(store.dateRangeLabel()).toBe('All Time');
  });

  it('survives a URL query-param round-trip', () => {
    store.openDraft();
    store.setDraftPreset('last_year');
    store.toggleDraftCategory('Utilities');
    store.toggleDraftCategory('Travel');
    store.toggleDraftPaidBy('user-9');
    store.setDraftTxType('expense');
    store.setDraftMinAmount(100);
    store.setDraftMaxAmount(500);
    store.apply();

    const params = filterToQueryParams(store.applied());
    // null-valued params would be dropped by the router; emulate that.
    const raw: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v != null) raw[k] = v;
    }
    const rebuilt = filterFromQueryParams(raw);

    expect(rebuilt.date.preset).toBe('last_year');
    expect(rebuilt.categories).toEqual(['Utilities', 'Travel']);
    expect(rebuilt.paidByIds).toEqual(['user-9']);
    expect(rebuilt.transactionType).toBe('expense');
    expect(rebuilt.minAmount).toBe(100);
    expect(rebuilt.maxAmount).toBe(500);
  });

  it('round-trips tagIds through the URL params', () => {
    store.openDraft();
    store.toggleDraftTag('milk');
    store.toggleDraftTag('grocery');
    store.apply();

    const params = filterToQueryParams(store.applied());
    expect(params.tagIds).toBe('milk,grocery');

    const raw: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v != null) raw[k] = v;
    }
    expect(filterFromQueryParams(raw).tagIds).toEqual(['milk', 'grocery']);
  });
});
