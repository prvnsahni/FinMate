import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ClientEncryptionService } from './encryption.service';
import { CryptoSessionManager } from './crypto-session-manager.service';

/**
 * TAG-BATCH-C3 — the safe custom-tag metadata the C2 API returns. The name is
 * ONLY ever the opaque `encryptedName` ciphertext (`iv:ciphertext`); the server
 * never decrypts it, so neither does this DTO.
 */
export interface CustomTagApiRow {
  id: string;
  scopeType: 'personal' | 'group';
  encryptedName: string;
  status: 'active' | 'deprecated';
  version: number;
  groupId: string | null;
  groupKeyVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A custom tag resolved for the UI: the opaque id/scope plus the name decrypted
 * CLIENT-SIDE. `name` is `null` when the key is not (yet) available or the
 * payload cannot be decrypted — the surface then shows the opaque id and never a
 * fabricated label (per the E2EE boundary).
 */
export interface CustomTagView {
  id: string;
  scopeType: 'personal' | 'group';
  name: string | null;
}

/**
 * TAG-BATCH-C3 — client for the C2 custom-tag endpoints, plus CLIENT-SIDE name
 * decryption for the tag surfaces (selector/chips/analytics labels).
 *
 * Privacy boundary: the backend only ever sends the opaque `encryptedName`; the
 * plaintext name is produced HERE, in the browser, reusing the SAME crypto the
 * expense-title path uses (`CryptoSessionManager` for the personal master key /
 * per-group key + `ClientEncryptionService.decrypt`). No new crypto primitive.
 * Plaintext names are cached in memory only (never localStorage/sessionStorage)
 * and are never sent back to the API, put in a URL, or logged.
 */
@Injectable({ providedIn: 'root' })
export class CustomTagService {
  private readonly http = inject(HttpClient);
  private readonly encryption = inject(ClientEncryptionService);
  private readonly cryptoSession = inject(CryptoSessionManager);
  private readonly baseUrl = environment.apiBaseUrl;

  /** In-memory decrypted-name cache (id → name). Never persisted. */
  private readonly nameCache = new Map<string, string>();

  /** Best-effort decrypt of one payload; `null` (opaque) on any failure. */
  private async decryptName(
    id: string,
    encryptedName: string,
    key: CryptoKey,
  ): Promise<string | null> {
    const cached = this.nameCache.get(id);
    if (cached !== undefined) return cached;
    try {
      const name = await this.encryption.decrypt(encryptedName, key);
      this.nameCache.set(id, name);
      return name;
    } catch {
      // Fail-safe: leave the tag opaque rather than inventing a label.
      return null;
    }
  }

  /**
   * List the caller's active PERSONAL custom tags, names decrypted with the
   * personal master key. Errors (offline / no session) resolve to `[]` so the
   * caller's tag facet degrades gracefully.
   */
  async getPersonalCustomTags(): Promise<CustomTagView[]> {
    const rows = await firstValueFrom(
      this.http.get<CustomTagApiRow[]>(`${this.baseUrl}/custom-tags`),
    ).catch(() => [] as CustomTagApiRow[]);
    if (!rows.length) return [];

    let masterKey: CryptoKey | null = null;
    try {
      masterKey = (await this.cryptoSession.ensureCryptoContext()).masterKey;
    } catch {
      masterKey = null;
    }

    const out: CustomTagView[] = [];
    for (const row of rows) {
      out.push({
        id: row.id,
        scopeType: 'personal',
        name: masterKey
          ? await this.decryptName(row.id, row.encryptedName, masterKey)
          : null,
      });
    }
    return out;
  }

  /**
   * List a group's active custom tags, names decrypted with that group's key for
   * the version each tag was encrypted under (SEC-KI1 discipline, reused). Errors
   * resolve to `[]` so the group tag facet degrades gracefully.
   */
  async getGroupCustomTags(groupId: string): Promise<CustomTagView[]> {
    const rows = await firstValueFrom(
      this.http.get<CustomTagApiRow[]>(
        `${this.baseUrl}/groups/${groupId}/custom-tags`,
      ),
    ).catch(() => [] as CustomTagApiRow[]);
    if (!rows.length) return [];

    // Resolve each distinct key version once (most tags share the active one).
    const keyByVersion = new Map<string, CryptoKey | null>();
    const keyFor = async (versionId: string | null): Promise<CryptoKey | null> => {
      const cacheKey = versionId ?? 'active';
      if (keyByVersion.has(cacheKey)) return keyByVersion.get(cacheKey) ?? null;
      let key: CryptoKey | null = null;
      try {
        const res = await this.cryptoSession.ensureGroupKey(
          groupId,
          'read',
          versionId ?? undefined,
        );
        key = res.status === 'ready' ? res.key : null;
      } catch {
        key = null;
      }
      keyByVersion.set(cacheKey, key);
      return key;
    };

    const out: CustomTagView[] = [];
    for (const row of rows) {
      const key = await keyFor(row.groupKeyVersionId);
      out.push({
        id: row.id,
        scopeType: 'group',
        name: key
          ? await this.decryptName(row.id, row.encryptedName, key)
          : null,
      });
    }
    return out;
  }
}
