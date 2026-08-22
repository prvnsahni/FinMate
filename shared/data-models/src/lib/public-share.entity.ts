import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Group } from './group.entity';

/**
 * PUBLIC-1A — a group owner/admin's opt-in PUBLIC read-only share of ONE group.
 *
 * This row is the capability boundary for the (future) anonymous public ledger:
 * a non-member who presents the high-entropy share token gets a minimized,
 * allowlisted, read-only PROJECTION of the group's settlement summary. This
 * entity itself holds NO ledger/content data — only the token reference +
 * lifecycle. Public sharing is OFF by default (no row exists until an owner/admin
 * explicitly creates one).
 *
 * Security / privacy invariants (locked PUBLIC-1 decisions):
 *  - The raw share token is NEVER stored. Only its `tokenHash`
 *    (`sha256(token)` hex, 64 chars) is persisted, UNIQUE + indexed, so lookups
 *    are by hash and a DB read never yields a usable token.
 *  - There is NO name/email/phone/user-id/member-id/group-id, NO amount/balance,
 *    NO E2EE ciphertext, NO key/key-version, and NO expense/settlement data here.
 *    The public projection (a later batch) is built from server-readable fields
 *    + the authoritative `SettlementsService.calculateGroupBalances()` at read
 *    time; nothing financial is duplicated or cached on this row.
 *  - `createdByUser` is the owner/admin who enabled sharing (provenance + the
 *    member context used to run the authoritative balance calc). `ON DELETE SET
 *    NULL` — deleting the user only nulls provenance; it never deletes the share
 *    or the group.
 *  - Deleting the `group` CASCADEs this row away (the share cannot outlive its
 *    group). No other table is affected.
 *  - Lifecycle: `active → revoked` (revoke = immediate access loss). Regeneration
 *    replaces the `tokenHash` (one active token per share) — handled by the
 *    management service in a later batch. Optional `expiresAt` bounds access.
 *
 * FIN-002 is unaffected: nothing here reads or writes the ledger.
 */
@Entity('public_shares')
@Index('idx_public_shares_group', ['group'])
export class PublicShare {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The single group this share exposes. Deleting the group removes the share. */
  @ManyToOne(() => Group, { nullable: false, onDelete: 'CASCADE' })
  group!: Group;

  /**
   * The owner/admin who enabled sharing (provenance + the active-member context
   * used to run the authoritative balance calculation). Null if that user is
   * later deleted — the share and group are untouched.
   */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  createdByUser?: User;

  /**
   * `sha256(token)` as lowercase hex (64 chars). The raw capability token is
   * returned to the creator exactly once and NEVER stored; lookups match on this
   * hash. UNIQUE so a token maps to at most one share.
   */
  @Column({ type: 'varchar', length: 64, unique: true })
  tokenHash!: string;

  /** Share lifecycle. `revoked` (or expiry) means the public link no longer resolves. */
  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: 'active' | 'revoked';

  /** Optional hard expiry; when set and passed, the link stops resolving. */
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;

  @VersionColumn()
  version!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /** When the share was revoked (audit/provenance); null while active. */
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;
}
