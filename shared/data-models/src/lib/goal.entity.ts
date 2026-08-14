import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  VersionColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('goals')
export class Goal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => User, { nullable: false })
  ownerUser!: User;

  /**
   * Born-E2EE (B-1): the goal title is stored as client ciphertext only — the
   * server never receives or stores plaintext. Widened varchar(160)→text to hold
   * AES-GCM ciphertext.
   */
  @Column({ type: 'text' })
  title!: string;

  /**
   * The per-goal random content key that encrypts `title`, wrapped under the
   * owner's RSA public wrapping key (recoverable via the RSA root / recovery —
   * REC-1). Server stores the wrapped blob only; it is never used server-side.
   * Nullable at the DB layer for migration safety; the create DTO requires it so
   * every goal is born-E2EE.
   */
  @Column({ name: 'encrypted_content_key', type: 'text', nullable: true })
  encryptedContentKey?: string;

  /** Deterministic priority ordering (lower = higher priority). No engagement mechanics. */
  @Column({ type: 'integer', default: 0 })
  priority!: number;

  @Column('decimal', { precision: 12, scale: 2 })
  targetAmount!: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0 })
  savedAmount!: number;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ type: 'date', nullable: true })
  targetDate?: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: 'active' | 'achieved' | 'paused' | 'cancelled';

  @VersionColumn()
  version!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
