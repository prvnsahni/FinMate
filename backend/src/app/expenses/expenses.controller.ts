import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateExpenseDto,
  ExportExpensesQueryDto,
  UpdateExpenseDto,
} from './dto';
import {
  ExpenseExportQueryService,
  ExpensesAnalyticsService,
  ExpensesCrudService,
} from './services';
import { SuccessResponse } from '../common/response.util';
import { RecoveryStatusService } from '../recovery/recovery-status.service';

/** Normalize a raw `transactionType` query value; `both`/anything else → undefined (no filter). */
function normalizeTxType(value?: string): 'expense' | 'refund' | undefined {
  return value === 'expense' || value === 'refund' ? value : undefined;
}

/** Split a comma-separated query value into a trimmed, non-empty array (or undefined). */
function csvParam(value?: string): string[] | undefined {
  if (!value) return undefined;
  const arr = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? arr : undefined;
}

/** Parse a numeric query value, or undefined when absent/invalid. */
function numParam(value?: string): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Normalize a sort direction; anything but `asc` → `desc`. */
function normalizeSortOrder(value?: string): 'asc' | 'desc' {
  return value === 'asc' ? 'asc' : 'desc';
}

@Controller('expenses')
@UseGuards(JwtAuthGuard)
export class ExpensesController {
  constructor(
    private readonly expensesCrudService: ExpensesCrudService,
    private readonly expensesAnalyticsService: ExpensesAnalyticsService,
    private readonly expenseExportQueryService: ExpenseExportQueryService,
    private readonly recovery: RecoveryStatusService,
  ) {}

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  @Post()
  async create(
    @Body() dto: CreateExpenseDto,
    @Req() req: Request & { user: { id: string } },
  ) {
    // REC-1: a direct_shared expense writes per-entry wrapped content keys
    // (Class-A key material). Require recovery only in that case — personal and
    // group expenses establish no new recoverable key material and are unaffected.
    if (dto.wrappedContentKeys && dto.wrappedContentKeys.length > 0) {
      await this.recovery.assertConfigured(req.user.id);
    }
    const result = await this.expensesCrudService.createExpense(
      req.user.id,
      dto,
    );
    return new SuccessResponse('Expense created successfully', result);
  }

  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('groupId') groupId?: string,
    @Query('categories') categories?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('memberIds') memberIds?: string,
    @Query('paidByIds') paidByIds?: string,
    @Query('transactionType') transactionType?: string,
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
    @Query('tagIds') tagIds?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
    @Req() req?: Request & { user: { id: string } },
  ) {
    let pageNum = page ? parseInt(page, 10) : 1;
    let limitNum = limit ? parseInt(limit, 10) : 20;
    if (isNaN(pageNum) || pageNum <= 0) pageNum = 1;
    if (isNaN(limitNum) || limitNum <= 0) limitNum = 20;

    const result = await this.expensesCrudService.listExpenses(req!.user.id, {
      page: pageNum,
      limit: limitNum,
      cursor,
      groupId,
      categories: csvParam(categories),
      status,
      startDate,
      endDate,
      memberIds: csvParam(memberIds),
      paidByIds: csvParam(paidByIds),
      transactionType: normalizeTxType(transactionType),
      minAmount: numParam(minAmount),
      maxAmount: numParam(maxAmount),
      tagIds: csvParam(tagIds),
      sortBy:
        sortBy === 'amount' ? 'amount' : sortBy === 'date' ? 'date' : undefined,
      sortOrder: normalizeSortOrder(sortOrder),
    });
    return new SuccessResponse('Expenses retrieved successfully', result);
  }

  // ─── My Expenses (personal + group shares) ───────────────────────────────
  //
  // NOTE: literal-segment routes below (`me`, `analytics/*`) must be declared
  // before `@Get(':id')` — NestJS/Express match routes in registration order,
  // not by specificity, so a param route declared first would shadow these
  // and swallow them into `findOne()` with an invalid-UUID 400.

  /**
   * Returns the calling user's personal expenses PLUS their share of group
   * expenses (via ExpenseSplit), with `myShare` and `expenseType` on each row.
   * Totals on the dashboard must use `myShare`, not `amountTotal`.
   */
  @Get('me')
  async listMine(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Req() req?: Request & { user: { id: string } },
  ) {
    const pageNum = page ? Math.max(1, parseInt(page, 10)) : 1;
    const limitNum = limit
      ? Math.min(100, Math.max(1, parseInt(limit, 10)))
      : 25;
    const result = await this.expensesCrudService.listMyExpenses(
      req!.user.id,
      pageNum,
      limitNum,
    );
    return new SuccessResponse('My expenses retrieved successfully', result);
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  /**
   * Returns the caller's expense rows (personal + their share of group
   * expenses) matching the given filters, for client-side workbook generation.
   *
   * Titles/descriptions are returned as ciphertext — decryption and .xlsx
   * generation happen in the browser, preserving the zero-knowledge design.
   * The server remains the single source of truth for permissions/filtering.
   */
  @Get('export')
  async exportExpenses(
    @Query() query: ExportExpensesQueryDto,
    @Req() req: Request & { user: { id: string } },
  ) {
    const rows = await this.expenseExportQueryService.getExportRows(
      req.user.id,
      query,
    );
    return new SuccessResponse('Export data retrieved successfully', {
      rows,
      count: rows.length,
      filters: query,
    });
  }

  // ─── Analytics ────────────────────────────────────────────────────────────

  /** Monthly expense totals for a given year. */
  @Get('analytics/monthly')
  async monthlySummary(
    @Query('year', new DefaultValuePipe(new Date().getFullYear()), ParseIntPipe)
    year: number,
    @Query('groupId') groupId: string | undefined,
    @Query('startDate') startDate: string | undefined,
    @Query('endDate') endDate: string | undefined,
    @Query('categories') categories: string | undefined,
    @Query('memberIds') memberIds: string | undefined,
    @Query('paidByIds') paidByIds: string | undefined,
    @Query('transactionType') transactionType: string | undefined,
    @Query('minAmount') minAmount: string | undefined,
    @Query('maxAmount') maxAmount: string | undefined,
    @Req() req: Request & { user: { id: string } },
  ) {
    const result = await this.expensesAnalyticsService.getMonthlySummary({
      userId: req.user.id,
      groupId,
      year,
      startDate,
      endDate,
      categories: csvParam(categories),
      memberIds: csvParam(memberIds),
      paidByIds: csvParam(paidByIds),
      transactionType: normalizeTxType(transactionType),
      minAmount: numParam(minAmount),
      maxAmount: numParam(maxAmount),
    });
    return new SuccessResponse(
      'Monthly analytics summary retrieved successfully',
      result,
    );
  }

  /** Yearly expense totals across all years. */
  @Get('analytics/yearly')
  async yearlySummary(
    @Query('groupId') groupId: string | undefined,
    @Req() req: Request & { user: { id: string } },
  ) {
    const result = await this.expensesAnalyticsService.getYearlySummary({
      userId: req.user.id,
      groupId,
    });
    return new SuccessResponse(
      'Yearly analytics summary retrieved successfully',
      result,
    );
  }

  /** Category distribution totals, optionally filtered by date range. */
  @Get('analytics/categories')
  async categoryDistribution(
    @Query('groupId') groupId: string | undefined,
    @Query('startDate') startDate: string | undefined,
    @Query('endDate') endDate: string | undefined,
    @Query('categories') categories: string | undefined,
    @Query('memberIds') memberIds: string | undefined,
    @Query('paidByIds') paidByIds: string | undefined,
    @Query('transactionType') transactionType: string | undefined,
    @Query('minAmount') minAmount: string | undefined,
    @Query('maxAmount') maxAmount: string | undefined,
    @Query('tagIds') tagIds: string | undefined,
    @Req() req: Request & { user: { id: string } },
  ) {
    const result = await this.expensesAnalyticsService.getCategoryDistribution({
      userId: req.user.id,
      groupId,
      startDate,
      endDate,
      categories: csvParam(categories),
      memberIds: csvParam(memberIds),
      paidByIds: csvParam(paidByIds),
      transactionType: normalizeTxType(transactionType),
      minAmount: numParam(minAmount),
      maxAmount: numParam(maxAmount),
      tagIds: csvParam(tagIds),
    });
    return new SuccessResponse(
      'Category distribution analytics retrieved successfully',
      result,
    );
  }

  /**
   * TAG-BATCH-B — canonical tag spending distribution, optionally date/dimension
   * filtered (a date range yields the "monthly tag spending" report). READ-ONLY:
   * aggregates existing expense amounts and never modifies any finance value.
   */
  @Get('analytics/tags')
  async tagDistribution(
    @Query('groupId') groupId: string | undefined,
    @Query('startDate') startDate: string | undefined,
    @Query('endDate') endDate: string | undefined,
    @Query('categories') categories: string | undefined,
    @Query('memberIds') memberIds: string | undefined,
    @Query('paidByIds') paidByIds: string | undefined,
    @Query('transactionType') transactionType: string | undefined,
    @Query('minAmount') minAmount: string | undefined,
    @Query('maxAmount') maxAmount: string | undefined,
    @Query('tagIds') tagIds: string | undefined,
    @Req() req: Request & { user: { id: string } },
  ) {
    const result = await this.expensesAnalyticsService.getTagDistribution({
      userId: req.user.id,
      groupId,
      startDate,
      endDate,
      categories: csvParam(categories),
      memberIds: csvParam(memberIds),
      paidByIds: csvParam(paidByIds),
      transactionType: normalizeTxType(transactionType),
      minAmount: numParam(minAmount),
      maxAmount: numParam(maxAmount),
      tagIds: csvParam(tagIds),
    });
    return new SuccessResponse(
      'Tag distribution analytics retrieved successfully',
      result,
    );
  }

  /** Combined category-level aggregated monthly expenditures (personal + group splits). */
  @Get('analytics/all-monthly')
  async allMonthlySummary(
    @Query('month') month: string | undefined,
    @Req() req: Request & { user: { id: string } },
  ) {
    const targetMonth = month ?? new Date().toISOString().slice(0, 7);
    const result =
      await this.expensesAnalyticsService.getCombinedMonthlyAnalytics(
        req.user.id,
        targetMonth,
      );
    return new SuccessResponse(
      'All monthly summary analytics retrieved successfully',
      result,
    );
  }

  /**
   * Soft duplicate check, used by the client before Save to warn the user —
   * never to block the save. Matches on amount + date + scope + type only;
   * title is deliberately excluded (see findPotentialDuplicates() doc).
   */
  @Get('duplicates')
  async findDuplicates(
    @Query('amountTotal') amountTotal: string,
    @Query('expenseDate') expenseDate: string,
    @Query('currency') currency: string,
    @Query('transactionType') transactionType: string | undefined,
    @Query('groupId') groupId: string | undefined,
    @Query('excludeId') excludeId: string | undefined,
    @Req() req: Request & { user: { id: string } },
  ) {
    const result = await this.expensesCrudService.findPotentialDuplicates(
      req.user.id,
      {
        amountTotal: Number(amountTotal),
        expenseDate,
        currency,
        transactionType: transactionType === 'refund' ? 'refund' : 'expense',
        groupId: groupId && groupId !== 'personal' ? groupId : undefined,
        excludeId,
      },
    );
    return new SuccessResponse('Potential duplicates retrieved', result);
  }

  // ─── Single-expense routes (must come after all literal routes above) ────

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    const result = await this.expensesCrudService.getExpenseById(
      req.user.id,
      id,
    );
    return new SuccessResponse('Expense retrieved successfully', result);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
    @Req() req: Request & { user: { id: string } },
  ) {
    const result = await this.expensesCrudService.updateExpense(
      req.user.id,
      id,
      dto,
    );
    return new SuccessResponse('Expense updated successfully', result);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    await this.expensesCrudService.deleteExpense(req.user.id, id);
    return new SuccessResponse('Expense deleted successfully', {});
  }

  // ─── Version History ──────────────────────────────────────────────────────

  /**
   * Returns the append-only version history for an expense.
   * Read-only. Restore is out of v2 scope.
   */
  @Get(':id/versions')
  async getVersionHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    const result = await this.expensesCrudService.getExpenseVersionHistory(
      req.user.id,
      id,
    );
    return new SuccessResponse('Expense version history retrieved', result);
  }

  // ─── Restore ──────────────────────────────────────────────────────────────

  /** Restore a soft-deleted expense within the allowed restore window. */
  @Post(':id/restore')
  async restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    const result = await this.expensesCrudService.restoreExpense(
      req.user.id,
      id,
    );
    return new SuccessResponse('Expense restored successfully', result);
  }
}
