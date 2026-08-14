import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { firstValueFrom, of, throwError } from 'rxjs';
import {
  recoveryRequiredInterceptor,
  RECOVERY_REQUIRED_EVENT,
} from './recovery-required.interceptor';

const run = (
  interceptor: HttpInterceptorFn,
  req: any,
  next: (r: any) => any,
) => (interceptor as any)(req, next);

describe('recoveryRequiredInterceptor (REC-1 defense-in-depth)', () => {
  const req = { url: '/api/v1/groups/g1/keys', method: 'POST' } as any;

  it('emits the recovery-required event on 409 REC_RECOVERY_REQUIRED and re-throws', async () => {
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener(RECOVERY_REQUIRED_EVENT, handler);

    const error = new HttpErrorResponse({
      status: 409,
      error: { errorCode: 'REC_RECOVERY_REQUIRED', message: 'x' },
    });
    const next = () => throwError(() => error);

    await expect(
      firstValueFrom(run(recoveryRequiredInterceptor, req, next)),
    ).rejects.toBe(error);

    expect(events.length).toBe(1);
    expect(events[0].detail).toEqual({ url: req.url, method: 'POST' });
    window.removeEventListener(RECOVERY_REQUIRED_EVENT, handler);
  });

  it('ignores other 409s and other statuses', async () => {
    const events: Event[] = [];
    const handler = (e: Event) => events.push(e);
    window.addEventListener(RECOVERY_REQUIRED_EVENT, handler);

    const conflict = new HttpErrorResponse({
      status: 409,
      error: { errorCode: 'RES_ALREADY_EXISTS' },
    });
    await expect(
      firstValueFrom(run(recoveryRequiredInterceptor, req, () => throwError(() => conflict))),
    ).rejects.toBe(conflict);

    const forbidden = new HttpErrorResponse({ status: 403, error: {} });
    await expect(
      firstValueFrom(run(recoveryRequiredInterceptor, req, () => throwError(() => forbidden))),
    ).rejects.toBe(forbidden);

    expect(events.length).toBe(0);
    window.removeEventListener(RECOVERY_REQUIRED_EVENT, handler);
  });

  it('passes successful responses through untouched', async () => {
    const res = await firstValueFrom(
      run(recoveryRequiredInterceptor, req, () => of({ ok: true })),
    );
    expect(res).toEqual({ ok: true });
  });
});
