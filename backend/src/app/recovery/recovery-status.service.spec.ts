import { ConflictException } from '@nestjs/common';
import {
  RecoveryStatusService,
  REC_RECOVERY_REQUIRED,
} from './recovery-status.service';

describe('RecoveryStatusService (REC-1)', () => {
  let repo: { findOne: jest.Mock };
  let svc: RecoveryStatusService;

  beforeEach(() => {
    repo = { findOne: jest.fn() };
    svc = new RecoveryStatusService(repo as any);
  });

  describe('isConfigured', () => {
    it('is true only when recoveryWrappedKey is present', async () => {
      repo.findOne.mockResolvedValue({ id: 'u1', recoveryWrappedKey: 'blob' });
      expect(await svc.isConfigured('u1')).toBe(true);
    });

    it('is false when recoveryWrappedKey is null/absent or the user is missing', async () => {
      repo.findOne.mockResolvedValue({ id: 'u1', recoveryWrappedKey: null });
      expect(await svc.isConfigured('u1')).toBe(false);
      repo.findOne.mockResolvedValue(null);
      expect(await svc.isConfigured('u1')).toBe(false);
      expect(await svc.isConfigured('')).toBe(false);
    });

    it('only selects presence — never selects/returns the recovery blob broadly', async () => {
      repo.findOne.mockResolvedValue({ id: 'u1', recoveryWrappedKey: 'blob' });
      await svc.isConfigured('u1');
      const arg = repo.findOne.mock.calls[0][0];
      expect(arg.select).toEqual({ id: true, recoveryWrappedKey: true });
    });
  });

  describe('assertConfigured', () => {
    it('resolves when recovery is present', async () => {
      repo.findOne.mockResolvedValue({ id: 'u1', recoveryWrappedKey: 'blob' });
      await expect(svc.assertConfigured('u1')).resolves.toBeUndefined();
    });

    it('throws 409 REC_RECOVERY_REQUIRED when recovery is missing', async () => {
      repo.findOne.mockResolvedValue({ id: 'u1', recoveryWrappedKey: null });
      await expect(svc.assertConfigured('u1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      try {
        await svc.assertConfigured('u1');
      } catch (e) {
        const resp = (e as ConflictException).getResponse() as {
          errorCode: string;
          message: string;
        };
        expect(resp.errorCode).toBe(REC_RECOVERY_REQUIRED);
        // never leaks a recovery blob in the error
        expect(JSON.stringify(resp)).not.toContain('blob');
      }
    });
  });
});
