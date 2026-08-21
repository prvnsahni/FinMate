import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AnalyticsChartsComponent } from './analytics-charts.component';
import { ExpensesService } from '../../services/expenses.service';

/**
 * TAG-BATCH-B1 — "Spending by tag" visualization. Bars are relative to the
 * largest tag (comparative magnitude), never a share of a whole, because
 * ancestor tags are materialized and overlap.
 */
describe('AnalyticsChartsComponent — spending by tag', () => {
  let fixture: ComponentFixture<AnalyticsChartsComponent>;
  let component: AnalyticsChartsComponent;
  let expensesService: {
    getCategoryAnalytics: jest.Mock;
    getMonthlyAnalytics: jest.Mock;
    getTagAnalytics: jest.Mock;
    getTagTrend: jest.Mock;
    getTaxonomy: jest.Mock;
  };

  const setup = (
    tags: { tagId: string; total: number; currency: string }[],
    taxonomy = [
      { id: 'grocery', canonicalName: 'Grocery', normalizedKey: 'grocery', status: 'active', version: 1 },
      { id: 'food', canonicalName: 'Food', normalizedKey: 'food', status: 'active', version: 1 },
      { id: 'fuel', canonicalName: 'Fuel', normalizedKey: 'fuel', status: 'active', version: 1 },
    ],
    trend: { month: string; tagId: string; total: number; currency: string }[] = [],
  ) => {
    expensesService = {
      getCategoryAnalytics: jest.fn().mockReturnValue(of([])),
      getMonthlyAnalytics: jest.fn().mockReturnValue(of([])),
      getTagAnalytics: jest.fn().mockReturnValue(of(tags)),
      getTagTrend: jest.fn().mockReturnValue(of(trend)),
      getTaxonomy: jest.fn().mockReturnValue(of(taxonomy)),
    };
    TestBed.configureTestingModule({
      imports: [AnalyticsChartsComponent],
      providers: [{ provide: ExpensesService, useValue: expensesService }],
    });
    fixture = TestBed.createComponent(AnalyticsChartsComponent);
    component = fixture.componentInstance;
    component.currency = 'INR';
    fixture.detectChanges(); // ngOnInit → loadAnalytics
  };

  it('ranks tags by spend and sizes bars relative to the largest (not a share of total)', () => {
    setup([
      { tagId: 'grocery', total: 8420, currency: 'INR' },
      { tagId: 'food', total: 9870, currency: 'INR' },
      { tagId: 'fuel', total: 2100, currency: 'INR' },
    ]);

    // Sorted by total desc: food (largest) → grocery → fuel.
    expect(component.processedTags.map((t) => t.tagId)).toEqual([
      'food',
      'grocery',
      'fuel',
    ]);
    // Names resolved from taxonomy.
    expect(component.processedTags[0].name).toBe('Food');
    // Bar widths are relative to the largest (food=100%), NOT a % of a summed whole.
    expect(component.processedTags[0].barWidth).toBe(100);
    expect(component.processedTags[1].barWidth).toBe(Math.round((8420 / 9870) * 100));
    // Overlapping totals: they intentionally sum to > any single "grand total".
    const sum = component.processedTags.reduce((s, t) => s + t.total, 0);
    expect(sum).toBe(8420 + 9870 + 2100);
  });

  it('excludes other-currency and non-positive tags', () => {
    setup([
      { tagId: 'grocery', total: 100, currency: 'INR' },
      { tagId: 'food', total: 50, currency: 'USD' }, // different currency
      { tagId: 'fuel', total: -20, currency: 'INR' }, // net refund
    ]);
    expect(component.processedTags.map((t) => t.tagId)).toEqual(['grocery']);
  });

  it('renders the "Spending by tag" bars and emits tagSelected on activation', () => {
    setup([{ tagId: 'grocery', total: 8420, currency: 'INR' }]);
    const emitted: string[] = [];
    component.tagSelected.subscribe((id) => emitted.push(id));

    const bars = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="tag-spending-bars"] button',
    );
    expect(bars.length).toBe(1);
    (bars[0] as HTMLButtonElement).click();
    expect(emitted).toEqual(['grocery']);
  });

  it('shows an empty state when there is no tagged spending', () => {
    setup([]);
    const card = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="tag-spending-card"]',
    );
    expect(card?.textContent).toContain('No tagged spending');
  });

  // ── Tag trend (TAG-BATCH-B2) ─────────────────────────────────────────────────
  it('builds a month × tag trend matrix and renders it for ≥2 months', () => {
    setup(
      [{ tagId: 'grocery', total: 8420, currency: 'INR' }],
      undefined,
      [
        { month: '2026-07', tagId: 'grocery', total: 7200, currency: 'INR' },
        { month: '2026-08', tagId: 'grocery', total: 8420, currency: 'INR' },
        { month: '2026-08', tagId: 'food', total: 9870, currency: 'INR' },
      ],
    );

    expect(component.tagTrendMonths).toEqual(['2026-07', '2026-08']);
    // food (9870) outranks grocery (7200+8420=15620)? grocery total is larger → first.
    const grocery = component.tagTrendRows.find((r) => r.tagId === 'grocery');
    expect(grocery?.cells).toEqual([7200, 8420]); // Jul, Aug in month order
    const food = component.tagTrendRows.find((r) => r.tagId === 'food');
    expect(food?.cells).toEqual([0, 9870]); // absent in Jul → 0

    const card = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="tag-trend-card"]',
    );
    expect(card).not.toBeNull();
  });

  it('hides the trend card for a single-month range (not a real trend)', () => {
    setup([{ tagId: 'grocery', total: 8420, currency: 'INR' }], undefined, [
      { month: '2026-08', tagId: 'grocery', total: 8420, currency: 'INR' },
    ]);
    expect(component.tagTrendMonths.length).toBe(1);
    const card = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="tag-trend-card"]',
    );
    expect(card).toBeNull();
  });

  it('emits tagSelected when a trend tag row is activated', () => {
    setup([{ tagId: 'grocery', total: 8420, currency: 'INR' }], undefined, [
      { month: '2026-07', tagId: 'grocery', total: 7200, currency: 'INR' },
      { month: '2026-08', tagId: 'grocery', total: 8420, currency: 'INR' },
    ]);
    const emitted: string[] = [];
    component.tagSelected.subscribe((id) => emitted.push(id));
    const rowBtn = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="tag-trend-card"] tbody button',
    ) as HTMLButtonElement;
    rowBtn.click();
    expect(emitted).toEqual(['grocery']);
  });
});
