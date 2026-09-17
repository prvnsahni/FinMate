# Zero-Balance Identity Change UX Follow-Ups

Owner: Frontend
Status: Follow-up required

## Scope

Frontend behavior to align with backend zero-balance and departed-member invariants:
- Member identity changes (remove, leave, merge) are blocked until net balance is zero.
- History is never rewritten.
- Departed members cannot be used in balance-affecting mutations unless re-added.

## Error Contract: MEMBER_BALANCE_NONZERO

When remove/leave/merge is blocked, backend returns `MEMBER_BALANCE_NONZERO`.

Expected payload fields:
- `errorCode`: `MEMBER_BALANCE_NONZERO`
- `memberId`: string
- `displayName`: string
- `reason`: one of:
  - `PENDING_SETTLEMENTS`
  - `ACTIVE_RECURRING`
  - `DRAFT_REFERENCES`
- `message`: user-friendly fallback text

UI requirements:
- Show `displayName` in the headline/body.
- Show reason-specific guidance:
  - `PENDING_SETTLEMENTS`: "Settle outstanding balances before removing this member."
  - `ACTIVE_RECURRING`: "Pause or edit recurring templates that reference this member."
  - `DRAFT_REFERENCES`: "Update or delete draft expenses/settlements that reference this member."
- Preserve backend `message` as fallback if reason is unknown.

## Error Contract: MEMBER_DEPARTED_BALANCE_LOCKED

When a departed member is referenced in a balance-affecting write (expense/settlement update/delete, etc.), backend returns `MEMBER_DEPARTED_BALANCE_LOCKED`.

Expected payload fields:
- `errorCode`: `MEMBER_DEPARTED_BALANCE_LOCKED`
- `memberId`: string
- `displayName`: string
- `message`: user-friendly text

UI requirements:
- Show message: "<displayName> has left this group. Add them back to the group to make this change."
- Primary action: `Re-add member`
- Secondary action: `Cancel`
- Re-add action should route to the group member management flow with `memberId` preselected when possible.

## Record-Payment Guidance (Contact-Backed Members)

For contact-backed members in record-payment flows:
- Always show payer/payee using resolved display names from API responses.
- Keep user/contact identity transparent in selectors (label, optional sublabel).
- Before submit, show overpayment warning if payment amount exceeds current owed amount for the pair/currency.
- Overpayment warning copy should state resulting direction flip risk (receiver may become debtor).

## Archive Warning

When archiving a group/member with unsettled balances:
- Show blocking warning if unsettled net is non-zero.
- Provide CTA to open balances/suggested-settlements view.
- Do not imply that archive/removal clears balances automatically.

## Recurring Template Pause Notice

When recurring processing auto-pauses an invalid template due to departed-member reference, surface:
- "Recurring template paused: departed member."

Display points:
- recurring template list row status badge
- recurring template details banner
- optional toast on first load after detection

## Read-Side Visibility Rule

Live balances and suggested settlements may hide members with `joinStatus` in (`left`, `removed`) only when their all-currency net is exactly zero.

Frontend implications:
- Do not assume departed members always appear in live balance lists.
- Keep historical views (expense detail/history/export) showing original participant names.
- Empty-state copy should avoid suggesting data loss; use wording like "No active unsettled balances."

## QA Checklist (Frontend)

- Remove/leave blocked with `MEMBER_BALANCE_NONZERO` and reason-specific guidance.
- Departed-member write blocked with `MEMBER_DEPARTED_BALANCE_LOCKED` and re-add action visible.
- Record-payment overpayment warning appears for contact-backed counterparties.
- Archive flow blocks or warns on unsettled balances.
- Recurring template pause notice appears in list/details.
- Historical screens still show departed member names.
