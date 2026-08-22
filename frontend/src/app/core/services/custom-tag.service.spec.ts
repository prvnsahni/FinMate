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

// Writes await the encryption key (a microtask) BEFORE issuing the request, so
// drain the microtask queue before asserting the outgoing HTTP call.
const drain = () => new Promise((r) => setTimeout(r, 0));

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
  let encryption: { decrypt: jest.Mock; encrypt: jest.Mock };
  let session: { ensureGroupKey: jest.Mock; ensureCryptoContext: jest.Mock };
  const base = environment.apiBaseUrl;

  beforeEach(() => {
    encryption = {
      decrypt: jest.fn().mockResolvedValue('Groceries'),
      encrypt: jest.fn().mockResolvedValue('IV=:CIPHER'),
    };
    session = {
      ensureGroupKey: jest
        .fn()
        .mockResolvedValue({ status: 'ready', key: groupKey, versionId: 'v-1' }),
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

  // ── TAG-BATCH-C5a — management (list-with-version + client-side writes) ──────

  it('creates a PERSONAL tag: encrypts the name client-side and sends only ciphertext', async () => {
    const promise = service.createPersonalTag('My Grocery');
    await drain();
    const req = httpMock.expectOne(`${base}/custom-tags`);
    expect(req.request.method).toBe('POST');
    // Encrypted with the master key BEFORE the request; the plaintext never leaves.
    expect(encryption.encrypt).toHaveBeenCalledWith('My Grocery', masterKey);
    expect(req.request.body).toEqual({ encryptedName: 'IV=:CIPHER' });
    expect(JSON.stringify(req.request.body)).not.toContain('My Grocery');
    req.flush({ id: 'p-1', scopeType: 'personal', encryptedName: 'IV=:CIPHER', status: 'active', version: 1, groupId: null, groupKeyVersionId: null });
    const tag = await promise;
    expect(tag).toMatchObject({ id: 'p-1', name: 'My Grocery', scopeType: 'personal', version: 1 });
  });

  it('creates a GROUP tag: encrypts with the group key and sends encryptedName + groupKeyVersionId', async () => {
    const promise = service.createGroupTag('g-1', 'Team Lunch');
    await drain();
    const req = httpMock.expectOne(`${base}/groups/g-1/custom-tags`);
    expect(session.ensureGroupKey).toHaveBeenCalledWith('g-1', 'write');
    expect(encryption.encrypt).toHaveBeenCalledWith('Team Lunch', groupKey);
    expect(req.request.body).toEqual({ encryptedName: 'IV=:CIPHER', groupKeyVersionId: 'v-1' });
    expect(JSON.stringify(req.request.body)).not.toContain('Team Lunch');
    req.flush({ id: 'g-1t', scopeType: 'group', encryptedName: 'IV=:CIPHER', status: 'active', version: 1, groupId: 'g-1', groupKeyVersionId: 'v-1' });
    await expect(promise).resolves.toMatchObject({ id: 'g-1t', name: 'Team Lunch', scopeType: 'group' });
  });

  it('renames a personal tag: encrypts the NEW name and sends the optimistic version', async () => {
    const tag = { id: 'p-1', name: 'Old', scopeType: 'personal' as const, status: 'active' as const, version: 3, groupId: null, groupKeyVersionId: null };
    const promise = service.renameTag(tag, 'New Name');
    await drain();
    const req = httpMock.expectOne(`${base}/custom-tags/p-1`);
    expect(req.request.method).toBe('PATCH');
    expect(encryption.encrypt).toHaveBeenCalledWith('New Name', masterKey);
    expect(req.request.body).toEqual({ encryptedName: 'IV=:CIPHER', version: 3 });
    req.flush({ id: 'p-1', scopeType: 'personal', encryptedName: 'IV=:CIPHER', status: 'active', version: 4, groupId: null, groupKeyVersionId: null });
    await expect(promise).resolves.toMatchObject({ version: 4, name: 'New Name' });
  });

  it('renames a group tag: re-stamps the current group key version', async () => {
    const tag = { id: 'g-1t', name: 'Old', scopeType: 'group' as const, status: 'active' as const, version: 2, groupId: 'g-1', groupKeyVersionId: 'v-0' };
    const promise = service.renameTag(tag, 'Renamed');
    await drain();
    const req = httpMock.expectOne(`${base}/custom-tags/g-1t`);
    expect(session.ensureGroupKey).toHaveBeenCalledWith('g-1', 'write');
    expect(req.request.body).toEqual({ encryptedName: 'IV=:CIPHER', version: 2, groupKeyVersionId: 'v-1' });
    req.flush({ id: 'g-1t', scopeType: 'group', encryptedName: 'IV=:CIPHER', status: 'active', version: 3, groupId: 'g-1', groupKeyVersionId: 'v-1' });
    await expect(promise).resolves.toMatchObject({ version: 3 });
  });

  it('surfaces a version conflict (412) from rename to the caller', async () => {
    const tag = { id: 'p-1', name: 'Old', scopeType: 'personal' as const, status: 'active' as const, version: 1, groupId: null, groupKeyVersionId: null };
    const promise = service.renameTag(tag, 'New');
    await drain();
    httpMock
      .expectOne(`${base}/custom-tags/p-1`)
      .flush({ errorCode: 'CON_VERSION_CONFLICT' }, { status: 412, statusText: 'Precondition Failed' });
    await expect(promise).rejects.toMatchObject({ status: 412 });
  });

  it('deprecate calls DELETE and sends no name material', async () => {
    const promise = service.deprecateTag('p-1');
    const req = httpMock.expectOne(`${base}/custom-tags/p-1`);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toBeNull();
    req.flush({});
    await expect(promise).resolves.toBeUndefined();
  });

  it('managed list carries version + status and falls back to null name on decrypt failure', async () => {
    encryption.decrypt.mockRejectedValue(new Error('bad key'));
    const promise = service.getManagedPersonalTags();
    httpMock
      .expectOne(`${base}/custom-tags`)
      .flush([{ id: 'p-1', scopeType: 'personal', encryptedName: 'IV=:CIPHER', status: 'active', version: 7, groupId: null, groupKeyVersionId: null }]);
    const list = await promise;
    expect(list[0]).toMatchObject({ id: 'p-1', name: null, version: 7, status: 'active' });
  });

  it('never writes decrypted/plaintext names to browser storage during writes', async () => {
    const setSpy = jest.spyOn(Storage.prototype, 'setItem');
    const promise = service.createPersonalTag('Secret Tag');
    await drain();
    httpMock
      .expectOne(`${base}/custom-tags`)
      .flush({ id: 'p-1', scopeType: 'personal', encryptedName: 'IV=:CIPHER', status: 'active', version: 1, groupId: null, groupKeyVersionId: null });
    await promise;
    for (const call of setSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('Secret Tag');
    }
    setSpy.mockRestore();
  });

  // ── TAG-BATCH-C5b — restore + status-filtered lists ─────────────────────────

  it('lists DEPRECATED personal tags via ?status=deprecated (active is the default)', async () => {
    const dep = service.getManagedPersonalTags('deprecated');
    httpMock.expectOne(`${base}/custom-tags?status=deprecated`).flush([]);
    await dep;
    const act = service.getManagedPersonalTags();
    httpMock.expectOne(`${base}/custom-tags`).flush([]); // no query for active
    await act;
  });

  it('lists DEPRECATED group tags via ?status=deprecated', async () => {
    const dep = service.getManagedGroupTags('g-1', 'deprecated');
    httpMock.expectOne(`${base}/groups/g-1/custom-tags?status=deprecated`).flush([]);
    await dep;
  });

  it('restore posts to /:id/restore with ONLY the optimistic version (no name material)', async () => {
    const tag = { id: 't-1', name: 'Keep Me', scopeType: 'personal' as const, status: 'deprecated' as const, version: 2, groupId: null, groupKeyVersionId: null };
    const promise = service.restoreTag(tag);
    const req = httpMock.expectOne(`${base}/custom-tags/t-1/restore`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ version: 2 });
    expect(encryption.encrypt).not.toHaveBeenCalled(); // no re-encryption on restore
    req.flush({ id: 't-1', scopeType: 'personal', encryptedName: 'IV=:CIPHER', status: 'active', version: 3, groupId: null, groupKeyVersionId: null });
    await expect(promise).resolves.toMatchObject({ status: 'active', version: 3, name: 'Keep Me' });
  });

  it('surfaces a version conflict (412) from restore to the caller', async () => {
    const tag = { id: 't-1', name: 'X', scopeType: 'personal' as const, status: 'deprecated' as const, version: 1, groupId: null, groupKeyVersionId: null };
    const promise = service.restoreTag(tag);
    httpMock
      .expectOne(`${base}/custom-tags/t-1/restore`)
      .flush({ errorCode: 'CON_VERSION_CONFLICT' }, { status: 412, statusText: 'Precondition Failed' });
    await expect(promise).rejects.toMatchObject({ status: 412 });
  });

  // ── TAG-C6-DISPLAY — getCustomTagNameMap (the one reusable resolver) ─────────

  it('GROUP scope: resolves names via the GROUP endpoint/key only (active + deprecated, no dup)', async () => {
    const promise = service.getCustomTagNameMap({ groupId: 'g-1' });
    // Exactly two fetches — active + deprecated — both to the GROUP endpoint.
    httpMock
      .expectOne(`${base}/groups/g-1/custom-tags`)
      .flush([row({ id: 'a', scopeType: 'group', groupId: 'g-1' })]);
    httpMock
      .expectOne(`${base}/groups/g-1/custom-tags?status=deprecated`)
      .flush([row({ id: 'd', scopeType: 'group', groupId: 'g-1' })]);
    // No personal endpoint touched (scope isolation); group key used for decrypt.
    httpMock.expectNone(`${base}/custom-tags`);
    const map = await promise;
    expect(session.ensureGroupKey).toHaveBeenCalledWith('g-1', 'read', 'v-1');
    expect(session.ensureCryptoContext).not.toHaveBeenCalled();
    expect(map.get('a')).toEqual({ name: 'Groceries', deprecated: false });
    expect(map.get('d')).toEqual({ name: 'Groceries', deprecated: true });
  });

  it('PERSONAL scope: resolves via the PERSONAL endpoint/master key only', async () => {
    const promise = service.getCustomTagNameMap({});
    httpMock
      .expectOne(`${base}/custom-tags`)
      .flush([row({ id: 'p', scopeType: 'personal', groupId: null, groupKeyVersionId: null })]);
    httpMock
      .expectOne(`${base}/custom-tags?status=deprecated`)
      .flush([]);
    httpMock.expectNone(`${base}/groups/g-1/custom-tags`);
    const map = await promise;
    expect(session.ensureCryptoContext).toHaveBeenCalled();
    expect(session.ensureGroupKey).not.toHaveBeenCalled();
    expect(map.get('p')).toEqual({ name: 'Groceries', deprecated: false });
  });

  it('is best-effort: a failed deprecated fetch still yields the active names', async () => {
    const promise = service.getCustomTagNameMap({ groupId: 'g-1' });
    httpMock
      .expectOne(`${base}/groups/g-1/custom-tags`)
      .flush([row({ id: 'a', scopeType: 'group', groupId: 'g-1' })]);
    httpMock
      .expectOne(`${base}/groups/g-1/custom-tags?status=deprecated`)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    const map = await promise;
    expect(map.get('a')).toEqual({ name: 'Groceries', deprecated: false });
    expect(map.size).toBe(1);
  });
});
