import { Test, TestingModule } from '@nestjs/testing';
import { ExpensesController } from './expenses.controller';
import {
  ExpenseExportQueryService,
  ExpensesAnalyticsService,
  ExpensesCrudService,
} from './services';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuccessResponse } from '../common/response.util';
import { RecoveryStatusService } from '../recovery/recovery-status.service';

describe('ExpensesController', () => {
  let controller: ExpensesController;
  let crudService: jest.Mocked<ExpensesCrudService>;
  let analyticsService: jest.Mocked<ExpensesAnalyticsService>;
  let mockExpensesCrudService: Record<string, jest.Mock>;
  let mockExpensesAnalyticsService: Record<string, jest.Mock>;
  let mockRecoveryStatusService: {
    assertConfigured: jest.Mock;
    isConfigured: jest.Mock;
  };

  beforeEach(async () => {
    mockExpensesCrudService = {
      createExpense: jest.fn(),
      listExpenses: jest.fn(),
      getExpenseById: jest.fn(),
      updateExpense: jest.fn(),
      deleteExpense: jest.fn(),
      restoreExpense: jest.fn(),
    };
    mockExpensesAnalyticsService = {
      getMonthlySummary: jest.fn(),
      getYearlySummary: jest.fn(),
      getCategoryDistribution: jest.fn(),
      getCombinedMonthlyAnalytics: jest.fn(),
    };
    const mockExpenseExportQueryService = {
      getExportRows: jest.fn(),
    };
    mockRecoveryStatusService = {
      assertConfigured: jest.fn().mockResolvedValue(undefined),
      isConfigured: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExpensesController],
      providers: [
        { provide: ExpensesCrudService, useValue: mockExpensesCrudService },
        {
          provide: ExpensesAnalyticsService,
          useValue: mockExpensesAnalyticsService,
        },
        {
          provide: ExpenseExportQueryService,
          useValue: mockExpenseExportQueryService,
        },
        {
          provide: RecoveryStatusService,
          useValue: mockRecoveryStatusService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ExpensesController>(ExpensesController);
    crudService = module.get(
      ExpensesCrudService,
    ) as jest.Mocked<ExpensesCrudService>;
    analyticsService = module.get(
      ExpensesAnalyticsService,
    ) as jest.Mocked<ExpensesAnalyticsService>;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should parse pagination defaults and pass filters to service', async () => {
    crudService.listExpenses.mockResolvedValue({} as any);

    await controller.findAll(
      undefined,
      undefined,
      'cursor-1',
      'group-1',
      'Food,Travel',
      'posted',
      '2026-06-01',
      '2026-06-10',
      'member-1',
      'payer-1',
      'refund',
      '100',
      '500',
      'milk,grocery',
      'amount',
      'asc',
      {
        user: { id: 'user-1' },
      } as any,
    );

    expect(crudService.listExpenses).toHaveBeenCalledWith('user-1', {
      page: 1,
      limit: 20,
      cursor: 'cursor-1',
      groupId: 'group-1',
      categories: ['Food', 'Travel'],
      status: 'posted',
      startDate: '2026-06-01',
      endDate: '2026-06-10',
      memberIds: ['member-1'],
      paidByIds: ['payer-1'],
      transactionType: 'refund',
      minAmount: 100,
      maxAmount: 500,
      tagIds: ['milk', 'grocery'],
      sortBy: 'amount',
      sortOrder: 'asc',
    });
  });

  it('should forward create call', async () => {
    const dto: any = { title: 'Dinner' };
    crudService.createExpense.mockResolvedValue({ id: 'exp-1' });

    const result = await controller.create(dto, {
      user: { id: 'user-1' },
    } as any);

    expect(result).toEqual(
      new SuccessResponse('Expense created successfully', { id: 'exp-1' }),
    );
    expect(crudService.createExpense).toHaveBeenCalledWith('user-1', dto);
  });

  describe('REC-1 (direct-shared Class-A key material)', () => {
    it('requires recovery when creating a direct_shared expense (wrappedContentKeys)', async () => {
      crudService.createExpense.mockResolvedValue({ id: 'exp-2' });
      const dto: any = {
        title: 'ct',
        wrappedContentKeys: [{ userId: 'u2', wrappedKey: 'wk' }],
      };
      await controller.create(dto, { user: { id: 'user-1' } } as any);
      expect(mockRecoveryStatusService.assertConfigured).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('does NOT require recovery for a personal/group expense (no wrappedContentKeys)', async () => {
      crudService.createExpense.mockResolvedValue({ id: 'exp-3' });
      await controller.create(
        { title: 'Lunch' } as any,
        {
          user: { id: 'user-1' },
        } as any,
      );
      expect(mockRecoveryStatusService.assertConfigured).not.toHaveBeenCalled();
    });

    it('rejects the direct_shared create (and does not persist) when recovery is missing', async () => {
      mockRecoveryStatusService.assertConfigured.mockRejectedValue(
        new Error('REC_RECOVERY_REQUIRED'),
      );
      const dto: any = {
        title: 'ct',
        wrappedContentKeys: [{ userId: 'u2', wrappedKey: 'wk' }],
      };
      await expect(
        controller.create(dto, { user: { id: 'user-1' } } as any),
      ).rejects.toThrow('REC_RECOVERY_REQUIRED');
      expect(crudService.createExpense).not.toHaveBeenCalled();
    });
  });

  it('should forward delete call', async () => {
    crudService.deleteExpense.mockResolvedValue();

    const result = await controller.remove('exp-1', {
      user: { id: 'user-1' },
    } as any);

    expect(result).toEqual(
      new SuccessResponse('Expense deleted successfully', {}),
    );
    expect(crudService.deleteExpense).toHaveBeenCalledWith('user-1', 'exp-1');
  });

  it('should forward get by id call', async () => {
    crudService.getExpenseById.mockResolvedValue({ id: 'exp-1' } as any);

    const result = await controller.findOne('exp-1', {
      user: { id: 'user-1' },
    } as any);

    expect(result).toEqual(
      new SuccessResponse('Expense retrieved successfully', { id: 'exp-1' }),
    );
    expect(crudService.getExpenseById).toHaveBeenCalledWith('user-1', 'exp-1');
  });

  it('should forward update call', async () => {
    crudService.updateExpense.mockResolvedValue({
      id: 'exp-1',
      title: 'Updated',
    } as any);

    const result = await controller.update(
      'exp-1',
      { title: 'Updated', version: 1 } as any,
      {
        user: { id: 'user-1' },
      } as any,
    );

    expect(result).toEqual(
      new SuccessResponse('Expense updated successfully', {
        id: 'exp-1',
        title: 'Updated',
      }),
    );
    expect(crudService.updateExpense).toHaveBeenCalledWith('user-1', 'exp-1', {
      title: 'Updated',
      version: 1,
    });
  });
});
