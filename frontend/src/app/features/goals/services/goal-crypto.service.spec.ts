import { TestBed } from '@angular/core/testing';
import { webcrypto } from 'node:crypto';
import { GoalCryptoService } from './goal-crypto.service';
import { ClientEncryptionService } from '../../../core/services/encryption.service';
import { GroupKeyService } from '../../../core/services/group-key.service';

// Polyfill Web Cryptography API for the Jest/Node test env (matches encryption.service.spec).
if (typeof globalThis !== 'undefined' && !globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: true,
  });
} else if (
  typeof globalThis !== 'undefined' &&
  globalThis.crypto &&
  !globalThis.crypto.subtle
) {
  Object.defineProperty(globalThis.crypto, 'subtle', {
    value: webcrypto.subtle,
    writable: true,
  });
}

describe('GoalCryptoService (client born-E2EE)', () => {
  let svc: GoalCryptoService;
  let keys: { publicKey: CryptoKey; privateKey: CryptoKey };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        GoalCryptoService,
        ClientEncryptionService,
        {
          provide: GroupKeyService,
          useValue: { getMyAsymmetricKeys: async () => keys },
        },
      ],
    });
    // Generate a real RSA-OAEP wrapping pair via the service's own crypto resolver
    // (matches the FinMate wrapping-key usage; works in the jsdom test env).
    const enc = TestBed.inject(ClientEncryptionService);
    const pair = await enc.generateWrappingKeyPair();
    keys = { publicKey: pair.publicKey, privateKey: pair.privateKey };
    svc = TestBed.inject(GoalCryptoService);
  });

  it('encrypts the title client-side and never emits the plaintext', async () => {
    const { title, encryptedContentKey } =
      await svc.encryptTitle('My secret goal');
    expect(title).not.toContain('My secret goal');
    expect(title).toContain(':'); // iv:ct AES-GCM format
    expect(encryptedContentKey).not.toContain('My secret goal');
    expect(encryptedContentKey.length).toBeGreaterThan(0);
  });

  it('round-trips: the owner can decrypt what was encrypted', async () => {
    const { title, encryptedContentKey } =
      await svc.encryptTitle('Trip to Japan');
    const plain = await svc.decryptTitle(title, encryptedContentKey);
    expect(plain).toBe('Trip to Japan');
  });

  it('uses a different random content key per goal (different wrapped keys + ciphertext)', async () => {
    const a = await svc.encryptTitle('same text');
    const b = await svc.encryptTitle('same text');
    expect(a.encryptedContentKey).not.toBe(b.encryptedContentKey);
    expect(a.title).not.toBe(b.title); // random IV + random content key
  });

  it('ciphertext changes when the plaintext changes', async () => {
    const a = await svc.encryptTitle('one');
    const b = await svc.encryptTitle('two');
    expect(a.title).not.toBe(b.title);
  });

  it('fails safely on a missing wrapped key', async () => {
    await expect(svc.decryptTitle('iv:ct', null)).rejects.toThrow();
  });

  it('fails safely on malformed ciphertext / wrong key', async () => {
    const { encryptedContentKey } = await svc.encryptTitle('x');
    await expect(
      svc.decryptTitle('not-a-valid-ciphertext', encryptedContentKey),
    ).rejects.toThrow();
  });
});
