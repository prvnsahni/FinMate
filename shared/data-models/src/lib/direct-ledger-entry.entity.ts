import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  VersionColumn,
  ManyToOne,
  Index,
  Check,
} from 'typeorm';
import { User } from './user.entity';
import { Contact } from './contact.entity';

/**
 * A direct, group-less person-to-person obligation or settlement between two
 * participants. Each side is a registered `User` **or** a non-member `Contact`
 * (P2P-1): exactly one of `fromUser`/`fromContact` is set, and exactly one of
 * `toUser`/`toContact` is set. This mirrors the dual-identity model already used
 * by `ExpenseSplit` (`participantUser` XOR `participantGroupMember`) and
 * `ExpensePayment` — it does NOT introduce a new identity type or fake User.
 *
 * `createdByUser` is always the authenticated recorder — a Contact never records
 * an entry.
 *
 * Direction convention (mirrors the group balance engine): the entry always
 * records a movement from the `from` side (debtor) to the `to` side (creditor).
 *  - `lend`/`borrow`  — the same underlying obligation captured from opposite
 *                       viewpoints; both normalise so that the `to` side is owed
 *                       `amount` by the `from` side.
 *  - `settlement`     — a repayment ("Return") that *reduces* an outstanding
 *                       obligation; the `from` side pays the `to` side back.
 *
 * Balances are derived by netting these entries per counterparty per currency
 * alongside group-derived obligations — never stored as an aggregate. Entries
 * are immutable history: edits/voids soft-delete (they are never mutated into a
 * smaller amount) and are NEVER re-pointed on Contact claim/merge (resolution is
 * read-time — see PersonLedgerService), preserving the full audit trail.
 */
@Entity('direct_ledger_entries')
@Index(['fromUser'])
@Index(['toUser'])
@Index(['fromContact'])
@Index(['toContact'])
@Index(['occurredOn'])
// Exactly one identity per side (User XOR Contact).
@Check(
  '("fromUserId" IS NOT NULL AND "fromContactId" IS NULL) OR ("fromUserId" IS NULL AND "fromContactId" IS NOT NULL)',
)
@Check(
  '("toUserId" IS NOT NULL AND "toContactId" IS NULL) OR ("toUserId" IS NULL AND "toContactId" IS NOT NULL)',
)
// No same-kind self-reference (userA→userA / contactC→contactC); a User→Contact
// pair can never be the same entity, so those clauses only fire same-kind.
@Check(
  '("fromUserId" IS NULL OR "toUserId" IS NULL OR "fromUserId" <> "toUserId") AND ("fromContactId" IS NULL OR "toContactId" IS NULL OR "fromContactId" <> "toContactId")',
)
@Check('amount > 0')
export class DirectLedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Debtor side (the payer for a `settlement`) — set iff `fromContact` is null. */
  @ManyToOne(() => User, { nullable: true })
  fromUser?: User;

  /** Debtor side when the counterparty is a non-member Contact. */
  @ManyToOne(() => Contact, { nullable: true })
  fromContact?: Contact;

  /** Creditor side (the recipient for a `settlement`) — set iff `toContact` is null. */
  @ManyToOne(() => User, { nullable: true })
  toUser?: User;

  /** Creditor side when the counterparty is a non-member Contact. */
  @ManyToOne(() => Contact, { nullable: true })
  toContact?: Contact;

  /**
   * The user who recorded the entry — used for audit and to scope which side's
   * viewpoint created it. Always one of `fromUser`/`toUser`.
   */
  @ManyToOne(() => User, { nullable: false })
  createdByUser!: User;

  @Column({ type: 'varchar', length: 16 })
  entryType!: 'lend' | 'borrow' | 'settlement';

  @Column('decimal', { precision: 12, scale: 2 })
  amount!: number;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ type: 'text', nullable: true })
  note?: string;

  /** User-facing date the lend/borrow/return happened (YYYY-MM-DD). */
  @Column({ type: 'date' })
  occurredOn!: string;

  @VersionColumn()
  version!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt?: Date;
}
