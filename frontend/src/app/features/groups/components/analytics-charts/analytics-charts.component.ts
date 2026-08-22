import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  SimpleChanges,
  inject,
  DestroyRef,
} from '@angular/core';
import { Subscription, forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe, PercentPipe } from '@angular/common';
import {
  ExpensesService,
  GroupAnalyticsQuery,
} from '../../services/expenses.service';
import { CATEGORY_OPTIONS } from '../../../../core/constants/app.constants';
import { CustomTagNameEntry } from '../../../../core/services/custom-tag.service';

/** Neutral, non-sensitive label for a custom tag whose name can't be resolved. */
const CUSTOM_TAG_FALLBACK = 'Custom tag';
/** Custom tag ids are UUIDs; canonical ids are readable slugs (e.g. `grocery`). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MonthlyData {
  month: string;
  total: number;
  currency: string;
}

interface CategoryData {
  category: string;
  total: number;
  currency: string;
}

interface TagData {
  tagId: string;
  total: number;
  currency: string;
}

/**
 * A processed "spending by tag" bar. `barWidth` is relative to the LARGEST tag
 * (comparative magnitude), NOT a share of a whole — because ancestor tags are
 * materialized (an item tagged milk also counts under dairy/grocery/food), tag
 * totals overlap and must not be shown as mutually-exclusive slices.
 */
interface ProcessedTag {
  tagId: string;
  name: string;
  total: number;
  barWidth: number;
  deprecated: boolean;
}

interface TagTrendData {
  month: string;
  tagId: string;
  total: number;
  currency: string;
}

/** A tag's monthly totals across the visible months (same order as `tagTrendMonths`). */
interface ProcessedTagTrendRow {
  tagId: string;
  name: string;
  cells: number[];
  deprecated: boolean;
}

interface ProcessedCategory {
  category: string;
  total: number;
  percentage: number;
  color: string;
  dashArray: string;
  dashOffset: number;
}

interface ProcessedMonth {
  month: string;
  displayName: string;
  total: number;
  height: number;
  x: number;
  y: number;
}

@Component({
  selector: 'app-analytics-charts',
  standalone: true,
  imports: [CurrencyPipe, PercentPipe],
  templateUrl: './analytics-charts.component.html',
  styles: [
    `
      :host {
        --donut-track-color: rgba(148, 163, 184, 0.1);
      }
      .dark :host {
        --donut-track-color: rgba(255, 255, 255, 0.05);
      }
    `,
  ],
})
export class AnalyticsChartsComponent implements OnInit, OnChanges {
  private expensesService = inject(ExpensesService);
  private destroyRef = inject(DestroyRef);
  private analyticsSub?: Subscription;

  @Input() groupId: string | null = null;
  @Input() currency = 'USD';
  /** Unified group filter (date range + category/member/payer/type/tags). */
  @Input() filter?: GroupAnalyticsQuery;
  /**
   * TAG-C6-DISPLAY — custom-tag id → decrypted name/deprecated, resolved ONCE by
   * the parent via `CustomTagService` (the single reusable path; correct scope
   * key). Canonical names still come from `/taxonomy` here; custom ids resolve
   * through this map. May arrive after the first load (async decrypt) — labels
   * re-resolve on change without re-fetching analytics.
   */
  @Input() customTagNames?: Map<string, CustomTagNameEntry>;

  /** TAG-BATCH-B1 — emitted when a "spending by tag" bar is activated, so the
   *  parent can apply the existing unified tag filter. */
  @Output() tagSelected = new EventEmitter<string>();

  isLoading = true;
  processedCategories: ProcessedCategory[] = [];
  processedMonths: ProcessedMonth[] = [];
  processedTags: ProcessedTag[] = [];
  /** TAG-BATCH-B2 — monthly tag trend: month labels + one row of totals per top tag. */
  tagTrendMonths: string[] = [];
  tagTrendRows: ProcessedTagTrendRow[] = [];

  grandTotal = 0;
  hoveredCategory: ProcessedCategory | null = null;
  hoveredMonth: ProcessedMonth | null = null;
  categoryOptions = CATEGORY_OPTIONS;

