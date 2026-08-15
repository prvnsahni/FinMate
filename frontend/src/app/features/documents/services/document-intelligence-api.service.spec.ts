import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DocumentIntelligenceApiService } from './document-intelligence-api.service';
import { environment } from '../../../../environments/environment';

describe('DocumentIntelligenceApiService', () => {
  let svc: DocumentIntelligenceApiService;
  let http: HttpTestingController;
  const base = `${environment.apiBaseUrl}/document-intelligence`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DocumentIntelligenceApiService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    svc = TestBed.inject(DocumentIntelligenceApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('process(TOTAL_ONLY) → POST with mode only (no bytes/keys)', () => {
    svc.process('att-1', 'TOTAL_ONLY').subscribe();
    const req = http.expectOne({
      url: `${base}/attachments/att-1/process`,
      method: 'POST',
    });
    expect(req.request.body).toEqual({ mode: 'TOTAL_ONLY' });
    expect(JSON.stringify(req.request.body)).not.toMatch(/key|encrypt|token/i);
    req.flush({ mode: 'TOTAL_ONLY', extractionAttempted: false });
  });

  it('process(ITEMIZED) → POST mode ITEMIZED', () => {
    svc.process('att-9', 'ITEMIZED').subscribe();
    const req = http.expectOne({
      url: `${base}/attachments/att-9/process`,
      method: 'POST',
    });
    expect(req.request.body).toEqual({ mode: 'ITEMIZED' });
    req.flush({ mode: 'ITEMIZED', extractionAttempted: true });
  });
});
