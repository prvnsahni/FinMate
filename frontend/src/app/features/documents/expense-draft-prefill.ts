import type {
  ExpenseDraftPrefill,
  ExpensePrefillTag,
} from '../groups/components/create-expense-modal/create-expense-modal.component';
import { ConfirmedDocumentDraft } from './document-review.model';

/**
 * DOC-3E / TAG-BATCH-A — map a confirmed document/receipt draft to the
 * create-expense modal's additive `prefill` input. Pure and lossless-by-omission.
 *
 * It copies ONLY the non-finance-calculation header fields (title/amount/currency/
 * date) plus the confirmed DOC-5 taxonomy `tags` (advisory Zone-2 metadata). It
 * deliberately carries **no** payer, split, refund, settlement, category, or
 * per-item amount into finance — the modal has no such wiring and the user still
 * chooses payer/split and explicitly submits. Tags never mutate finance state.
 *
 * @param draft The explicitly user-confirmed document draft (from DOC-4 review).
 * @returns A create-mode pre-fill for the existing expense modal.
 */
export function mapDraftToExpensePrefill(
  draft: ConfirmedDocumentDraft,
): ExpenseDraftPrefill {
  const tags = collectConfirmedTags(draft);
  return {
    title: draft.title,
    amountTotal: draft.amount,
    currency: draft.currency,
    expenseDate: draft.date,
    ...(tags.length ? { tags } : {}),
  };
}

const TAG_AUTHORITY_RANK = {
  INFERRED: 1,
  USER_CORRECTED: 2,
  USER_CONFIRMED: 3,
} as const;
type PrefillTagAuthority = keyof typeof TAG_AUTHORITY_RANK;

/**
 * Flatten the confirmed line-item tags into a de-duplicated set for the expense.
 * Keeps only real tag authorities (INFERRED / USER_CORRECTED / USER_CONFIRMED)
 * and, on a duplicate tag id, the highest authority — so a user-confirmed tag is
 * never sent as a mere inferred one. The server independently re-validates,
 * materializes ancestors and de-dups, so this is a best-effort minimization.
 */
function collectConfirmedTags(
  draft: ConfirmedDocumentDraft,
): ExpensePrefillTag[] {
  const byTagId = new Map<string, ExpensePrefillTag>();
  for (const item of draft.items ?? []) {
    for (const tag of item.tags ?? []) {
      if (
        tag.authority !== 'INFERRED' &&
        tag.authority !== 'USER_CORRECTED' &&
        tag.authority !== 'USER_CONFIRMED'
      ) {
        continue;
      }
      const authority = tag.authority as PrefillTagAuthority;
      const existing = byTagId.get(tag.tagId);
      if (
        existing &&
        TAG_AUTHORITY_RANK[existing.authority] >= TAG_AUTHORITY_RANK[authority]
      ) {
        continue;
      }
      byTagId.set(tag.tagId, { tagId: tag.tagId, authority, source: tag.source });
    }
  }
  return [...byTagId.values()];
}