  // TAG-C6-DISPLAY — last-fetched raw tag data + canonical names, kept so tag
  // labels can be re-resolved when `customTagNames` arrives/changes WITHOUT
  // re-fetching analytics.
  private lastTags: TagData[] = [];
  private lastTagTrend: TagTrendData[] = [];
  private canonicalNameById = new Map<string, string>();

  ngOnInit() {
    this.loadAnalytics();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (
      (changes['groupId'] && !changes['groupId'].firstChange) ||
      (changes['currency'] && !changes['currency'].firstChange) ||
      (changes['filter'] && !changes['filter'].firstChange)
    ) {
      this.loadAnalytics();
      return;
    }
    // Custom names resolved after the initial fetch → just re-label, no re-fetch.
    if (changes['customTagNames'] && !changes['customTagNames'].firstChange) {
      this.processTagsData();
      this.processTagTrendData();
    }
  }

  private loadAnalytics() {
    this.isLoading = true;
    const gId = this.groupId ? this.groupId : 'personal';
    this.analyticsSub?.unsubscribe();

    // Load category distribution, monthly trends and tag distribution, honoring
    // the group filter. Taxonomy resolves tag ids → display names (shareReplay-
    // cached, safe reference data only).
    this.analyticsSub = forkJoin({
      categories: this.expensesService.getCategoryAnalytics(gId, this.filter),
      monthly: this.expensesService.getMonthlyAnalytics(gId, this.filter),
      tags: this.expensesService.getTagAnalytics(gId, this.filter),
      tagTrend: this.expensesService.getTagTrend(gId, this.filter),
      taxonomy: this.expensesService.getTaxonomy(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ categories, monthly, tags, tagTrend, taxonomy }) => {
          this.canonicalNameById = new Map(
            taxonomy.map((t) => [t.id, t.canonicalName]),
          );
          this.lastTags = tags;
          this.lastTagTrend = tagTrend;
          this.processCategoriesData(categories);
          this.processMonthlyData(monthly);
          this.processTagsData();
          this.processTagTrendData();
          this.isLoading = false;
        },
        error: () => {
          this.isLoading = false;
        },
      });
  }

  /**
   * TAG-BATCH-B2 — build a compact month × tag matrix for the "Tag trend". Rows
   * are the top tags by spend across the range; the same overlap caveat applies
   * (ancestor tags), so it is presented as "spending by tag", not an exclusive
   * breakdown. Only rendered when ≥2 months are present (a real trend).
   */
  /**
   * TAG-C6-DISPLAY — resolve a tag id to a user-facing label + deprecated flag.
   * Canonical ids → the taxonomy name; custom ids → the client-decrypted name
   * from `customTagNames` (or the neutral "Custom tag" when undecryptable). A raw
   * UUID is NEVER shown; an unknown non-UUID id (e.g. a deprecated canonical slug)
   * keeps its readable slug.
   */
  private resolveTagLabel(tagId: string): { name: string; deprecated: boolean } {
    const canonical = this.canonicalNameById.get(tagId);
    if (canonical) return { name: canonical, deprecated: false };
    const custom = this.customTagNames?.get(tagId);
    if (custom) {
      return { name: custom.name ?? CUSTOM_TAG_FALLBACK, deprecated: custom.deprecated };
    }
    return {
      name: UUID_RE.test(tagId) ? CUSTOM_TAG_FALLBACK : tagId,
      deprecated: false,
    };
  }

  private processTagTrendData(): void {
    const data = this.lastTagTrend;
    const matching = data.filter(
      (d) => d.currency.toUpperCase() === this.currency.toUpperCase(),
    );
    const months = [...new Set(matching.map((d) => d.month))].sort();

    const byTag = new Map<string, Map<string, number>>();
    const tagTotals = new Map<string, number>();
    for (const d of matching) {
      const perMonth = byTag.get(d.tagId) ?? new Map<string, number>();
      perMonth.set(d.month, Number(d.total));
      byTag.set(d.tagId, perMonth);
      tagTotals.set(d.tagId, (tagTotals.get(d.tagId) ?? 0) + Number(d.total));
    }

    const topTags = [...tagTotals.entries()]
      .filter(([, total]) => total > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tagId]) => tagId);

    this.tagTrendMonths = months;
    this.tagTrendRows = topTags.map((tagId) => {
      const { name, deprecated } = this.resolveTagLabel(tagId);
      return {
        tagId,
        name,
        deprecated,
        cells: months.map((m) => byTag.get(tagId)?.get(m) ?? 0),
      };
    });
  }

  /** Short label (e.g. `Aug`) for a `YYYY-MM` month key. */
  tagTrendMonthLabel(month: string): string {
    const [y, m] = month.split('-').map(Number);
    if (!y || !m) return month;
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' });
  }

  /**
   * TAG-BATCH-B1 — rank tags by spend for the "Spending by tag" bars. Bars are
   * sized relative to the largest tag (comparative magnitude), never as a share
   * of a whole, so overlapping ancestor totals are not implied to be exclusive.
   * Only positive-net tags are shown, capped to the top entries for readability.
   */
  private processTagsData(): void {
    const matching = this.lastTags
      .filter(
        (d) =>
          d.currency.toUpperCase() === this.currency.toUpperCase() &&
          Number(d.total) > 0,
      )
      .map((d) => {
        const { name, deprecated } = this.resolveTagLabel(d.tagId);
        return { tagId: d.tagId, name, deprecated, total: Number(d.total) };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);

    const max = Math.max(...matching.map((t) => t.total), 1);
    this.processedTags = matching.map((t) => ({
      ...t,
      barWidth: Math.round((t.total / max) * 100),
    }));
  }

  /**
   * Emit a tag selection so the parent applies the unified tag filter (STEP 5).
   * TAG-C6-DISPLAY (F2): a DEPRECATED tag is not offered as a live filter — the
   * backend would reject it and the ledger would come back empty — so activating
   * it is a no-op (the bar is also visibly marked/disabled).
   */
  onTagBarActivate(tagId: string, deprecated = false): void {
    if (deprecated) return;
    this.tagSelected.emit(tagId);
  }

  private processCategoriesData(data: CategoryData[]) {
    const matching = data.filter(
      (d) => d.currency.toUpperCase() === this.currency.toUpperCase(),
    );
    this.grandTotal = matching.reduce((sum, d) => sum + Number(d.total), 0);
    const C = 2 * Math.PI * 70; // 439.82
    let cumulativePercent = 0;

    const categoryColorMap = new Map(
      this.categoryOptions.map((option) => [option.value, option.color]),
    );

    const defaultColor = categoryColorMap.get('Others') ?? '#9CA3AF';

    this.processedCategories = matching.map((item) => {
      const total = Number(item.total) || 0;

      const percentage = this.grandTotal > 0 ? total / this.grandTotal : 0;

      const dashArray = `${C * percentage} ${C}`;
      const dashOffset = -(C * cumulativePercent);

      cumulativePercent += percentage;

      return {
        category: item.category,
        total,
        percentage,
        color: categoryColorMap.get(item.category) ?? defaultColor,
        dashArray,
        dashOffset,
      };
    });
  }

  private processMonthlyData(data: MonthlyData[]) {
    const matching = data
      .filter((d) => d.currency.toUpperCase() === this.currency.toUpperCase())
      .sort((a, b) => a.month.localeCompare(b.month));

    const last6 = matching.slice(-6);
    const maxVal = Math.max(...last6.map((d) => Number(d.total)), 100);
    const svgHeight = 160;
    const spacing = 340 / Math.max(last6.length, 1);

    this.processedMonths = last6.map((item, index) => {
      const total = Number(item.total);
      const height = (total / maxVal) * svgHeight;
      const x = 50 + index * spacing;
      const y = 180 - height;

      let displayName = item.month;
      try {
        const parts = item.month.split('-');
        if (parts.length === 2) {
          const date = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
          displayName = date.toLocaleDateString('en-US', { month: 'short' });
        }
      } catch {
        // fallback
      }

      return {
        month: item.month,
        displayName,
        total,
        height,
        x,
        y,
      };
    });
  }
}
