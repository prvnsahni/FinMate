# Tracked bug — `mergeContacts` close-out strands balances

**Status:** OPEN (tracked / V2). **Severity:** correctness (financial). **Filed:** 2026-09-16.
**Mitigation shipped:** `a973eae` (Fix M.1) blocks the trigger — same-group merges are now
rejected with `409 CONTACT_MERGE_SAME_GROUP`, so **no new** stranding can occur. This bug covers
(a) the underlying design defect and (b) repair of any **pre-existing** stranded rows.

## Summary

Before Fix M.1, `ContactsService.mergeContacts` handled the case where the losing and surviving
Contacts both backed a `GroupMember` in the **same** group by setting the losing membership to
`joinStatus = 'removed'` **without** repointing its financial history. Those
`expense_splits` / `expense_payments` / `settlements` / `expenses.paid_by_group_member_id`
references remained on a `removed` row, which the balance engine surfaces under the **stale losing
identity** and which `proposeSettlement` refuses as a recipient — i.e. the balance is **mis-attributed
and unsettleable** (not deleted).

## Evidence (pre-Fix-M.1 behaviour)

1. **Close-out did not repoint financial rows.** `mergeContacts` only flipped `joinStatus` and
   repointed `group_invites`; no `expense_splits`/`expense_payments`/`settlements` repoint.
   (`backend/src/app/contacts/contacts.service.ts`, former close-out branch.)
2. **Balance engine excludes `removed` from members but still counts referenced removed rows.**
   `allMembers` loads `joinStatus IN ('active','invited')`
   (`backend/src/app/settlements/settlements.service.ts:250`), yet a `removed` member referenced by a
   split is re-registered via `splits.forEach(s => registerMember(s.participantGroupMember))`
   (`:431`), credited through the `|| 0` fallback (`:509-513`), and emitted into `finalBalances`
   (`:547-558`) and `suggestedSettlements` (`:564-578`). `resolveMemberId` returns the removed row's
   own id with **no redirect** to the survivor (`:442`).
3. **Display uses the stale identity.** The close-out left `member.contact = losing`; `memberDisplay`
   → `resolveMemberDisplay` returns the losing (archived) Contact's `displayName`
   (`backend/src/app/common/member-display.util.ts:29-36`).
4. **Unsettleable.** `proposeSettlement` requires the recipient to be `active`/`invited`
   (`backend/src/app/settlements/settlements.service.ts:621-637`); a `removed` member is rejected.

**Reachability:** a MEDIUM (same display-name) `confirmed:true` merge of two same-name pending
Contacts both present in one group with expenses. (HIGH same-identifier merges between two *pending*
Contacts are impossible — the partial unique indexes forbid duplicate pending email/phone.)

## 2b — Read-only detection query (DO NOT run against production here; owner will run)

Counts closed-out, Contact-backed `GroupMember` rows still referenced by financial history, grouped by
group. A non-empty result means pre-existing stranded balances that need repair.

```sql
-- READ-ONLY. Stranded balances from mergeContacts close-out.
WITH removed_contact_members AS (
  SELECT gm.id AS group_member_id, gm.group_id
  FROM group_members gm
  WHERE gm.join_status = 'removed'
    AND gm.contact_id IS NOT NULL
),
referenced AS (
  SELECT rcm.group_id, rcm.group_member_id
  FROM removed_contact_members rcm
  WHERE EXISTS (
          SELECT 1 FROM expense_splits es
          WHERE es.participant_group_member_id = rcm.group_member_id
            AND es.deleted_at IS NULL)
     OR EXISTS (
          SELECT 1 FROM expense_payments ep
          WHERE ep.paid_by_group_member_id = rcm.group_member_id
            AND ep.deleted_at IS NULL)
     OR EXISTS (
          SELECT 1 FROM expenses e
          WHERE e.paid_by_group_member_id = rcm.group_member_id
            AND e.deleted_at IS NULL)
     OR EXISTS (
          SELECT 1 FROM settlements s
          WHERE s.from_group_member_id = rcm.group_member_id
             OR s.to_group_member_id   = rcm.group_member_id)
)
SELECT g.id AS group_id,
       g.name AS group_name,
       COUNT(DISTINCT r.group_member_id) AS stranded_member_count
FROM referenced r
JOIN groups g ON g.id = r.group_id
GROUP BY g.id, g.name
ORDER BY stranded_member_count DESC;
```

