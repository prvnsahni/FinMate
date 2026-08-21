import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StatsCardComponent } from '../../../../shared/components/stats-card/stats-card.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { CATEGORY_OPTIONS } from '../../../../core/constants/app.constants';

@Component({
  selector: 'app-dashboard-home',
  standalone: true,
  imports: [
    FormsModule,
    CurrencyPipe,
    DatePipe,
    StatsCardComponent,
    IconComponent,
  ],
  templateUrl: './dashboard-home.component.html',
})
export class DashboardHomeComponent {
  @Input() userName = '';
  @Input() totalBalance = 0;
  @Input() monthlyExpenses = 0;
  @Input() activeGroupsCount = 0;
  @Input() personalExpenses: any[] = [];
  @Input() myExpenses: any[] = [];
  /** TAG-BATCH-B2 — active canonical tag id → display name (from /taxonomy). */
  @Input() tagNameMap = new Map<string, string>();
  @Input() expenseViewFilter: 'all' | 'personal' | 'group_share' = 'all';
  /** True while a subsequent page is being appended via infinite scroll. */
  @Input() isLoadingMoreExpenses = false;
  /** More pages of the unified expense list remain to fetch. */
  @Input() hasMoreExpenses = false;
  @Input() pendingInvitations: any[] = [];
  @Input() categoryAnalytics: any[] = [];
  @Input() userProfile: any = null;
  @Input() isLoading = false;

  @Input() isEditingIncome = false;
  @Input() newIncome = 0;
  @Output() newIncomeChange = new EventEmitter<number>();
  @Input() newBudget = 0;
  @Output() newBudgetChange = new EventEmitter<number>();

  @Input() incomePercentage = 0;
  @Input() budgetPercentage = 0;
  @Input() incomeProgressWidth = 0;
  @Input() budgetProgressWidth = 0;

  @Output() openExpenseModalEvent = new EventEmitter<{
    expense?: any;
    category?: string;
  }>();
  @Output() openExportModalEvent = new EventEmitter<void>();
  @Output() toggleEditIncomeEvent = new EventEmitter<void>();
  @Output() saveIncomeEvent = new EventEmitter<void>();
  @Output() acceptInvitationEvent = new EventEmitter<any>();
  @Output() declineInvitationEvent = new EventEmitter<any>();
  @Output() confirmDeleteExpenseEvent = new EventEmitter<string>();
  @Output() expenseViewFilterChange = new EventEmitter<
    'all' | 'personal' | 'group_share'
  >();
  @Output() openGroupExpenseEvent = new EventEmitter<{
    groupId: string;
    expenseId: string;
  }>();
  /** Emitted when the transactions list nears its bottom — asks the parent to
   *  fetch and append the next page. */
  @Output() loadMoreExpensesEvent = new EventEmitter<void>();

  get displayExpenses(): any[] {
    return this.myExpenses.length > 0 ? this.myExpenses : this.personalExpenses;
  }

  /** Max tag chips shown per dashboard row (keeps rows compact on mobile). */
  private readonly MAX_ROW_TAG_CHIPS = 4;

  /**
   * TAG-BATCH-B2 — advisory tag chips for a dashboard expense row. Same visual
   * language as the group ledger (B1): active tags only (ids not in the taxonomy
   * — deprecated/unknown — are dropped fail-safe), user-authored tags before
   * inferred, `inferred` drives the subtle styling. Display-only: the dashboard
   * has no unified tag-filter surface, so chips are not clickable (reported).
   */
  private sortedRowTags(
    expense: any,
  ): { tagId: string; label: string; inferred: boolean }[] {
    const tags = Array.isArray(expense?.tags) ? expense.tags : [];
    return tags
      .filter((t: any) => this.tagNameMap.has(t?.tagId))
      .map((t: any) => ({
        tagId: t.tagId as string,
        label: this.tagNameMap.get(t.tagId) as string,
        inferred: t.authority === 'INFERRED',
      }))
      .sort(
        (a: { inferred: boolean; label: string }, b: { inferred: boolean; label: string }) =>
          Number(a.inferred) - Number(b.inferred) ||
          a.label.localeCompare(b.label),
      );
  }

