import { Logger, ExecutionContext, CallHandler } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import { createHash } from 'crypto';
import { LoggingInterceptor } from './logging.interceptor';

describe('LoggingInterceptor (SEC-W2)', () => {
  let interceptor: LoggingInterceptor;
  let logSpy: jest.SpyInstance;

  const buildContext = (
    req: Record<string, unknown>,
    res: Record<string, unknown>,
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    }) as unknown as ExecutionContext;

  const handler = (): CallHandler => ({ handle: () => of(null) });

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('redacts sensitive query values from the logged URL', async () => {
    const req = {
      method: 'GET',
      originalUrl: '/api/v1/auth/reset-password?token=supersecret123',
      headers: {},
      socket: { remoteAddress: '1.2.3.4' },
    };
    const res = { statusCode: 200 };

    await lastValueFrom(
      interceptor.intercept(buildContext(req, res), handler()),
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = logSpy.mock.calls[0][0] as string;
    expect(logged).not.toContain('supersecret123');
    expect(logged).toContain('[REDACTED]');
    expect(logged).toContain('/api/v1/auth/reset-password');
  });

  it('logs the IP as a hash, never the raw address', async () => {
    const req = {
      method: 'GET',
      originalUrl: '/api/v1/expenses',
      headers: {},
      socket: { remoteAddress: '9.9.9.9' },
    };
    const res = { statusCode: 200 };

    await lastValueFrom(
      interceptor.intercept(buildContext(req, res), handler()),
    );

    const logged = logSpy.mock.calls[0][0] as string;
    const expectedHash = createHash('sha256').update('9.9.9.9').digest('hex');
    expect(logged).not.toContain('9.9.9.9');
    expect(logged).toContain(expectedHash);
  });
});
