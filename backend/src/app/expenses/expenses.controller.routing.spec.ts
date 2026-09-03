import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as http from 'http';
import { ExpensesController } from './expenses.controller';
import {
  ExpenseExportQueryService,
  ExpensesAnalyticsService,
  ExpensesCrudService,
} from './services';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RecoveryStatusService } from '../recovery/recovery-status.service';

/**
 * HTTP-level route-matching tests.
 *
 * NestJS/Express match routes in declaration order, not by specificity. A
 * literal-segment route (`me`, `analytics/monthly`, ...) declared *after*
 * `@Get(':id')` gets shadowed: the request matches `:id` first and
 * `ParseUUIDPipe` rejects the literal segment as an invalid UUID with a 400,
 * without ever reaching the intended handler.
 *
 * Calling controller methods directly (as in expenses.controller.spec.ts)
 * cannot detect this class of bug — it never goes through Express's router.
 * These tests boot a real Nest HTTP server with the real route table and
 * mocked services, then issue real HTTP requests to prove which handler
 * actually gets invoked for each path.
 */
function get(
  port: number,
  path: string,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let body: any;
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      })
      .on('error', reject);
  });
}

describe('ExpensesController — HTTP route matching', () => {
  let app: INestApplication;
  let port: number;

  const crud: Record<string, jest.Mock> = {
    createExpense: jest.fn(),
    listExpenses: jest.fn(),
    getExpenseById: jest.fn().mockResolvedValue({ id: 'resolved-by-id' }),
    updateExpense: jest.fn(),
    deleteExpense: jest.fn(),
    restoreExpense: jest.fn(),
    listMyExpenses: jest
      .fn()
      .mockResolvedValue({ data: [{ id: 'exp-1' }], meta: {} }),
    getExpenseVersionHistory: jest.fn(),
  };
  const analytics: Record<string, jest.Mock> = {
    getMonthlySummary: jest.fn().mockResolvedValue([{ month: '2026-07' }]),
    getYearlySummary: jest.fn().mockResolvedValue([]),
    getCategoryDistribution: jest.fn().mockResolvedValue([]),
    getCombinedMonthlyAnalytics: jest.fn().mockResolvedValue([]),
  };
  const exportQuery: Record<string, jest.Mock> = {
    getExportRows: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ExpensesController],
      providers: [
        { provide: ExpensesCrudService, useValue: crud },
        { provide: ExpensesAnalyticsService, useValue: analytics },
        { provide: ExpenseExportQueryService, useValue: exportQuery },
        {
          provide: RecoveryStatusService,
          useValue: {
            assertConfigured: jest.fn().mockResolvedValue(undefined),
            isConfigured: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = { id: 'user-1' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    port = (app.getHttpServer().address() as any).port;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    Object.values(crud).forEach((fn) => fn.mockClear());
    Object.values(analytics).forEach((fn) => fn.mockClear());
  });

  it('GET /expenses/me reaches listMine() -> listMyExpenses(), not findOne()', async () => {
    const { status } = await get(port, '/expenses/me');

    expect(status).toBe(200);
    expect(crud.listMyExpenses).toHaveBeenCalledWith('user-1', 1, 25);
    expect(crud.getExpenseById).not.toHaveBeenCalled();
  });

  it('GET /expenses/analytics/monthly reaches monthlySummary() -> getMonthlySummary()', async () => {
    const { status } = await get(port, '/expenses/analytics/monthly');

    expect(status).toBe(200);
    expect(analytics.getMonthlySummary).toHaveBeenCalled();
    expect(crud.getExpenseById).not.toHaveBeenCalled();
  });

  it('GET /expenses/{uuid} reaches findOne() -> getExpenseById()', async () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    const { status, body } = await get(port, `/expenses/${uuid}`);

    expect(status).toBe(200);
    expect(crud.getExpenseById).toHaveBeenCalledWith('user-1', uuid);
    expect(crud.listMyExpenses).not.toHaveBeenCalled();
    expect(body.data).toEqual({ id: 'resolved-by-id' });
  });

  it('GET /expenses/invalid returns 400 (not silently matched to another route)', async () => {
    const { status, body } = await get(port, '/expenses/invalid');

    expect(status).toBe(400);
    expect(crud.getExpenseById).not.toHaveBeenCalled();
    expect(crud.listMyExpenses).not.toHaveBeenCalled();
    expect(body.message).toMatch(/uuid/i);
  });
});