  /** Visible tag chips for a row (capped for compactness). */
  rowTagChips(
    expense: any,
  ): { tagId: string; label: string; inferred: boolean }[] {
    return this.sortedRowTags(expense).slice(0, this.MAX_ROW_TAG_CHIPS);
  }

  /** Count of tags beyond the visible cap (rendered as "+N"). */
  rowTagOverflowCount(expense: any): number {
    return Math.max(
      0,
      this.sortedRowTags(expense).length - this.MAX_ROW_TAG_CHIPS,
    );
  }

  /** Scroll handler for the bounded transactions container — requests the next
   *  page once the user is within `threshold`px of the bottom. */
  onExpenseListScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const threshold = 200;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
      this.loadMoreExpensesEvent.emit();
    }
  }

  // SVG Icon Paths
  bankIconPath =
    'M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2L2 7h20L12 2z';
  creditCardIconPath =
    'M19 4H5a3 3 0 00-3 3v10a3 3 0 003 3h14a3 3 0 003-3V7a3 3 0 00-3-3zM5 6h14a1 1 0 011 1v2H4V7a1 1 0 011-1zm14 12H5a1 1 0 01-1-1v-5h16v5a1 1 0 01-1 1z';
  usersIconPath =
    'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8z M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75';
  cogIconPath =
    'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z';
  bellIconPath =
    'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 01-3.46 0';
  inboxIconPath =
    'M20 12h-4l-3 3h-2l-3-3H4V6h16v6z M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2z';

  categoryOptions = CATEGORY_OPTIONS;

  // Spending-health color scale, keyed on utilization % (spend / ceiling).
  // Smoothly ramps green -> yellow -> orange -> red so the meter warms up as
  // spending approaches and crosses the limit. Shared by the income and budget bars.
  private static readonly UTILIZATION_STOPS: Array<[number, string]> = [
    [0, '#10b981'], // deep green - well under, saving
    [50, '#22c55e'], // green - healthy
    [75, '#eab308'], // yellow - getting close
    [90, '#f59e0b'], // amber - near limit
    [100, '#f97316'], // orange - at / over the line
    [125, '#ef4444'], // red - well over
    [150, '#dc2626'], // red - way over
    [200, '#b91c1c'], // deep red
    [250, '#991b1b'], // deepest red
  ];

  getUtilizationColor(pct: number): string {
    const stops = DashboardHomeComponent.UTILIZATION_STOPS;
    const p = Math.max(0, Math.min(pct || 0, stops[stops.length - 1][0]));
    for (let i = 0; i < stops.length - 1; i++) {
      const [p0, c0] = stops[i];
      const [p1, c1] = stops[i + 1];
      if (p <= p1) {
        const t = (p - p0) / (p1 - p0);
        return this.lerpHex(c0, c1, t);
      }
    }
    return stops[stops.length - 1][1];
  }

  getUtilizationStatus(pct: number): string {
    const p = pct || 0;
    if (p < 75) return 'On track';
    if (p < 90) return 'Getting close';
    if (p < 100) return 'Near limit';
    if (p < 125) return 'Over';
    if (p < 150) return 'Well over';
    return 'Way over';
  }

  // Legible text color for a filled badge, chosen by the fill's luminance so it
  // stays readable across the whole green->red ramp in both light and dark themes.
  getContrastText(hex: string): string {
    const [r, g, b] = this.hexToRgb(hex).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.4 ? '#1a1a1a' : '#ffffff';
  }

  private hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }

  private lerpHex(a: string, b: string, t: number): string {
    const ca = this.hexToRgb(a);
    const cb = this.hexToRgb(b);
    const mix = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
    return '#' + mix.map((v) => v.toString(16).padStart(2, '0')).join('');
  }
}
