import { CanonicalTag } from './canonical-taxonomy';
import { expandActiveWithAncestors } from './classify';

/**
 * TAG-BATCH-A — pure materializer that turns the confirmed tags of a document
 * draft (or explicit user selection) into the exact set of `expense_tag` rows to
 * persist. Deterministic, side-effect-free, and text-free: it operates ONLY on
 * stable canonical tag ids + DOC-5 authority — never on `title`/`description` or
 * any free text, so no plaintext ever reaches classification here.
 *
 * Rules (mirrors the DOC-5 taxonomy behaviour):
 *  - Each confirmed tag is expanded with its ACTIVE ancestors (milk → dairy →
 *    grocery → food), so the expense is queryable at every level.
 *  - Unknown or `deprecated` tag ids are dropped (never persisted).
 *  - Ancestors are recorded as derived `INFERRED`/`rule_based` (no confidence).
 *  - Duplicates are collapsed by tag id, keeping the HIGHEST authority — a
 *    `USER_CONFIRMED` (or `USER_CORRECTED`) assignment is never downgraded by a
 *    later `INFERRED` one, regardless of input order.
 */

export type ExpenseTagAuthority = 'INFERRED' | 'USER_CORRECTED' | 'USER_CONFIRMED';
export type ExpenseTagSource = 'rule_based' | 'user' | 'model' | 'population';

/** A single confirmed tag as supplied by the review flow / user selection. */
export interface ConfirmedTagInput {
  tagId: string;
  authority: ExpenseTagAuthority;
  source?: ExpenseTagSource;
  confidence?: number | null;
}

/** A resolved row ready to persist as an `ExpenseTag` (expense/createdBy added by the caller). */
export interface MaterializedExpenseTag {
  tagId: string;
  authority: ExpenseTagAuthority;
  source: ExpenseTagSource;
  confidence: number | null;
  taxonomyVersion: number;
}

const AUTHORITY_RANK: Record<ExpenseTagAuthority, number> = {
  INFERRED: 1,
  USER_CORRECTED: 2,
  USER_CONFIRMED: 3,
};

export function materializeConfirmedExpenseTags(
  inputs: readonly ConfirmedTagInput[] | undefined | null,
): MaterializedExpenseTag[] {
  const byTagId = new Map<string, MaterializedExpenseTag>();

  const upsert = (
    tag: CanonicalTag,
    authority: ExpenseTagAuthority,
    source: ExpenseTagSource,
    confidence: number | null,
  ): void => {
    const existing = byTagId.get(tag.id);
    if (existing && AUTHORITY_RANK[existing.authority] >= AUTHORITY_RANK[authority]) {
      return; // keep the higher/equal existing authority (never silently downgrade)
    }
    byTagId.set(tag.id, {
      tagId: tag.id,
      authority,
      source,
      confidence,
      taxonomyVersion: tag.version,
    });
  };

  for (const input of inputs ?? []) {
    const chain = expandActiveWithAncestors(input.tagId);
    if (chain.length === 0) continue; // unknown / deprecated → dropped

    const [self, ...ancestors] = chain;
    upsert(self, input.authority, input.source ?? 'rule_based', input.confidence ?? null);
    for (const ancestor of ancestors) {
      upsert(ancestor, 'INFERRED', 'rule_based', null);
    }
  }

  return [...byTagId.values()];
}