Column names verified against migrations: `group_members.join_status`,
`expense_splits.participant_group_member_id`, `expense_payments.paid_by_group_member_id`,
`expenses.paid_by_group_member_id`, `settlements.from/to_group_member_id`. `settlements` has no
`deleted_at`; the other three tables do.

## 2c — Design comparison for the real fix (no implementation yet)

### Option (i) — Transactional repoint on merge

At merge time, repoint the losing member's `participant_group_member_id` /
`paid_by_group_member_id` / `settlements.from/to_group_member_id` / `expenses.paid_by_group_member_id`
to the **survivor's** existing member row, then remove/close the losing row.

- **History immutability / governance:** rewrites the member FK on historical financial rows →
  **conflicts with the history-immutability rule**; requires a **Decision-Ledger entry + ADR** to
  authorise identity-consolidation repoint (amounts unchanged, only the member key).
- **Same expense with splits for both identities:** if one expense has a split for *both* the losing
  and surviving member, repointing the loser's split to the survivor yields **two splits for the same
  member on one expense** → double-counts that member's owed share unless merged/summed. Needs an
  explicit merge-or-reject rule per expense.
- **Settlements between the two identities → self-settlements:** a settlement whose `from` is the loser
  and `to` is the survivor (or vice-versa) becomes **`from == to`** after repoint — a self-settlement
  that must be voided/collapsed, not left in place.
- **Unique constraints on splits/payments:** no DB unique on `(expense, participant_group_member)` or
  `(expense, paid_by_group_member)` today, so the DB will *not* stop the duplicate-split case — it must
  be handled in code.
- **Existing stranded data:** the same repoint logic, run as a one-off migration keyed off the 2b
  query, repairs historical rows.

### Option (ii) — Read-time redirect in the balance engine + `proposeSettlement`

Leave history untouched; resolve a `removed`/merged member to its survivor at read time (mirroring the
existing Contact merge-redirect used in `PersonLedgerService`).

- **History immutability / governance:** **no** history rewrite → consistent with the immutability
  rule; likely **no** Decision-Ledger change (read-time resolution only).
- **Same expense with splits for both identities:** both splits collapse onto the survivor key during
  aggregation → the engine must **sum** them (arithmetically fine) but the per-line breakdown will show
  a combined figure; acceptable.
- **Settlements between the two identities → self-settlements:** a loser↔survivor settlement collapses
  to `from == to` at read time and must be treated as a **no-op** in netting (drop it), or it distorts
  the balance.
- **Unique constraints:** irrelevant (no writes).
- **Existing stranded data:** **auto-repaired** for reads the moment the redirect ships — but
  `proposeSettlement` (and any other write keyed on `groupMemberId`) must **also** apply the redirect,
  or settling a collapsed balance still fails.
- **Cost:** touches every balance/settlement read path and `proposeSettlement`; broader surface, higher
  regression risk against FIN-002; must be covered by golden fixtures.

### Recommendation (for a future decision)

Option (ii) preserves immutability and repairs existing data for reads without a governance change, but
must be applied consistently across **all** read + settlement-write paths and needs the self-settlement
and split-collapse rules. Option (i) is conceptually simpler per-read but rewrites financial history
(governance gate) and needs explicit duplicate-split / self-settlement handling. **No option should be
implemented until this is decided.** Meanwhile Fix M.1 prevents any new occurrences.

## Related

- Mitigation: `a973eae` (Fix M.1 — same-group merge rejected).
- V2 sibling: `claimContactsForUser (group, user)` collision guard (same close-out family).
