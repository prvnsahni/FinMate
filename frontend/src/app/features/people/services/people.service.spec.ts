import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { PeopleService } from './people.service';
import { ExpenseDecryptionService } from '../../../core/services/expense-decryption.service';
import {
  PeopleOverviewResponse,
  PersonDetailResponse,
} from '@finmate/data-models';

describe('PeopleService', () => {
  let service: PeopleService;
  let httpMock: HttpTestingController;
  let decryptor: { decryptExpense: jest.Mock };

  beforeEach(() => {
    decryptor = {
      decryptExpense: jest.fn(async (e) => ({ ...e, title: 'Room Rent' })),
    };
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        PeopleService,
        { provide: ExpenseDecryptionService, useValue: decryptor },
      ],
    });
    service = TestBed.inject(PeopleService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('fetches the overview with a limit param', () => {
    const payload: PeopleOverviewResponse = {
      currency: 'INR',
      totalYouAreOwed: 720,
      totalYouOwe: 0,
      hasMultipleCurrencies: false,
      people: [],
    };
    service.getOverview(5).subscribe((res) => expect(res).toEqual(payload));
    const req = httpMock.expectOne('/api/v1/people?limit=5');
    expect(req.request.method).toBe('GET');
    req.flush(payload);
  });

  it('fetches the overview without a limit when omitted', () => {
    service.getOverview().subscribe();
    const req = httpMock.expectOne('/api/v1/people');
    expect(req.request.method).toBe('GET');
    req.flush({
      currency: 'INR',
      totalYouAreOwed: 0,
      totalYouOwe: 0,
      people: [],
    });
  });

  it('decrypts group-expense history titles via the shared decryptor', (done) => {
    const detail: PersonDetailResponse = {
      counterpartyUserId: 'u2',
      displayName: 'Naveen',
      email: 'n@x.com',
      currency: 'INR',
      netBalance: 500,
      direction: 'owes_you',
      breakdown: [],
      history: [
        {
          id: 'expense:e1',
          source: 'group_expense',
          amount: 500,
          currency: 'INR',
          date: '2026-08-08',
          groupId: 'g1',
          groupName: 'Goa Trip',
          expenseId: 'e1',
          title: 'cipher:text',
          encryptionScope: 'group',
          groupKeyVersionId: 'kv1',
        },
      ],
    };
    service.getPersonDetail('u2').subscribe((res) => {
      expect(decryptor.decryptExpense).toHaveBeenCalled();
      expect(res.history[0].title).toBe('Room Rent');
      done();
    });
    const req = httpMock.expectOne('/api/v1/people/u2');
    req.flush(detail);
  });

  it('POSTs a direct transaction', () => {
    service
      .createTransaction('u2', {
        entryType: 'lend',
        amount: 200,
        currency: 'INR',
        occurredOn: '2026-08-04',
      })
      .subscribe();
    const req = httpMock.expectOne('/api/v1/people/u2/transactions');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.entryType).toBe('lend');
    req.flush({});
  });

  it('POSTs a settlement', () => {
    service
      .createSettlement('u2', {
        amount: 100,
        currency: 'INR',
        occurredOn: '2026-08-10',
      })
      .subscribe();
    const req = httpMock.expectOne('/api/v1/people/u2/settlements');
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('DELETEs a direct transaction', () => {
    service.deleteTransaction('d1').subscribe();
    const req = httpMock.expectOne('/api/v1/people/transactions/d1');
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });
});
