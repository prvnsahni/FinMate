import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { GoalsApiService } from './goals-api.service';
import { environment } from '../../../../environments/environment';

describe('GoalsApiService', () => {
  let svc: GoalsApiService;
  let http: HttpTestingController;
  const base = `${environment.apiBaseUrl}/goals`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        GoalsApiService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    svc = TestBed.inject(GoalsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list → GET /goals', () => {
    svc.list().subscribe();
    http.expectOne({ url: base, method: 'GET' }).flush([]);
  });

  it('create → POST /goals with ciphertext title (never plaintext)', () => {
    svc
      .create({
        title: 'IV:CIPHERTEXT',
        encryptedContentKey: 'WRAPPED',
        targetAmount: 1000,
        currency: 'USD',
      })
      .subscribe();
    const req = http.expectOne({ url: base, method: 'POST' });
    expect(req.request.body.title).toBe('IV:CIPHERTEXT');
    expect(JSON.stringify(req.request.body)).not.toContain('plaintext');
    req.flush({});
  });

  it('update → PATCH /goals/:id', () => {
    svc.update('g1', { version: 2, priority: 1 }).subscribe();
    http.expectOne({ url: `${base}/g1`, method: 'PATCH' }).flush({});
  });

  it('remove → DELETE /goals/:id', () => {
    svc.remove('g1').subscribe();
    http.expectOne({ url: `${base}/g1`, method: 'DELETE' }).flush(null);
  });

  it('projection → GET /goals/:id/projection with numeric assumed contribution only', () => {
    svc.projection('g1', 150).subscribe();
    const req = http.expectOne(
      (r) => r.url === `${base}/g1/projection` && r.method === 'GET',
    );
    expect(req.request.params.get('assumedMonthlyContribution')).toBe('150');
    req.flush({ status: 'ok', explanation: { disclaimers: [] } });
  });
});
