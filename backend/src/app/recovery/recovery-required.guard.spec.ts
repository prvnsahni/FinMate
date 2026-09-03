import { ConflictException } from '@nestjs/common';
import { RecoveryRequiredGuard } from './recovery-required.guard';

const ctxWithUser = (userId?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user: userId ? { id: userId } : undefined }),
    }),
  }) as any;

describe('RecoveryRequiredGuard (REC-1)', () => {
  let recovery: { assertConfigured: jest.Mock };
  let guard: RecoveryRequiredGuard;

  beforeEach(() => {
    recovery = { assertConfigured: jest.fn().mockResolvedValue(undefined) };
    guard = new RecoveryRequiredGuard(recovery as any);
  });

  it('allows the request when recovery is configured', async () => {
    await expect(guard.canActivate(ctxWithUser('u1'))).resolves.toBe(true);
    expect(recovery.assertConfigured).toHaveBeenCalledWith('u1');
  });

  it('re-reads authoritative state each request (server-authoritative, race-safe)', async () => {
    await guard.canActivate(ctxWithUser('u1'));
    await guard.canActivate(ctxWithUser('u1'));
    expect(recovery.assertConfigured).toHaveBeenCalledTimes(2);
  });

  it('blocks the request when recovery is missing (propagates 409)', async () => {
    recovery.assertConfigured.mockRejectedValue(
      new ConflictException({ errorCode: 'REC_RECOVERY_REQUIRED' }),
    );
    await expect(guard.canActivate(ctxWithUser('u1'))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
