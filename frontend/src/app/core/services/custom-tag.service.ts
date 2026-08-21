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
 * TAG-BATCH-C5a — a custom tag for the MANAGEMENT surface: the same safe
 * metadata as the API row plus the CLIENT-decrypted `name` (null → show a
 * non-sensitive "Encrypted tag" fallback). `version` drives the C2 optimistic
 * lock on rename; the server still only ever holds the opaque `encryptedName`.
 */
export interface ManagedCustomTag {
  id: string;
  name: string | null;
  scopeType: 'personal' | 'group';
  status: 'active' | 'deprecated';
  version: number;
  groupId: string | null;
  groupKeyVersionId: string | null;
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

  // ─── TAG-BATCH-C5a — management (list-with-version + client-side writes) ─────

  /** Map an API row to a managed view, using an already-resolved decryption key. */
  private async toManaged(
    row: CustomTagApiRow,
    key: CryptoKey | null,
  ): Promise<ManagedCustomTag> {
    return {
      id: row.id,
      name: key ? await this.decryptName(row.id, row.encryptedName, key) : null,
      scopeType: row.scopeType,
      status: row.status,
      version: row.version,
      groupId: row.groupId,
      groupKeyVersionId: row.groupKeyVersionId,
    };
  }

  /**
   * Resolve the caller's personal master key for encrypting/decrypting personal
   * custom-tag names (reused expense-title crypto — no new primitive).
   */
  private async personalKey(): Promise<CryptoKey> {
    const key = (await this.cryptoSession.ensureCryptoContext()).masterKey;
    if (!key) throw new Error('CUSTOM_TAG_NO_KEY');
    return key;
  }

  /**
   * Resolve the group's CURRENT (active) key + version for encrypting a group
   * custom-tag name. Reuses the same write-path resolver as a group expense
   * title, so no new crypto/key discipline is introduced.
   */
  private async groupWriteKey(
    groupId: string,
  ): Promise<{ key: CryptoKey; versionId?: string }> {
    const res = await this.cryptoSession.ensureGroupKey(groupId, 'write');
    if (res.status !== 'ready') throw new Error('CUSTOM_TAG_NO_KEY');
    return { key: res.key, versionId: res.versionId };
  }

  /** List the caller's own ACTIVE personal custom tags for management (with version). */
  async getManagedPersonalTags(): Promise<ManagedCustomTag[]> {
    const rows = await firstValueFrom(
      this.http.get<CustomTagApiRow[]>(`${this.baseUrl}/custom-tags`),
    );
    if (!rows.length) return [];
    let key: CryptoKey | null = null;
    try {
      key = await this.personalKey();
    } catch {
      key = null;
    }
    const out: ManagedCustomTag[] = [];
    for (const row of rows) out.push(await this.toManaged(row, key));
    return out;
  }

  /** List a group's ACTIVE custom tags for management (member-only, with version). */
  async getManagedGroupTags(groupId: string): Promise<ManagedCustomTag[]> {
    const rows = await firstValueFrom(
      this.http.get<CustomTagApiRow[]>(
        `${this.baseUrl}/groups/${groupId}/custom-tags`,
      ),
    );
    if (!rows.length) return [];
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
    const out: ManagedCustomTag[] = [];
    for (const row of rows) {
      out.push(await this.toManaged(row, await keyFor(row.groupKeyVersionId)));
    }
    return out;
  }

  /**
   * Create a PERSONAL custom tag. The name is encrypted CLIENT-SIDE with the
   * master key before the request — the server only ever receives `encryptedName`.
   */
  async createPersonalTag(name: string): Promise<ManagedCustomTag> {
    const key = await this.personalKey();
    const encryptedName = await this.encryption.encrypt(name.trim(), key);
    const row = await firstValueFrom(
      this.http.post<CustomTagApiRow>(`${this.baseUrl}/custom-tags`, {
        encryptedName,
      }),
    );
    this.nameCache.set(row.id, name.trim());
    return this.toManaged(row, key);
  }

  /**
   * Create a GROUP custom tag (member-only, server-enforced). The name is
   * encrypted CLIENT-SIDE with the current group key; only `encryptedName` +
   * the resolved `groupKeyVersionId` leave the browser.
   */
  async createGroupTag(groupId: string, name: string): Promise<ManagedCustomTag> {
    const { key, versionId } = await this.groupWriteKey(groupId);
    const encryptedName = await this.encryption.encrypt(name.trim(), key);
    const row = await firstValueFrom(
      this.http.post<CustomTagApiRow>(
        `${this.baseUrl}/groups/${groupId}/custom-tags`,
        { encryptedName, groupKeyVersionId: versionId },
      ),
    );
    this.nameCache.set(row.id, name.trim());
    return this.toManaged(row, key);
  }

  /**
   * Rename a custom tag — the NEW name is encrypted CLIENT-SIDE (personal → master
   * key; group → current group key, re-stamping the version). `version` carries
   * the C2 optimistic lock; a stale value surfaces the server's
   * `CON_VERSION_CONFLICT` for the caller to handle.
   */
  async renameTag(tag: ManagedCustomTag, newName: string): Promise<ManagedCustomTag> {
    const trimmed = newName.trim();
    let encryptedName: string;
    let groupKeyVersionId: string | undefined;
    let key: CryptoKey;
    if (tag.scopeType === 'group' && tag.groupId) {
      const gk = await this.groupWriteKey(tag.groupId);
      key = gk.key;
      groupKeyVersionId = gk.versionId;
      encryptedName = await this.encryption.encrypt(trimmed, key);
    } else {
      key = await this.personalKey();
      encryptedName = await this.encryption.encrypt(trimmed, key);
    }
    const row = await firstValueFrom(
      this.http.patch<CustomTagApiRow>(`${this.baseUrl}/custom-tags/${tag.id}`, {
        encryptedName,
        version: tag.version,
        ...(groupKeyVersionId ? { groupKeyVersionId } : {}),
      }),
    );
    this.nameCache.set(row.id, trimmed);
    return this.toManaged(row, key);
  }

  /**
   * Deprecate a custom tag (safe, non-destructive — C2 keeps historical
   * `expense_tags` intact). No name material is sent.
   */
  async deprecateTag(id: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<CustomTagApiRow>(`${this.baseUrl}/custom-tags/${id}`),
    );
    this.nameCache.delete(id);
  }
}
