import { Injectable } from '@angular/core';
import { normalizeTagKey } from '@finmate/data-models';

/**
 * TAG-BATCH-C4 — the scope a correction/suggestion belongs to. `groupId` set =
 * a group scope; absent = the user's personal scope.
 */
export interface SuggestionScope {
  userId: string;
  groupId?: string;
}

/**
 * TAG-BATCH-C4 — DEVICE-LOCAL, SESSION-ONLY custom-tag correction memory.
 *
 * When a user attaches a custom tag to a label ("Amul Taaza Milk" → their "My
 * Grocery"), that association is remembered so the SAME client can suggest it
 * next time. This is explicitly:
 *  - in-memory only (a plain Map) — nothing is written to localStorage /
 *    sessionStorage / IndexedDB / URL, so no decrypted custom-tag NAME is ever
 *    persisted (per C4 STEP 5; only opaque tag ids are held here anyway);
 *  - scope-isolated — keyed by `userId` + (personal | group:<id>) + normalized
 *    label, so one user's/group's corrections can never influence another's;
 *  - never sent to the backend, never logged — no server/population/ML learning.
 */
@Injectable({ providedIn: 'root' })
export class CustomTagCorrectionMemoryService {
  /** scopeKey+label → set of custom-tag ids the user chose for that label. */
  private readonly memory = new Map<string, Set<string>>();

  private key(scope: SuggestionScope, label: string): string {
    const scopeKey = scope.groupId ? `g:${scope.groupId}` : 'personal';
    return `${scope.userId}::${scopeKey}::${normalizeTagKey(label)}`;
  }

  /**
   * Remember that, on this device, the user attached `customTagId` to `label`
   * within `scope`. No-op for an empty/blank label. Stores only the opaque id.
   */
  record(scope: SuggestionScope, label: string | null | undefined, customTagId: string): void {
    if (!normalizeTagKey(label ?? '') || !customTagId) return;
    const k = this.key(scope, label ?? '');
    const set = this.memory.get(k) ?? new Set<string>();
    set.add(customTagId);
    this.memory.set(k, set);
  }

  /** Recall the custom-tag ids remembered for `label` in `scope` (device-local). */
  recall(scope: SuggestionScope, label: string | null | undefined): string[] {
    return [...(this.memory.get(this.key(scope, label ?? '')) ?? [])];
  }

  /** Drop all correction memory (e.g. on logout / account switch). */
  clear(): void {
    this.memory.clear();
  }
}
