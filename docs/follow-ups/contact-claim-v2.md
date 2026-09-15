# Contact claim hardening — V2 / follow-up backlog

Open items deferred from the "non-registered participants" gap-closure batch
(branch `feature/contact-claim-hardening`; Decision-Ledger addendum
CLAIM-1..4 / MERGE-1, 2026-09-16). Each item lists a short description and an
owner.

| Item | Description | Owner |
| ---- | ----------- | ----- |
| **Collision guard — real fix** | Today `claimContactsForUser` uses a **skip-and-flag** guard (CLAIM-4): if claiming a Contact would collide with an existing `(group,user)` membership it is skipped and left pending, so the same person can appear twice in a group. Replace with a real consolidation once the stranded-balance fix lands (the two share a mechanism). | Engineering |
| **`mergeContacts` stranded-balance fix + data repair** | `mergeContacts` close-out stranded balances on `removed` members; now blocked same-group via MERGE-1. Implement the real fix (transactional repoint **or** read-time redirect — see design comparison) and a one-off repair keyed off the detection SQL. Needs a governance decision (history immutability). See [mergecontacts-close-out-strands-balances.md](./mergecontacts-close-out-strands-balances.md). | Engineering (+ governance) |
| **Phone OTP + phone claiming** | Phone matching was removed from claiming (CLAIM-2) because no phone-verification flow exists. Add phone OTP, then re-enable phone-based claiming gated on a verified phone. | Engineering + Product |
| **Consent step ("Connect / Not me")** | Optional confirmation before a Contact's history binds to a newly-registered account: pending-claim state + confirm/reject endpoints; a review screen listing what would connect; on "Not me", leave the Contact pending and record a per-(user,contact) suppression so it is never auto-claimed again; notify the inviter. | Product + Engineering |
| **Name-only Contacts** | Relax `CHK_contacts_has_identifier` to allow Contacts with a display name but no email/phone, scoped to their creator/group. | Product + Engineering |
| **Manual merge UI** | Surface `computeMergeConfidence` candidates and the confirm flow (HIGH auto-eligible; MEDIUM requires confirm; same-group blocked by MERGE-1). | Frontend + Engineering |
| **Import for non-registered people** | Import currently references registered active members only (creates no Contacts). Optionally route import through `resolveOrCreateIdentity` to support non-registered payers/participants (overlaps P2P-3 scope). | Engineering + Product |
| **Contact-scoped per-invite tokens (system-emailed only)** | No per-invite token is tied to a Contact today; contact invitees get the generic, shareable group token. A single-use, system-emailed, contact-scoped token would let a verified-by-token invitee join before email verification (relaxing the Option-C `GROUP_JOIN_EMAIL_UNVERIFIED` gate for that one Contact). | Engineering |
| **Email-change must reset verification** | If an email-change feature is ever built, it MUST set `emailVerified = false` and require re-verification before the new email can be used for claiming. Reference **CLAIM-1**. (Today email is immutable — `UpdateProfileDto` has no `email` field — so no reset path exists; a guard test asserts an injected `email` payload cannot change `user.email`/`emailVerified`.) | Engineering |
| **Product question: `joinGroupByToken` does not check `invitedEmail`** | Anyone holding a group link can join regardless of the invited email. Confirm whether this is intended or should be tightened. | Product |
| **Frontend: `GROUP_JOIN_EMAIL_UNVERIFIED`** | Surface the 403 as "Verify your email and you'll be added to this group", with a **resend verification** button. Backend + error contract already shipped; the join flow auto-adds the user once they verify. | Frontend |

## Related decisions / docs

- Decision-Ledger addendum: **CLAIM-1** (verified-email-only claiming; token possession not proof), **CLAIM-2** (phone claiming removed), **CLAIM-3** (generic-link join gate — 403 `GROUP_JOIN_EMAIL_UNVERIFIED`), **CLAIM-4** (skip-and-flag collision guard), **MERGE-1** (same-group merge blocked).
- Tracked bug: [mergecontacts-close-out-strands-balances.md](./mergecontacts-close-out-strands-balances.md).
