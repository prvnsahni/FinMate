import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { ExpensesService } from './expenses.service';
import { ClientEncryptionService } from '../../../core/services/encryption.service';
import { Store } from '@ngxs/store';
import { DECRYPTION_FAILED_PLACEHOLDER } from '../../../core/constants/crypto.constants';
import { firstValueFrom } from 'rxjs';
import { GroupKeyService } from '../../../core/services/group-key.service';
import { DECRYPTION_MESSAGES } from '../../../core/models/decryption-state';

describe('ExpensesService', () => {
  let service: ExpensesService;
  let httpMock: HttpTestingController;
  let encryptionServiceSpy: jest.Mocked<ClientEncryptionService>;
  let storeMock: any;

  const mockUser = { email: 'test@finmate.local', userId: 'user-1' };

  beforeEach(() => {
    const encSpy = {
      loadKeyFromSession: jest.fn().mockResolvedValue('mock-crypto-key'),
      encrypt: jest
        .fn()
        .mockImplementation((val) => Promise.resolve(`enc:${val}`)),
      decryptExpense: jest.fn().mockImplementation((expense) =>
        Promise.resolve({
          ...expense,
          title: expense.title?.replace('enc:', '') || expense.title,
          description:
            expense.description?.replace('enc:', '') || expense.description,
        }),
      ),
    };

    storeMock = {
      selectSnapshot: jest.fn().mockReturnValue(mockUser),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        ExpensesService,
        { provide: ClientEncryptionService, useValue: encSpy },
        {
          provide: GroupKeyService,
          useValue: {
            getGroupDataKey: jest.fn().mockResolvedValue('mock-group-key'),
            resolveGroupKey: jest
              .fn()
              .mockResolvedValue({ status: 'ready', key: 'mock-group-key' }),
            getGroupKeyForEncryption: jest
              .fn()
              .mockResolvedValue({ key: 'mock-group-key', versionId: 'v1-id' }),
            getKnownActiveVersionId: jest.fn().mockReturnValue('v1-id'),
            createGroupKey: jest.fn().mockResolvedValue('mock-group-key'),
          },
        },
        { provide: Store, useValue: storeMock },
      ],
    });

    service = TestBed.inject(ExpensesService);
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

  // --- getExpenses ---
  describe('getExpenses', () => {
    it('should fetch and decrypt expenses', (done) => {
      const mockData = [
        {
          id: 'exp-1',
          title: 'enc:Groceries',
          description: 'enc:Weekly groceries',
        },
        { id: 'exp-2', title: 'enc:Rent', description: '' },
      ];

      service.getExpenses('group-1').subscribe((res) => {
        expect(res.data).toHaveLength(2);
        expect(encryptionServiceSpy.decryptExpense).toHaveBeenCalledTimes(2);
        done();
      });

      const req = httpMock.expectOne('/api/expenses?groupId=group-1');
      expect(req.request.method).toBe('GET');
      req.flush({ data: mockData, meta: { totalItems: 2 } });
    });

    it('should pass pagination and filter params correctly', (done) => {
      service
        .getExpenses('group-1', {
          page: 2,
          limit: 10,
          categories: ['food', 'travel'],
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          minAmount: 100,
        })
        .subscribe(() => done());

      const req = httpMock.expectOne(
        '/api/expenses?groupId=group-1&page=2&limit=10&categories=food,travel&startDate=2026-01-01&endDate=2026-01-31&minAmount=100',
      );
      req.flush({ data: [], meta: { totalItems: 0 } });
    });

    it('should send tagIds as a comma-separated param (TAG-BATCH-B)', (done) => {
      service
        .getExpenses('group-1', { tagIds: ['milk', 'grocery'] })
        .subscribe(() => done());

      const req = httpMock.expectOne(
        '/api/expenses?groupId=group-1&tagIds=milk,grocery',
      );
      req.flush({ data: [], meta: { totalItems: 0 } });
    });

    it('should decrypt expenses from paginated response payloads', (done) => {
      const mockData = {
        data: [
          {
            id: 'exp-1',
            title: 'enc:Groceries',
            description: 'enc:Weekly groceries',
            encryptionScope: 'group',
            groupId: 'group-1',
            groupKeyVersionId: 'version-1',
          },
        ],
        meta: { totalItems: 1 },
      } as any;

      service.getExpenses('group-1').subscribe((res: any) => {
        expect(res.data.data).toHaveLength(1);
        expect(encryptionServiceSpy.decryptExpense).toHaveBeenCalledTimes(1);
        done();
      });

      const req = httpMock.expectOne('/api/expenses?groupId=group-1');
      req.flush({ data: mockData });
    });
    it('should return placeholder text when decryption fails — never ciphertext', (done) => {
      encryptionServiceSpy.decryptExpense.mockRejectedValue(
        new Error('Internal decryption error'),
      );

      const mockData = [
        { id: 'exp-1', title: 'abc123:xyz789', description: 'cipher:text' },
      ];

      service.getExpenses('group-1').subscribe((res) => {
        expect(res.data[0].title).toBe(DECRYPTION_MESSAGES.unexpected);
        expect(res.data[0].description).toBe('');
        // Verify no technical message leaks
        expect(res.data[0].title).not.toContain('decrypt failed');
        expect(res.data[0].title).not.toContain('CryptoKey');
        expect(res.data[0].title).not.toContain('AES');
        done();
      });

      const req = httpMock.expectOne('/api/expenses?groupId=group-1');
      req.flush({ data: mockData });
    });

    it('should mask encrypted data when no encryption key is available', (done) => {
      encryptionServiceSpy.loadKeyFromSession.mockResolvedValue(null);

      const mockData = [
        {
          id: 'exp-1',
          title: 'abc123:xyz789',
          description: 'cipher:text',
          encryptionScope: 'group',
        },
      ];

      service.getExpenses('group-1').subscribe((res) => {
        expect(res.data[0].title).toBe(DECRYPTION_MESSAGES.session);
        expect(res.data[0].description).toBe('');
        expect(encryptionServiceSpy.decryptExpense).not.toHaveBeenCalled();
        done();
      });

      const req = httpMock.expectOne('/api/expenses?groupId=group-1');
      req.flush({ data: mockData });
    });

    it('should skip decryption when no user is logged in', (done) => {
      storeMock.selectSnapshot.mockReturnValue(null);

      const mockData = [{ id: 'exp-1', title: 'No User Title' }];

      service.getExpenses('group-1').subscribe((res) => {
        expect(res.data[0].title).toBe('No User Title');
        expect(encryptionServiceSpy.loadKeyFromSession).not.toHaveBeenCalled();
        done();
      });

      const req = httpMock.expectOne('/api/expenses?groupId=group-1');
      req.flush({ data: mockData });
    });
  });

  // --- TAG-BATCH-B: taxonomy + tag analytics ---
  describe('taxonomy + tag analytics (TAG-BATCH-B)', () => {
    it('getTaxonomy fetches the read-only canonical taxonomy', (done) => {
      const tags = [
        { id: 'milk', canonicalName: 'Milk', normalizedKey: 'milk', parentId: 'dairy', status: 'active', version: 1 },
      ];
      service.getTaxonomy().subscribe((res) => {
        expect(res).toEqual(tags);
        done();
      });
      const req = httpMock.expectOne('/api/taxonomy');
      expect(req.request.method).toBe('GET');
      req.flush(tags);
    });

    it('getTagAnalytics honors the unified filter and hits the tags endpoint', (done) => {
      const points = [{ tagId: 'grocery', total: 60, currency: 'INR' }];
      service
        .getTagAnalytics('group-1', { tagIds: ['grocery'], startDate: '2026-08-01' })
        .subscribe((res) => {
          expect(res).toEqual(points);
          done();
        });
      const req = httpMock.expectOne(
        '/api/expenses/analytics/tags?groupId=group-1&startDate=2026-08-01&tagIds=grocery',
      );
      expect(req.request.method).toBe('GET');
      req.flush(points);
    });
  });

  // --- createExpense ---
  describe('createExpense', () => {
    it('should encrypt payload and decrypt the response', async () => {
      const payload = {
        title: 'Dinner',
        description: 'Team dinner',
        amountTotal: 150,
        currency: 'USD',
        category: 'food',
        expenseDate: '2026-06-28',
        paidByUserId: 'user-1',
        splits: [],
      };

      const promise = firstValueFrom(service.createExpense(payload));

      // Wait for encryptPayload microtask to execute and request to be scheduled
      await new Promise((resolve) => setTimeout(resolve, 0));

      const req = httpMock.expectOne('/api/expenses');
      expect(req.request.method).toBe('POST');
      expect(req.request.body.title).toBe('enc:Dinner');
      req.flush({ id: 'exp-new', title: 'enc:Dinner' });

      const resolvedExpense = await promise;

      expect(resolvedExpense).toBeDefined();
      expect(encryptionServiceSpy.encrypt).toHaveBeenCalledWith(
        'Dinner',
        'mock-crypto-key',
      );
      expect(encryptionServiceSpy.encrypt).toHaveBeenCalledWith(
        'Team dinner',
        'mock-crypto-key',
      );
      expect(encryptionServiceSpy.decryptExpense).toHaveBeenCalled();
    });

    it('should declare the concrete group key version on group creates', async () => {
      const payload = {
        title: 'Dinner',
        amountTotal: 150,
        currency: 'USD',
        category: 'food',
        expenseDate: '2026-06-28',
        paidByUserId: 'user-1',
        groupId: 'group-1',
        splits: [],
      };

      const promise = firstValueFrom(service.createExpense(payload));

      // Wait for encryptPayload microtask to execute and request to be scheduled
      await new Promise((resolve) => setTimeout(resolve, 0));

      const req = httpMock.expectOne('/api/expenses');
      expect(req.request.method).toBe('POST');
      expect(req.request.body.groupKeyVersionId).toBe('v1-id');
      expect(req.request.body.title).toBe('enc:Dinner');
      req.flush({ id: 'exp-new', title: 'enc:Dinner' });

      await promise;

      expect(encryptionServiceSpy.encrypt).toHaveBeenCalledWith(
        'Dinner',
        'mock-group-key',
      );
    });

    it('should return placeholder on decryption failure for created expense', async () => {
      encryptionServiceSpy.decryptExpense.mockRejectedValue(
        new Error('Bad key'),
      );

      const payload = {
        title: 'Test',
        amountTotal: 10,
        currency: 'USD',
        category: 'other',
        expenseDate: '2026-06-28',
        paidByUserId: 'user-1',
        splits: [],
      };

      const promise = firstValueFrom(service.createExpense(payload));

      // Wait for encryptPayload microtask to execute and request to be scheduled
      await new Promise((resolve) => setTimeout(resolve, 0));

      const req = httpMock.expectOne('/api/expenses');
      req.flush({ id: 'exp-new', title: 'enc:Test' });

      const resolvedExpense = await promise;

      expect(resolvedExpense.title).toBe(DECRYPTION_MESSAGES.unexpected);
    });
  });

  // --- updateExpense ---
  describe('updateExpense', () => {
    it('should encrypt payload, send PATCH, and decrypt the response', async () => {
      const payload = {
        title: 'Updated Dinner',
        amountTotal: 200,
        currency: 'USD',
        category: 'food',
        expenseDate: '2026-06-28',
        paidByUserId: 'user-1',
        splits: [],
        version: 2,
      };

      const promise = firstValueFrom(service.updateExpense('exp-1', payload));

      // Wait for encryptPayload microtask to execute and request to be scheduled
      await new Promise((resolve) => setTimeout(resolve, 0));

      const req = httpMock.expectOne('/api/expenses/exp-1');
      expect(req.request.method).toBe('PATCH');
      req.flush({ id: 'exp-1', title: 'enc:Updated Dinner' });

      await promise;

      expect(encryptionServiceSpy.encrypt).toHaveBeenCalledWith(
        'Updated Dinner',
        'mock-crypto-key',
      );
    });
  });

  // --- deleteExpense ---
  describe('deleteExpense', () => {
    it('should send DELETE request', (done) => {
      service.deleteExpense('exp-1').subscribe(() => {
        done();
      });

      const req = httpMock.expectOne('/api/expenses/exp-1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  // --- restoreExpense ---
  describe('restoreExpense', () => {
    it('should restore and decrypt the expense', (done) => {
      service.restoreExpense('exp-1').subscribe(() => {
        expect(encryptionServiceSpy.decryptExpense).toHaveBeenCalled();
        done();
      });

      const req = httpMock.expectOne('/api/expenses/exp-1/restore');
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'exp-1', title: 'enc:Restored' });
    });

    it('should return placeholder when restore decryption fails', (done) => {
      encryptionServiceSpy.decryptExpense.mockRejectedValue(
        new Error('Corrupted data'),
      );

      service.restoreExpense('exp-1').subscribe((expense) => {
        expect(expense.title).toBe(DECRYPTION_MESSAGES.unexpected);
        expect(expense.description).toBe('');
        done();
      });

      const req = httpMock.expectOne('/api/expenses/exp-1/restore');
      req.flush({ id: 'exp-1', title: 'cipher:text' });
    });
  });

  // --- Analytics ---
  describe('getMonthlyAnalytics', () => {
    it('should call correct URL without groupId', (done) => {
      service.getMonthlyAnalytics().subscribe(() => done());

      const req = httpMock.expectOne('/api/expenses/analytics/monthly');
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('should append groupId query param when provided', (done) => {
      service.getMonthlyAnalytics('group-1').subscribe(() => done());

      const req = httpMock.expectOne(
        '/api/expenses/analytics/monthly?groupId=group-1',
      );
      req.flush([]);
    });

    it('should not append groupId when value is "personal"', (done) => {
      service.getMonthlyAnalytics('personal').subscribe(() => done());

      const req = httpMock.expectOne('/api/expenses/analytics/monthly');
      req.flush([]);
    });
  });

  describe('getCategoryAnalytics', () => {
    it('should call correct URL with groupId', (done) => {
      service.getCategoryAnalytics('group-1').subscribe(() => done());

      const req = httpMock.expectOne(
        '/api/expenses/analytics/categories?groupId=group-1',
      );
      req.flush([]);
    });
  });

  // --- Import ---
  describe('importExpenses', () => {
    it('should POST FormData', (done) => {
      const formData = new FormData();
      service.importExpenses(formData).subscribe(() => done());

      const req = httpMock.expectOne('/api/import/expenses');
      expect(req.request.method).toBe('POST');
      req.flush(null);
    });
  });

  // --- Error message non-technical validation ---
  describe('error messages are non-technical', () => {
    it('should never expose technical terms in decryption failure output', (done) => {
      encryptionServiceSpy.decryptExpense.mockRejectedValue(
        new Error('OperationError: AES-GCM decrypt failed on CryptoKey'),
      );

      service.getExpenses('group-1').subscribe((res) => {
        const title = res.data[0].title;
        const desc = res.data[0].description;
        const combined = `${title} ${desc}`;

        expect(combined).not.toMatch(/decrypt failed/i);
        expect(combined).not.toMatch(/CryptoKey/i);
        expect(combined).not.toMatch(/AES/i);
        expect(combined).not.toMatch(/IndexedDB/i);
        expect(combined).not.toMatch(/\d{3}/); // No HTTP status codes
        done();
      });

      const req = httpMock.expectOne('/api/expenses?groupId=group-1');
      req.flush({ data: [{ id: 'exp-1', title: 'cipher' }] });
    });
  });
});
