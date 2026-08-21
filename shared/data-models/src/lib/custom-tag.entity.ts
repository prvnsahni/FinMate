import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  VersionColumn,
  Index,
  Check,
} from 'typeorm';
import { User } from './user.entity';
import { Group } from './group.entity';
import { GroupKeyVersion } from './group-key-version.entity';

/**
 * TAG-BATCH-C1 — a user-defined custom tag DEFINITION (personal or group scope).
 *
 * This is the definition/naming layer only; assignments to expenses continue to
 * live in the single `expense_tags` join table (its `tagId` holds this row's
 * UUID for a custom assignment, `tagScope` distinguishes it from a canonical
 * one). The global canonical taxonomy stays CODE-curated — there is no taxonomy
 * DB table and users never write it here.
 *
 * E2EE (per TAG-BATCH-C0): the tag NAME is stored ONLY as client-produced
 * ciphertext in `encryptedName`, exactly like `note.title` / `expense.title`
 * (personal → master key; group → per-group AES key + `groupKeyVersion` for the
 * SEC-KI1 version discipline). The server NEVER decrypts it and there is NO
 * plaintext/normalized/hash/search companion — de-duplication is client-side.
 * The server only ever handles the opaque `id` + `scopeType` + ownership for
 * assignment, authorization, filtering and analytics. No new crypto primitive:
 * the existing client-side E2EE + key-wrapping architecture is reused at write
 * time (C1 adds no CRUD).
 *
 * Scope invariant (also enforced by a DB CHECK):
 *   personal → ownerUser set,  group null
 *   group    → group set,      ownerUser null   (creator kept in `createdByUser`)
 * FIN-002 is unaffected: nothing here feeds the ledger.
 */
@Entity('custom_tags')
@Index('idx_custom_tags_owner', ['ownerUser'])
@Index('idx_custom_tags_group', ['group'])
@Index('idx_custom_tags_scope_status', ['scopeType', 'status'])
@Check(
  'chk_custom_tags_scope',
  `("scopeType" = 'personal' AND "ownerUserId" IS NOT NULL AND "groupId" IS NULL) OR ("scopeType" = 'group' AND "groupId" IS NOT NULL AND "ownerUserId" IS NULL)`,
)
export class CustomTag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Which scope this definition belongs to. */
  @Column({ type: 'varchar', length: 20 })
  scopeType!: 'personal' | 'group';

  /** Personal-scope owner (NULL for group scope). Deleting the user removes their private tags. */
  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  ownerUser?: User;

  /** Group-scope owner (NULL for personal scope). Deleting the group removes its tags. */
  @ManyToOne(() => Group, { nullable: true, onDelete: 'CASCADE' })
  group?: Group;

  /** Creator provenance (both scopes). Kept even when `ownerUser` is null (group scope). */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  createdByUser?: User;

  /**
   * The key version the group-scoped `encryptedName` was produced under (SEC-KI1
   * version discipline, mirroring `expense.groupKeyVersion`). NULL for personal
   * scope (master-key encrypted).
   */
  @ManyToOne(() => GroupKeyVersion, { nullable: true, onDelete: 'SET NULL' })
  groupKeyVersion?: GroupKeyVersion;

  /**
   * Client-produced E2EE ciphertext of the tag name (`iv:ciphertext`, same format
   * as `expense.title`). The server stores it opaquely and NEVER decrypts it.
   */
  @Column({ type: 'text' })
  encryptedName!: string;

  /** Definition lifecycle. Only `active` tags are offered; history is preserved. */
  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: 'active' | 'deprecated';

  @VersionColumn()
  version!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt?: Date;
}
