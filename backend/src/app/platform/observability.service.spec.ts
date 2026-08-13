import { Logger } from '@nestjs/common';
import { ObservabilityService } from './observability.service';

describe('ObservabilityService (W-PLAT-02)', () => {
  let svc: ObservabilityService;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    svc = new ObservabilityService();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('emits one structured JSON line with the event name and a timestamp', () => {
    svc.record('migration.p2p_note.backfill', { encrypted: 12, legacy: 3 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload.event).toBe('migration.p2p_note.backfill');
    expect(payload.encrypted).toBe(12);
    expect(payload.legacy).toBe(3);
    expect(typeof payload.timestamp).toBe('string');
  });

  it('SEC-W2/W7: strips sensitive keys (email, tokens, secrets) from metadata', () => {
    svc.record('auth.event', {
      userId: 'u1',
      email: 'user@example.com',
      refreshToken: 'secret-token',
      count: 1,
    });
    const line = logSpy.mock.calls[0][0] as string;
    const payload = JSON.parse(line);
    expect(payload.userId).toBe('u1');
    expect(payload.count).toBe(1);
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('refreshToken');
    expect(line).not.toContain('user@example.com');
    expect(line).not.toContain('secret-token');
  });

  it('honours the requested log level', () => {
    svc.record('rollback.triggered', { reason: 'parity_failure' }, 'warn');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('works with no metadata', () => {
    svc.record('boot.ok');
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload.event).toBe('boot.ok');
    expect(payload.timestamp).toBeDefined();
  });
});
