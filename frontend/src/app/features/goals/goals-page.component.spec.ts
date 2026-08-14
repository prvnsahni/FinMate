import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { GoalsPageComponent } from './goals-page.component';
import { GoalsApiService } from './services/goals-api.service';
import { GoalCryptoService } from './services/goal-crypto.service';

describe('GoalsPageComponent', () => {
  let api: {
    list: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    projection: jest.Mock;
  };
  let crypto: { encryptTitle: jest.Mock; decryptTitle: jest.Mock };
  let comp: GoalsPageComponent;

  const build = () => {
    TestBed.configureTestingModule({
      imports: [GoalsPageComponent],
      providers: [
        { provide: GoalsApiService, useValue: api },
        { provide: GoalCryptoService, useValue: crypto },
      ],
    });
    comp = TestBed.createComponent(GoalsPageComponent).componentInstance;
  };

  beforeEach(() => {
    api = {
      list: jest.fn().mockReturnValue(of([])),
      create: jest.fn().mockReturnValue(of({ id: 'g1' })),
      update: jest.fn().mockReturnValue(of({ id: 'g1' })),
      remove: jest.fn().mockReturnValue(of(undefined)),
      projection: jest.fn().mockReturnValue(of({ status: 'ok' })),
    };
    crypto = {
      encryptTitle: jest
        .fn()
        .mockResolvedValue({ title: 'CIPHERTEXT', encryptedContentKey: 'WRAPPED' }),
      decryptTitle: jest.fn().mockResolvedValue('decrypted'),
    };
    build();
  });

  it('encrypts the title client-side and sends only ciphertext (never plaintext)', async () => {
    comp.form.setValue({
      title: 'Secret Goal',
      targetAmount: 1000,
      savedAmount: 0,
      currency: 'USD',
      targetDate: '',
      priority: 0,
    });
    await comp.submit();

    expect(crypto.encryptTitle).toHaveBeenCalledWith('Secret Goal');
    const body = api.create.mock.calls[0][0];
    expect(body.title).toBe('CIPHERTEXT');
    expect(body.encryptedContentKey).toBe('WRAPPED');
    expect(JSON.stringify(body)).not.toContain('Secret Goal'); // plaintext never sent
  });

  it('surfaces REC-1 when the server returns 409 REC_RECOVERY_REQUIRED', async () => {
    api.create.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { errorCode: 'REC_RECOVERY_REQUIRED' },
          }),
      ),
    );
    comp.form.patchValue({ title: 'x', targetAmount: 10 });
    await comp.submit();
    expect(comp.recoveryRequired()).toBe(true);
  });

  it('marks the feature unavailable on 404 (feature.goals OFF)', async () => {
    api.list.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404 })),
    );
    await comp.load();
    expect(comp.featureUnavailable()).toBe(true);
  });

  it('surfaces an optimistic-version conflict (412) message', async () => {
    api.create.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 412 })),
    );
    comp.form.patchValue({ title: 'x', targetAmount: 10 });
    await comp.submit();
    expect(comp.error()).toContain('changed elsewhere');
  });
});
