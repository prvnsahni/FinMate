import { Injectable, inject } from '@angular/core';
import { ClientEncryptionService } from '../../../core/services/encryption.service';
import { GroupKeyService } from '../../../core/services/group-key.service';

/**
 * Client-side born-E2EE for goal titles (BATCH-11 FE). Reuses the EXISTING FinMate
 * crypto primitives — no new crypto system, no HKDF, no master-key-direct:
 *
 *  encrypt: random per-goal content key (generateDataKey) → AES-GCM encrypt title
 *           → wrap the content key under the user's RSA PUBLIC wrapping key
 *           (recoverable via the RSA root / recovery — REC-1). Never the master key.
 *  decrypt: RSA-unwrap the content key with the user's private wrapping key
 *           (from the crypto session) → AES-GCM decrypt the title locally.
 *
 * The plaintext title never leaves the client and is never logged.
 */
@Injectable({ providedIn: 'root' })
export class GoalCryptoService {
  private readonly encryption = inject(ClientEncryptionService);
  private readonly groupKeys = inject(GroupKeyService);

  /** Returns the ciphertext title + RSA-wrapped content key to send to the API. */
  async encryptTitle(
    plaintext: string,
  ): Promise<{ title: string; encryptedContentKey: string }> {
    const contentKey = await this.encryption.generateDataKey();
    const title = await this.encryption.encrypt(plaintext, contentKey);
    const { publicKey } = await this.groupKeys.getMyAsymmetricKeys();
    const encryptedContentKey = await this.encryption.wrapKey(
      contentKey,
      publicKey,
    );
    return { title, encryptedContentKey };
  }

  /** Decrypts a goal title locally. Throws (fails safe) on missing/invalid material. */
  async decryptTitle(
    ciphertext: string,
    encryptedContentKey: string | null | undefined,
  ): Promise<string> {
    if (!encryptedContentKey) {
      throw new Error('Goal is missing its wrapped content key');
    }
    const { privateKey } = await this.groupKeys.getMyAsymmetricKeys();
    const contentKey = await this.encryption.unwrapKey(
      encryptedContentKey,
      privateKey,
    );
    return this.encryption.decrypt(ciphertext, contentKey);
  }
}
