import { Injectable } from '@nestjs/common';
import { ExpensesService } from '../expenses.service';

export interface AnalyticsFilter {
  userId: string;
  groupId?: string;
  startDate?: string;
  endDate?: string;
  // ── Unified group-filter dimensions ──────────────────────────────────────
  categories?: string[];
  /** Group-member ids (participants via splits). */
  memberIds?: string[];
  /** Group-member ids (payers). */
  paidByIds?: string[];
  /** `undefined` applies no transaction-type filter. */
  transactionType?: 'expense' | 'refund';
  minAmount?: number;
  maxAmount?: number;
  /** TAG-BATCH-B — canonical tag ids (match ANY). */
  tagIds?: string[];
}

export interface MonthlyTotal {
  month: string;
  total: number;
  currency: string;
}

export interface CategoryTotal {
  category: string;
  total: number;
  currency: string;
}

export interface TagTotal {
  tagId: string;
  total: number;
  currency: string;
}

export interface TagTrendPoint {
  month: string;
  tagId: string;
  total: number;
  currency: string;
}

@Injectable()
export class ExpensesAnalyticsService {
  constructor(private readonly expensesService: ExpensesService) {}

  async getMonthlySummary(
    filter: AnalyticsFilter & { year: number },
  ): Promise<MonthlyTotal[]> {
    return this.expensesService.getMonthlySummary(filter);
  }

  async getYearlySummary(filter: AnalyticsFilter): Promise<MonthlyTotal[]> {
    return this.expensesService.getYearlySummary(filter);
  }

  async getCategoryDistribution(
    filter: AnalyticsFilter,
  ): Promise<CategoryTotal[]> {
    return this.expensesService.getCategoryDistribution(filter);
  }

  /** TAG-BATCH-B — canonical tag spending distribution (read-only). */
  async getTagDistribution(filter: AnalyticsFilter): Promise<TagTotal[]> {
    return this.expensesService.getTagDistribution(filter);
  }

  /** TAG-BATCH-B2 — monthly canonical tag spending trend (read-only). */
  async getTagTrend(filter: AnalyticsFilter): Promise<TagTrendPoint[]> {
    return this.expensesService.getTagTrend(filter);
  }

  async getCombinedMonthlyAnalytics(
    userId: string,
    month: string,
  ): Promise<{ category: string; amount: number; currency: string }[]> {
    return this.expensesService.getCombinedMonthlyAnalytics(userId, month);
  }
}
