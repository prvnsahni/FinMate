/**
 * PUBLIC-1C — the ANONYMOUS public ledger projection. Allowlist-by-construction:
 * these are the ONLY shapes ever serialized to a public (unauthenticated) viewer.
 * They deliberately carry no id of any kind (group/user/member/expense), no E2EE
 * field (title/description/note/custom-tag name/attachment/ciphertext/key), and
 * no member PII (name/email/phone/username). Member identity is a per-group
 * pseudonym label only. Amounts/dates/categories/currency are already
 * server-readable Zone-2 metadata; the balance summary comes verbatim from the
 * authoritative `SettlementsService.calculateGroupBalances()`.
 */

/** One expense row: descriptive server-readable metadata only + a pseudonym payer. */
export interface PublicExpenseEntryDto {
  date: string;
  amount: number;
  currency: string;
  category: string;
  /** `expense` | `refund` — already server-readable, safe. */
  transactionType: 'expense' | 'refund';
  /** Pseudonym label (e.g. "Member 1"). NEVER a real name / id. */
  payerLabel: string;
}

/** One "who owes whom" line, both parties pseudonymized. */
export interface PublicBalanceSummaryDto {
  fromLabel: string;
  toLabel: string;
  amount: number;
  currency: string;
}

/** The whole public projection for a shared group. No ids, no PII, no E2EE. */
export interface PublicGroupLedgerDto {
  groupName: string;
  currency: string;
  entries: PublicExpenseEntryDto[];
  balanceSummary: PublicBalanceSummaryDto[];
  generatedAt: string;
}
