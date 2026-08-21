import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { CustomTagService, CustomTagApiRow } from './custom-tag.service';
import { ClientEncryptionService } from './encryption.service';
import { CryptoSessionManager } from './crypto-session-manager.service';
import { environment } from '../../../environments/environment';

const masterKey = 'master-key' as unknown as CryptoKey;
const groupKey = 'group-key' as unknown as CryptoKey;

const row = (over: Partial<CustomTagApiRow> = {}): CustomTagApiRow => ({
  id: 'ct-1',
  scopeType: 'group',
  encryptedName: 'aXY=:Y2lwaGVy',
  status: 'active',
  version: 1,
  groupId: 'g-1',
  groupKeyVersionId: 'v-1',
  createdAt: '2026-08-22T00:00:00Z',
  updatedAt: '2026-08-22T00:00:00Z',
  ...over,
});

describe('CustomTagService (TAG-BATCH-C3)', () => {
  let service: CustomTagService;
  let httpMock: HttpTestingController;
  let encryption: { decrypt: jest.Mock };
  let session: { ensureGroupKey: jest.Mock; ensureCryptoContext: jest.Mock };
  const base = environment.apiBaseUrl;

  beforeEach(() => {
    encryption = { decrypt: jest.fn().mockResolvedValue('Groceries') };
    session = {
      ensureGroupKey: jest
        .fn()
        .mockResolvedValue({ status: 'ready', key: groupKey }),
      ensureCryptoContext: jest.fn().mockResolvedValue({ masterKey }),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        CustomTagService,
        { provide: ClientEncryptionService, useValue: encryption },
        { provide: CryptoSessionManager, useValue: session },
      ],
    });
    service = TestBed.inject(CustomTagService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('decrypts group custom-tag names client-side with the group key', async () => {
    const promise = service.getGroupCustomTags('g-1');
    const req = httpMock.expectOne(`${base}/groups/g-1/custom-tags`);
    expect(req.request.method).toBe('GET');
    // The name is NEVER sent to the backend — GET carries no plaintext body.
    expect(req.request.body).toBeNull();
    req.flush([row()]);

    const result = await promise;
    expect(session.ensureGroupKey).toHaveBeenCalledWith('g-1', 'read', 'v-1');
    expect(encryption.decrypt).toHaveBeenCalledWith('aXY=:Y2lwaGVy', groupKey);
    expect(result).toEqual([{ id: 'ct-1', scopeType: 'group', name: 'Groceries' }]);
  });

  it('leaves the name opaque (null) when decryption fails — no fabricated label', async () => {
    encryption.decrypt.mockRejectedValue(new Error('bad key'));
    const promise = service.getGroupCustomTags('g-1');
    httpMock.expectOne(`${base}/groups/g-1/custom-tags`).flush([row()]);
    const result = await promise;
    expect(result).toEqual([{ id: 'ct-1', scopeType: 'group', name: null }]);
  });

  it('leaves the name opaque when the group key is not available', async () => {
    session.ensureGroupKey.mockResolvedValue({ status: 'no_access' });
    const promise = service.getGroupCustomTags('g-1');
    httpMock.expectOne(`${base}/groups/g-1/custom-tags`).flush([row()]);
    const result = await promise;
    expect(result[0].name).toBeNull();
    expect(encryption.decrypt).not.toHaveBeenCalled();
  });

  it('caches a decrypted name in memory (no re-decrypt on a second load)', async () => {
    const p1 = service.getGroupCustomTags('g-1');
    httpMock.expectOne(`${base}/groups/g-1/custom-tags`).flush([row()]);
    await p1;
    const p2 = service.getGroupCustomTags('g-1');
    httpMock.expectOne(`${base}/groups/g-1/custom-tags`).flush([row()]);
    await p2;
    expect(encryption.decrypt).toHaveBeenCalledTimes(1);
  });

  it('resolves each distinct group-key version only once for a page of tags', async () => {
    const promise = service.getGroupCustomTags('g-1');
    httpMock.expectOne(`${base}/groups/g-1/custom-tags`).flush([
      row({ id: 'a', groupKeyVersionId: 'v-1' }),
      row({ id: 'b', groupKeyVersionId: 'v-1' }),
    ]);
    await promise;
    // Two tags, one shared version → one key resolution (no N+1).
    expect(session.ensureGroupKey).toHaveBeenCalledTimes(1);
  });

  it('decrypts personal custom-tag names with the master key', async () => {
    const promise = service.getPersonalCustomTags();
    const req = httpMock.expectOne(`${base}/custom-tags`);
    expect(req.request.method).toBe('GET');
    req.flush([row({ id: 'p-1', scopeType: 'personal', groupId: null, groupKeyVersionId: null })]);
    const result = await promise;
    expect(session.ensureCryptoContext).toHaveBeenCalled();
    expect(encryption.decrypt).toHaveBeenCalledWith('aXY=:Y2lwaGVy', masterKey);
    expect(result).toEqual([{ id: 'p-1', scopeType: 'personal', name: 'Groceries' }]);
  });

  it('returns [] and never throws on an HTTP error', async () => {
    const promise = service.getGroupCustomTags('g-1');
    httpMock
      .expectOne(`${base}/groups/g-1/custom-tags`)
      .flush('nope', { status: 500, statusText: 'Server Error' });
    await expect(promise).resolves.toEqual([]);
  });
});
