import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { RecurringExpensesService } from './recurring-expenses.service';
import { ClientEncryptionService } from '../../../core/services/encryption.service';
import { Store } from '@ngxs/store';
import { GroupKeyService } from '../../../core/services/group-key.service';
import { firstValueFrom } from 'rxjs';

describe('RecurringExpensesService', () => {
  let service: RecurringExpensesService;
  let httpMock: HttpTestingController;
  let encryptionServiceSpy: jest.Mocked<ClientEncryptionService>;

  const storeMock = {
    selectSnapshot: jest
      .fn()
      .mockImplementation(() => ({ email: 'test@finmate.local' })),
  };

  beforeEach(() => {
    const encSpy = {
      loadKeyFromSession: jest.fn().mockResolvedValue('test-key'),
      encrypt: jest.fn().mockResolvedValue('encrypted-value'),
      decryptExpense: jest
        .fn()
        .mockImplementation((val) => Promise.resolve(val)),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        RecurringExpensesService,
        { provide: ClientEncryptionService, useValue: encSpy },
        {
          provide: GroupKeyService,
          useValue: {
            getGroupDataKey: jest.fn().mockResolvedValue('mock-group-key'),
            resolveGroupKey: jest
              .fn()
              .mockResolvedValue({ status: 'ready', key: 'mock-group-key' }),
          },
        },
        { provide: Store, useValue: storeMock },
      ],
    });

    service = TestBed.inject(RecurringExpensesService);
    httpMock = TestBed.inject(HttpTestingController);
    encryptionServiceSpy = TestBed.inject(
      ClientEncryptionService,
    ) as jest.Mocked<ClientEncryptionService>;
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should fetch recurring expenses and decrypt them', (done) => {
    const mockData = [{ id: '1', title: 'enc:title', description: 'enc:desc' }];

    service.getRecurringExpenses('group-1').subscribe((data) => {
      expect(data).toHaveLength(1);
      expect(encryptionServiceSpy.decryptExpense).toHaveBeenCalled();
      done();
    });

    const req = httpMock.expectOne('/api/v1/recurring-expenses?groupId=group-1');
    expect(req.request.method).toBe('GET');
    // responseInterceptor unwraps { success, data } → the array before the
    // service sees it, so the service receives the bare array (not { data }).
    req.flush(mockData);
  });

  it('creates a recurring expense from the interceptor-unwrapped body without erroring the save', async () => {
    const created = { id: '1', title: 'enc:title', description: 'enc:desc' };

    const result = firstValueFrom(
      service.createRecurringExpense({
        title: 'Rent',
        amountTotal: 100,
        currency: 'USD',
        category: 'Housing & Rent',
        frequency: 'monthly',
        startDate: '2026-07-28',
        splits: [],
      } as any),
    );

    // encryptPayload is async, so the POST is dispatched on a later microtask —
    // let those settle before asserting the request.
    await new Promise((r) => setTimeout(r, 0));

    const req = httpMock.expectOne('/api/v1/recurring-expenses');
    expect(req.request.method).toBe('POST');
    // Interceptor-unwrapped body is the template object itself. The old
    // `map(res => res.data)` turned this into undefined and rejected the save.
    req.flush(created);

    const res = await result;
    expect(res.id).toBe('1');
    expect(encryptionServiceSpy.decryptExpense).toHaveBeenCalled();
  });
});
