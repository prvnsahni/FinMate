import { Injectable } from '@nestjs/common';
import { CreateExpenseDto, UpdateExpenseDto } from '../dto';
import { PaginatedResponse } from '../../common/pagination.util';
import { ExpensesService } from '../expenses.service';

export interface ExpenseListParams {
  page: number;
  limit: number;
  cursor?: string;
  groupId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  /** Categories (exact names) — matches ANY. */
  categories?: string[];
  /** Participants (via splits) — group-member ids, matches ANY. */
  memberIds?: string[];
  /** Payers — group-member ids, matches ANY. */
  paidByIds?: string[];
  /** `undefined` applies no transaction-type filter. */
  transactionType?: 'expense' | 'refund';
  minAmount?: number;
  maxAmount?: number;
  /** Canonical tag ids — matches ANY (TAG-BATCH-B). */
  tagIds?: string[];
  sortBy?: 'date' | 'amount';
  sortOrder?: 'asc' | 'desc';
}

@Injectable()
export class ExpensesCrudService {
  constructor(private readonly expensesService: ExpensesService) {}

  async createExpense(
    userId: string,
    dto: CreateExpenseDto,
  ): Promise<Record<string, unknown>> {
    return this.expensesService.createExpense(userId, dto);
  }

  async listExpenses(
    userId: string,
    params: ExpenseListParams,
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    return this.expensesService.listExpenses(userId, params);
  }

  async findPotentialDuplicates(
    userId: string,
    params: {
      amountTotal: number;
      expenseDate: string;
      currency: string;
      transactionType?: 'expense' | 'refund';
      groupId?: string;
      excludeId?: string;
    },
  ): Promise<Record<string, unknown>[]> {
    return this.expensesService.findPotentialDuplicates(userId, params);
  }

  async getExpenseById(
    userId: string,
    id: string,
  ): Promise<Record<string, unknown>> {
    return this.expensesService.getExpenseById(userId, id);
  }

  async updateExpense(
    userId: string,
    id: string,
    dto: UpdateExpenseDto,
  ): Promise<Record<string, unknown>> {
    return this.expensesService.updateExpense(userId, id, dto);
  }

  async deleteExpense(userId: string, id: string): Promise<void> {
    return this.expensesService.deleteExpense(userId, id);
  }

  async restoreExpense(
    userId: string,
    id: string,
  ): Promise<Record<string, unknown>> {
    return this.expensesService.restoreExpense(userId, id);
  }

  async listMyExpenses(
    userId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    return this.expensesService.listMyExpenses(userId, page, limit);
  }

  async getExpenseVersionHistory(
    userId: string,
    expenseId: string,
  ): Promise<Record<string, unknown>[]> {
    return this.expensesService.getExpenseVersionHistory(userId, expenseId);
  }
}
