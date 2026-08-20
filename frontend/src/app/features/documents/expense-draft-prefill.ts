import type { ExpenseDraftPrefill } from '../groups/components/create-expense-modal/create-expense-modal.component';
import { ConfirmedDocumentDraft } from './document-review.model';

/**
 * DOC-3E — map a confirmed document/receipt draft to the create-expense modal's additive
 * `prefill` input. Pure and lossless-by-omission: it copies ONLY the non-finance-calculation
 * header fields (title/amount/currency/date). It deliberately carries **no** payer, split,
 * refund, settlement, category, or per-item/tag data into finance — advisory tags stay on the
 * `ConfirmedDocumentDraft` as metadata; the modal has no tag field and the user still chooses
 * payer/split and explicitly submits. This function never mutates finance state.
 *
 * @param draft The explicitly user-confirmed document draft (from DOC-4 review).
 * @returns A create-mode pre-fill for the existing expense modal.
 */
export function mapDraftToExpensePrefill(draft: ConfirmedDocumentDraft): ExpenseDraftPrefill {
  return {
    title: draft.title,
    amountTotal: draft.amount,
    currency: draft.currency,
    expenseDate: draft.date,
  };
}
