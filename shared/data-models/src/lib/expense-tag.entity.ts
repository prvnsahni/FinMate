import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Expense } from './expense.entity';
import { User } from './user.entity';

/**
 * TAG-BATCH-A — a confirmed DOC-5 taxonomy tag persisted against an expense.
 *
 * This is a purely DESCRIPTIVE, server-readable Zone-2 metadata row — the same
 * classification as the existing plaintext `expenses.category`. It NEVER carries
 * or influences any financial value (amount/currency/payer/split/refund/
 * settlement/balance); FIN-002 is unaffected because nothing here feeds the
 * ledger. Tags originate ONLY from the minimized DOC-5 classification/review
 * flow or explicit user selection — never from server-side decryption of the
 * E2EE `title`/`description`.
 *
 * `tagId` references the shared, code-seeded `CANONICAL_TAXONOMY` (no taxonomy
 * table yet — DOC-5 keeps the taxonomy in code). Ancestors are materialized as
 * their own rows at write time (milk → dairy → grocery → food), so a later
 * filter can hit any level with a flat index lookup and no recursive query.
 *
 * Lifecycle: attached only at expense creation from a confirmed draft. Deleting
 * an expense (hard delete of a draft) cascades these rows via the DB FK
 * (`ON DELETE CASCADE`); a posted expense is soft-deleted, so its rows remain
 * with the (still-present) expense row and survive restore. Ordinary edits do
 * not touch these rows.
 */
@Entity('expense_tags')
// Query surface for the eventual (Batch B) filter/report: one row per
// (expense, tag); `tagId` alone indexed for "all expenses carrying tag X".
@Index('uq_expense_tags_expense_tag', ['expense', 'tagId'], { unique: true })
@Index('idx_expense_tags_tag', ['tagId'])
export class ExpenseTag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Owning expense. Hard delete cascades; soft delete keeps the row. */
  @ManyToOne(() => Expense, { nullable: false, onDelete: 'CASCADE' })
  expense!: Expense;

  /**
   * Stable tag id in the ONE unified namespace (TAG-BATCH-C0/C1): a canonical
   * slug (e.g. 'milk') when `tagScope = 'global'`, or a `custom_tags.id` UUID
   * when `tagScope` is 'personal'/'group'. NOT the display name. Resolved against
   * the code taxonomy (global) or the `custom_tags` table (custom) — there is no
   * second filter param and no second assignment table.
   */
  @Column({ type: 'varchar', length: 64 })
  tagId!: string;

  /**
   * TAG-BATCH-C1 — which definition source `tagId` points at. Defaults to
   * `global` so every existing (canonical) assignment stays valid with no
   * backfill and canonical filtering is unchanged. `personal`/`group` mark a
   * custom-tag assignment whose `tagId` is a `custom_tags.id`.
   */
  @Column({ type: 'varchar', length: 20, default: 'global' })
  tagScope!: 'global' | 'personal' | 'group';

  /**
   * DOC-5 authority. `INFERRED` = engine suggestion; `USER_CORRECTED` = the
   * user's own addition; `USER_CONFIRMED` = explicitly kept on confirm. A
   * `USER_CONFIRMED` assignment is never downgraded by a later `INFERRED` one.
   */
  @Column({ type: 'varchar', length: 20 })
  authority!: 'INFERRED' | 'USER_CORRECTED' | 'USER_CONFIRMED';

  /** Which classifier/actor produced it: rule_based | user | model | population. */
  @Column({ type: 'varchar', length: 20 })
  source!: 'rule_based' | 'user' | 'model' | 'population';

  /** Match certainty 0..1 — NOT financial correctness. Null for derived ancestors. */
  @Column({ type: 'decimal', precision: 4, scale: 3, nullable: true })
  confidence?: number | null;

  /** Canonical-taxonomy version that produced this assignment (auditable re-classification). */
  @Column({ type: 'int' })
  taxonomyVersion!: number;

  /** Who confirmed/created the assignment (provenance). Null if the user is removed. */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  createdByUser?: User;

  @CreateDateColumn()
  createdAt!: Date;
}
