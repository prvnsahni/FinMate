import { EntityManager } from 'typeorm';

/**
 * Row-level locks that serialize balance-affecting writes against member
 * identity changes, so nothing can be added between a zero-balance check and
 * the change (and no removed member can gain a new split/settlement).
 *
 * A `FOR SHARE` reader (expense/settlement write) and a `FOR UPDATE` writer
 * (remove/leave/merge close-out) conflict on the same `group_members` row, so
 * they serialize; two `FOR SHARE` readers do not block each other.
 *
 * Raw SQL is used deliberately: applying a pessimistic lock through TypeORM's
 * `find` with `relations` would attach `FOR SHARE` to a LEFT JOIN, which
 * Postgres rejects ("FOR SHARE cannot be applied to the nullable side of an
 * outer join"). Locking `group_members` directly avoids that.
 */

/**
 * Takes a `FOR SHARE` lock on the group's active/invited member rows (a
 * superset of the rows a single write references — safe and simple). Held for
 * the enclosing transaction.
 */
export async function lockGroupMembersForShare(
  manager: EntityManager,
  groupId: string,
): Promise<void> {
  await manager.query(
    `SELECT id FROM group_members ` +
      `WHERE group_id = $1 AND join_status IN ('active','invited') FOR SHARE`,
    [groupId],
  );
}

/**
 * Takes a `FOR UPDATE` lock on one member row. Used by identity changes before
 * they recompute the balance and mutate, so a concurrent balance-affecting
 * write (holding `FOR SHARE` on the same row) serializes against it.
 */
export async function lockGroupMemberForUpdate(
  manager: EntityManager,
  memberId: string,
): Promise<void> {
  await manager.query(
    `SELECT id FROM group_members WHERE id = $1 FOR UPDATE`,
    [memberId],
  );
}
