import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { Store } from '@ngxs/store';
import { ClientEncryptionService } from './encryption.service';
import { GroupKeyService } from './group-key.service';
import { ZkKeyVaultService } from './zk-key-vault.service';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('GroupKeyService', () => {
  let service: GroupKeyService;
  let httpMock: HttpTestingController;
  let encryptionService: jest.Mocked<ClientEncryptionService>;

  const masterKey = 'master-key' as unknown as CryptoKey;
  const groupKey = 'group-key' as unknown as CryptoKey;
  const publicKey = 'rsa-public-key' as unknown as CryptoKey;
  const privateKey = 'rsa-private-key' as unknown as CryptoKey;

  beforeEach(() => {
    const encryptionSpy = {
      loadKeyFromSession: jest.fn().mockResolvedValue(masterKey),
      unwrapKey: jest.fn().mockResolvedValue(groupKey),
      generateDataKey: jest.fn().mockResolvedValue(groupKey),
      wrapKey: jest.fn().mockResolvedValue('rsa-wrapped'),
    };

    const vaultSpy = {
      clearAll: jest.fn().mockResolvedValue(undefined),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        GroupKeyService,
        { provide: ClientEncryptionService, useValue: encryptionSpy },
        { provide: ZkKeyVaultService, useValue: vaultSpy },
        {
          provide: Store,
          useValue: {
            selectSnapshot: jest.fn().mockReturnValue({
              email: 'test@finmate.local',
              userId: 'user-1',
            }),
          },
        },
      ],
    });

    service = TestBed.inject(GroupKeyService);
    httpMock = TestBed.inject(HttpTestingController);
    encryptionService = TestBed.inject(
      ClientEncryptionService,
    ) as jest.Mocked<ClientEncryptionService>;
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('returns key and version id from an interceptor-unwrapped group key response', async () => {
    // Isolate this test from the fire-and-forget legacy-key migration that a
    // symmetric wrapped key would otherwise trigger.
    jest
      .spyOn(
        service as unknown as { migrateSelfKeyToAsymmetric: () => unknown },
        'migrateSelfKeyToAsymmetric',
      )
      .mockReturnValue(undefined);

    const promise = service.getGroupKeyForEncryption('group-1');
    await tick();

    const req = httpMock.expectOne('/api/v1/groups/group-1/keys/me');
    expect(req.request.method).toBe('GET');
    req.flush({
      wrappedKey: 'wrapped:key',
      groupKeyVersionId: '11111111-1111-4111-8111-111111111111',
      hasActiveKeys: true,
    });

    await expect(promise).resolves.toEqual({
      key: groupKey,
      versionId: '11111111-1111-4111-8111-111111111111',
    });
    // Legacy symmetric key is unwrapped as extractable so it can be re-wrapped.
    expect(encryptionService.unwrapKey).toHaveBeenCalledWith(
      'wrapped:key',
      masterKey,
      true,
    );
  });

  it('wraps the caller own group key under the RSA public key, not the master key', async () => {
    jest
      .spyOn(service, 'getMyAsymmetricKeys')
      .mockResolvedValue({ publicKey, privateKey });

    const promise = service.createGroupKey('group-1');
    await tick();

    const post = httpMock.expectOne(
      (r) => r.url === '/api/v1/groups/group-1/keys' && r.method === 'POST',
    );
    expect(post.request.body).toEqual({
      keys: [{ userId: 'user-1', wrappedKey: 'rsa-wrapped' }],
    });
    post.flush({});
    await tick();

    const versionReq = httpMock.expectOne('/api/v1/groups/group-1/keys/me');
    versionReq.flush({
      groupKeyVersionId: 'v1',
      wrappedKey: 'rsa-wrapped',
    });

    await expect(promise).resolves.toBe(groupKey);
    // The self copy is wrapped under the RSA public key so it survives a
    // password reset (the recovery flow restores the RSA private key).
    expect(encryptionService.wrapKey).toHaveBeenCalledWith(groupKey, publicKey);
  });

  it('migrates a legacy master-key-wrapped self key to RSA wrapping on fetch', async () => {
    jest
      .spyOn(service, 'getMyAsymmetricKeys')
      .mockResolvedValue({ publicKey, privateKey });
    encryptionService.wrapKey.mockResolvedValue('rsa-migrated');

    const promise = service.ensureGroupKey('group-1');
    await tick();

    httpMock.expectOne('/api/v1/groups/group-1/keys/me').flush({
      wrappedKey: 'legacy:symmetric',
      groupKeyVersionId: 'v1',
      hasActiveKeys: true,
    });
    await expect(promise).resolves.toBe(groupKey);

    // The migration is fire-and-forget; drain its re-wrap POST.
    await tick();
    const migratePost = httpMock.expectOne(
      (r) => r.url === '/api/v1/groups/group-1/keys' && r.method === 'POST',
    );
    expect(migratePost.request.body).toEqual({
      keys: [{ userId: 'user-1', wrappedKey: 'rsa-migrated' }],
    });
    migratePost.flush({});
    await tick();

    expect(encryptionService.unwrapKey).toHaveBeenCalledWith(
      'legacy:symmetric',
      masterKey,
      true,
    );
    expect(encryptionService.wrapKey).toHaveBeenCalledWith(groupKey, publicKey);
  });
});
