import { Injectable, inject } from '@angular/core';
import { Store } from '@ngxs/store';
import { AuthState } from '../../../core/auth/auth.state';
import { CustomTagService } from '../../../core/services/custom-tag.service';
import {
  CustomTagCorrectionMemoryService,
  SuggestionScope,
} from '../../../core/services/custom-tag-correction-memory.service';
import {
  AuthorizedCustomTag,
  CustomTagSuggestion,
  suggestCustomTags,
} from './custom-tag-suggestion';

/**
 * TAG-BATCH-C4 — orchestrates CLIENT-SIDE custom-tag suggestions for a review
 * surface. It wires together the authorized+decrypted custom tags (C3
 * `CustomTagService`, cached), the device-local correction memory, and the PURE
 * `suggestCustomTags` engine.
 *
 * Privacy/scope: it only ever loads tags the current user is authorized to see
 * (personal → their own; group → that group's), reusing the C3 crypto path — no
 * new crypto, no backend classification, no plaintext name ever sent to the API
 * or logged. Suggestions are advisory (INFERRED) and never auto-assigned.
 */
@Injectable({ providedIn: 'root' })
export class CustomTagSuggestionService {
  private readonly customTags = inject(CustomTagService);
  private readonly memory = inject(CustomTagCorrectionMemoryService);
  private readonly store = inject(Store);

  /** The current user's scope for suggestions (personal by default, or a group). */
  currentScope(groupId?: string): SuggestionScope | null {
    const user = this.store.selectSnapshot(AuthState.getUser);
    const userId = (user as { userId?: string } | null)?.userId;
    return userId ? { userId, groupId } : null;
  }

  /**
   * Load the authorized custom tags for a scope, names decrypted client-side and
   * cached (C3). Tags whose name cannot be decrypted are dropped (they cannot be
   * matched safely). Errors resolve to `[]` so the review surface degrades to
   * canonical-only. Group loads use only that group's tags (scope isolation).
   */
  async loadAuthorizedTags(scope: SuggestionScope): Promise<AuthorizedCustomTag[]> {
    if (scope.groupId) {
      const tags = await this.customTags.getGroupCustomTags(scope.groupId);
      return tags
        .filter((t) => !!t.name)
        .map((t) => ({
          id: t.id,
          name: t.name as string,
          scope: 'group' as const,
          groupId: scope.groupId,
        }));
    }
    const tags = await this.customTags.getPersonalCustomTags();
    return tags
      .filter((t) => !!t.name)
      .map((t) => ({ id: t.id, name: t.name as string, scope: 'personal' as const }));
  }

  /**
   * Deterministic client-side suggestions for a label, using the authorized tags
   * plus this device's correction memory for the scope. Pure delegation — no I/O.
   */
  suggest(
    label: string | null | undefined,
    authorizedTags: readonly AuthorizedCustomTag[],
    scope: SuggestionScope,
  ): CustomTagSuggestion[] {
    const remembered = this.memory.recall(scope, label ?? '');
    return suggestCustomTags(label, authorizedTags, remembered);
  }

  /** Remember a user's confirmed label→custom-tag association (device-local only). */
  recordCorrection(
    scope: SuggestionScope,
    label: string | null | undefined,
    customTagId: string,
  ): void {
    this.memory.record(scope, label, customTagId);
  }
}
