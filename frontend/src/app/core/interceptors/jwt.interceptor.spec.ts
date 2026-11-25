import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Store } from '@ngxs/store';
import { of, throwError } from 'rxjs';
import { jwtInterceptor } from './jwt.interceptor';
import { AuthState } from '../auth/auth.state';
import { TokenRefreshService } from '../auth/token-refresh.service';
import { isNativeAuthTransport } from '../platform/auth-transport';

jest.mock('../platform/auth-transport', () => ({
  isNativeAuthTransport: jest.fn(),
}));
const mockIsNative = isNativeAuthTransport as jest.Mock;

describe('jwtInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;
  let selectSnapshot: jest.Mock;
  let refresh: jest.Mock;

  function configure(token: string | null, native = false) {
    mockIsNative.mockReturnValue(native);
    selectSnapshot = jest.fn((selector: unknown) =>
      selector === AuthState.getToken ? token : null,
    );
    refresh = jest.fn(() => of('refreshed-access-token'));

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([jwtInterceptor])),
        provideHttpClientTesting(),
        { provide: Store, useValue: { selectSnapshot } },
        { provide: TokenRefreshService, useValue: { refresh } },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
  }

  afterEach(() => {
    httpTesting.verify();
  });

  describe('web (AU-6 cookie transport)', () => {
    it('reads the access token from in-memory AuthState, never localStorage', () => {
      const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
      const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');

      configure('access-token-123');
      http.get('/api/v1/expenses').subscribe();

      const req = httpTesting.expectOne('/api/v1/expenses');
      expect(req.request.headers.get('Authorization')).toBe(
        'Bearer access-token-123',
      );
      expect(getItemSpy).not.toHaveBeenCalledWith('finmate_token');
      req.flush({});

      setItemSpy.mockRestore();
      getItemSpy.mockRestore();
    });

    it('sends no Authorization header when there is no in-memory token', () => {
      configure(null);
      http.get('/api/v1/expenses').subscribe();

      const req = httpTesting.expectOne('/api/v1/expenses');
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
    });

    it('always sets withCredentials so HttpOnly auth cookies are attached', () => {
      configure('access-token-123');
      http.get('/api/v1/expenses').subscribe();

      const req = httpTesting.expectOne('/api/v1/expenses');
      expect(req.request.withCredentials).toBe(true);
      req.flush({});
    });

    it('sets withCredentials even when there is no token to attach (e.g. the login call itself)', () => {
      configure(null);
      http.post('/api/v1/auth/login', {}).subscribe();

      const req = httpTesting.expectOne('/api/v1/auth/login');
      expect(req.request.withCredentials).toBe(true);
      req.flush({});
    });

    it('on a 401 from a non-auth endpoint, refreshes once and retries with the new token, still withCredentials', (done) => {
      configure('expired-token');
      http.get('/api/v1/expenses').subscribe((res) => {
        expect(res).toEqual({ ok: true });
        done();
      });

      const first = httpTesting.expectOne('/api/v1/expenses');
      first.flush(
        { message: 'Unauthorized' },
        { status: 401, statusText: 'Unauthorized' },
      );

      expect(refresh).toHaveBeenCalled();

      const retried = httpTesting.expectOne('/api/v1/expenses');
      expect(retried.request.headers.get('Authorization')).toBe(
        'Bearer refreshed-access-token',
      );
      expect(retried.request.withCredentials).toBe(true);
      retried.flush({ ok: true });
    });
  });

  describe('native (interim pre-AU-6 body/localStorage transport — AU-7/ADR-013)', () => {
    it('attaches the Authorization header the same way as web', () => {
      configure('native-access-token', true);
      http.get('/api/v1/expenses').subscribe();

      const req = httpTesting.expectOne('/api/v1/expenses');
      expect(req.request.headers.get('Authorization')).toBe(
        'Bearer native-access-token',
      );
      req.flush({});
    });

    it('never sets withCredentials (no cookie to send; byte-for-byte the pre-AU-6 behavior)', () => {
      configure('native-access-token', true);
      http.get('/api/v1/expenses').subscribe();

      const req = httpTesting.expectOne('/api/v1/expenses');
      expect(req.request.withCredentials).toBe(false);
      req.flush({});
    });

    it('still does not set withCredentials on the retried request after a 401 refresh', (done) => {
      configure('expired-native-token', true);
      http.get('/api/v1/expenses').subscribe((res) => {
        expect(res).toEqual({ ok: true });
        done();
      });

      const first = httpTesting.expectOne('/api/v1/expenses');
      first.flush(
        { message: 'Unauthorized' },
        { status: 401, statusText: 'Unauthorized' },
      );

      const retried = httpTesting.expectOne('/api/v1/expenses');
      expect(retried.request.withCredentials).toBe(false);
      retried.flush({ ok: true });
    });
  });

  it('does not attempt a refresh on a 401 from the auth endpoints themselves (avoids an infinite loop)', (done) => {
    configure(null);
    http.post('/api/v1/auth/refresh', {}).subscribe({
      error: () => {
        expect(refresh).not.toHaveBeenCalled();
        done();
      },
    });

    const req = httpTesting.expectOne('/api/v1/auth/refresh');
    req.flush(
      { message: 'Unauthorized' },
      { status: 401, statusText: 'Unauthorized' },
    );
  });

  it('propagates the original error when refresh itself fails', (done) => {
    configure('expired-token');
    refresh.mockReturnValue(throwError(() => new Error('no session')));

    http.get('/api/v1/expenses').subscribe({
      error: (err) => {
        expect(err).toBeInstanceOf(Error);
        done();
      },
    });

    const req = httpTesting.expectOne('/api/v1/expenses');
    req.flush(
      { message: 'Unauthorized' },
      { status: 401, statusText: 'Unauthorized' },
    );
  });

  it('propagates non-401 errors without attempting a refresh', (done) => {
    configure('access-token-123');
    http.get('/api/v1/expenses').subscribe({
      error: () => {
        expect(refresh).not.toHaveBeenCalled();
        done();
      },
    });

    const req = httpTesting.expectOne('/api/v1/expenses');
    req.flush(
      { message: 'Server error' },
      { status: 500, statusText: 'Internal Server Error' },
    );
  });
});
