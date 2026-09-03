import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { PublicShareService } from './public-share.service';
import { environment } from '../../../environments/environment';

const base = environment.apiBaseUrl;
const G = 'group-1';
const TOKEN = 'kQ8mN3pR7sT1vW5xY9zA2bC4dE6fG0hJ_lMoPqRsTuV';

describe('PublicShareService (PUBLIC-1E)', () => {
  let service: PublicShareService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PublicShareService],
    });
    service = TestBed.inject(PublicShareService);
    httpMock = TestBed.inject(HttpTestingController);
  });
  afterEach(() => httpMock.verify());

  it('getStatus → GET the owner status endpoint (no token in the request)', () => {
    service.getStatus(G).subscribe();
    const req = httpMock.expectOne(`${base}/groups/${G}/public-share`);
    expect(req.request.method).toBe('GET');
    expect(JSON.stringify(req.request.body)).not.toContain(TOKEN);
    req.flush({
      active: false,
      status: null,
      expiresAt: null,
      createdAt: null,
      revokedAt: null,
    });
  });

  it('create → POST create endpoint (optional expiresAt only)', () => {
    service.create(G).subscribe();
    const req = httpMock.expectOne(`${base}/groups/${G}/public-share`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({
      token: TOKEN,
      status: 'active',
      expiresAt: null,
      createdAt: '2026-09-02',
      revokedAt: null,
    });
  });

  it('regenerate → POST regenerate endpoint', () => {
    service.regenerate(G).subscribe();
    const req = httpMock.expectOne(
      `${base}/groups/${G}/public-share/regenerate`,
    );
    expect(req.request.method).toBe('POST');
    req.flush({
      token: TOKEN,
      status: 'active',
      expiresAt: null,
      createdAt: '2026-09-02',
      revokedAt: null,
    });
  });

  it('revoke → DELETE the share endpoint', () => {
    service.revoke(G).subscribe();
    const req = httpMock.expectOne(`${base}/groups/${G}/public-share`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ revoked: true });
  });

  it('getPublicLedger → GET the ANONYMOUS projection with the token in the path', () => {
    service.getPublicLedger(TOKEN).subscribe();
    const req = httpMock.expectOne(`${base}/public/shares/${TOKEN}`);
    expect(req.request.method).toBe('GET');
    req.flush({
      groupName: 'Trip',
      currency: 'INR',
      entries: [],
      balanceSummary: [],
      generatedAt: 'x',
    });
  });

  it('buildShareUrl uses the app origin + /share/:token (in memory only, never persisted)', () => {
    const setSpy = jest.spyOn(Storage.prototype, 'setItem');
    const url = service.buildShareUrl(TOKEN);
    expect(url).toContain(`/share/${TOKEN}`);
    expect(url.startsWith(window.location.origin)).toBe(true);
    expect(setSpy).not.toHaveBeenCalled(); // no localStorage/sessionStorage write
    setSpy.mockRestore();
  });
});
