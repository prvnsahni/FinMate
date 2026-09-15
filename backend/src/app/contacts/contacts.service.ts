import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  AuditLog,
  Contact,
  GroupMember,
  GroupInvite,
  User,
} from '@finmate/data-models';
import { createHash } from 'crypto';
import { PaginatedResponse, paginate } from '../common/pagination.util';

export type MergeConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface IdentityResolution {
  type: 'user' | 'contact';
  user?: User;
  contact?: Contact;
}

export interface MergeCandidate {
  contactA: Contact;
  contactB: Contact;
  confidence: MergeConfidence;
  reason: string;
}

export interface ContactAddressBookEntry {
  contactId: string;
  displayName: string | null;
  email: string | null;
  phoneNumber: string | null;
  sharedGroups: Array<{ groupId: string; groupName: string }>;
}

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(GroupMember)
    private readonly groupMemberRepository: Repository<GroupMember>,
    @InjectRepository(GroupInvite)
    private readonly groupInviteRepository: Repository<GroupInvite>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /** Fire-and-forget — audit failures must never block a Contact lifecycle operation. */
  private async writeAuditLog(opts: {
    actorUser?: User;
    action: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.auditLogRepository.save(
        this.auditLogRepository.create({
          actorUser: opts.actorUser,
          action: opts.action,
          entityType: 'contact',
          entityId: opts.entityId,
          scope: 'personal',
          metadataJson: opts.metadata,
        }),
      );
    } catch {
      // Audit log failures should never block the primary operation
    }
  }

  normalizeEmail(email?: string | null): string | undefined {
    const trimmed = email?.trim().toLowerCase();
    return trimmed ? trimmed : undefined;
  }

  normalizePhone(phone?: string | null): string | undefined {
    const trimmed = phone?.replace(/[\s-]/g, '');
    return trimmed ? trimmed : undefined;
  }

  /**
   * Postgres transactional advisory lock keyed by a normalized identifier.
   * Serializes concurrent "does a Contact/User for this identifier already
   * exist" resolutions so two simultaneous (or retried) add-member requests
   * for the same not-yet-known email/phone can never both pass the
   * check-then-insert race and create duplicate Contacts (hardening item A).
   * Held only for the duration of the enclosing transaction — released
   * automatically on commit or rollback.
   */
  private async withIdentityLock<T>(
    manager: EntityManager,
    key: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const digest = createHash('sha256').update(key).digest();
    // pg_advisory_xact_lock takes a signed bigint; the first 8 bytes of a
    // SHA-256 digest, read as signed big-endian, are already exactly that.
    const lockId = digest.readBigInt64BE(0);
    await manager.query('SELECT pg_advisory_xact_lock($1)', [
      lockId.toString(),
    ]);
    return fn();
  }

  /**
   * Resolves the terminal (non-archived) Contact for a possibly-merged row,
   * following `mergedIntoContact` redirects to their end — never stopping
   * after one hop (hardening item D). Guards against a pathological cycle.
   */
  async resolveMergeRedirect(
    contact: Contact,
    manager?: EntityManager,
  ): Promise<Contact> {
    const repo = manager
      ? manager.getRepository(Contact)
      : this.contactRepository;
    let current = contact;
    const seen = new Set<string>([current.id]);
    while (current.status === 'archived' && current.mergedIntoContact) {
      const nextId =
        (current.mergedIntoContact as Contact).id ??
        (current.mergedIntoContact as unknown as { id: string }).id;
      if (seen.has(nextId)) break; // defensive: never loop on a cycle
      const next = await repo.findOne({
        where: { id: nextId },
        relations: ['mergedIntoContact'],
      });
      if (!next) break;
      current = next;
      seen.add(current.id);
    }
    return current;
  }

  /**
   * Resolve-or-create the identity behind an email/phone identifier for the
   * "add member" flow. Always checks for an existing registered User first —
   * the permanent backstop that prevents a Contact from ever shadowing a
   * real account (frozen §4/§9 edge case, hardening item C) — then reuses an
   * existing unclaimed Contact, and only creates a new one as a last resort.
   * Runs the Contact lookup-or-create under the identity lock so concurrent
   * callers converge on one row.
   *
   * Accepts an optional caller-supplied `manager` so this can participate in
   * an already-open transaction (e.g. group creation) instead of opening a
   * second, independently-committing one — a Contact created here must live
   * or die with the same transaction as the GroupMember it backs.
   */
  async resolveOrCreateIdentity(
    opts: {
      email?: string;
      phone?: string;
      displayName?: string;
      createdByUser: User;
    },
    manager?: EntityManager,
  ): Promise<IdentityResolution> {
    const email = this.normalizeEmail(opts.email);
    const phone = this.normalizePhone(opts.phone);
    if (!email && !phone) {
      throw new BadRequestException(
        'Provide an email or phone number to identify this person',
      );
    }

    const userRepo = manager
      ? manager.getRepository(User)
      : this.userRepository;

    // 1. Existing User is the permanent backstop — checked unconditionally,
    // every time, not only at registration.
    const existingUser = await userRepo.findOne({
      where: [
        ...(email ? [{ email }] : []),
        ...(phone ? [{ phoneNumber: phone }] : []),
      ],
    });
    if (existingUser) {
      return { type: 'user', user: existingUser };
    }

    // 2/3. A previously-known person may already exist as a CLAIMED or MERGED
    // (archived) Contact. Resolve those to their terminal identity so re-adding
    // the same email/phone never creates a duplicate pending Contact: a claimed
    // Contact folds to its `claimedByUser`; a merged Contact follows
    // `resolveMergeRedirect` to the surviving row (and, if that survivor is
    // itself claimed, on to its User).
    const resolvedKnown = await this.resolveKnownContactIdentity(
      email,
      phone,
      manager,
    );
    if (resolvedKnown) {
      return resolvedKnown;
    }

    // 4/5. Resolve-or-create the pending Contact atomically.
    const run = async (
      txManager: EntityManager,
    ): Promise<{ contact: Contact; wasCreated: boolean }> => {
      const lockKey = `contact:${email ?? ''}:${phone ?? ''}`;
      return this.withIdentityLock(txManager, lockKey, async () => {
        const repo = txManager.getRepository(Contact);
        const existing = await repo.findOne({
          where: [
            ...(email ? [{ email, status: 'pending' as const }] : []),
            ...(phone
              ? [{ phoneNumber: phone, status: 'pending' as const }]
              : []),
          ],
          order: { createdAt: 'ASC' },
        });
        if (existing) {
          return { contact: existing, wasCreated: false };
        }

        const created = repo.create({
          email,
          phoneNumber: phone,
          displayName: opts.displayName,
          status: 'pending',
          createdByUser: opts.createdByUser,
        });
        try {
          const saved = await repo.save(created);
          return { contact: saved, wasCreated: true };
        } catch (err: any) {
          // Defense-in-depth: the partial unique indexes are the final
          // backstop if the advisory lock was somehow bypassed. On a
          // uniqueness violation, re-fetch and return the winner instead of
          // surfacing a 500.
          if (err?.code === '23505') {
            const winner = await repo.findOne({
              where: [
                ...(email ? [{ email, status: 'pending' as const }] : []),
                ...(phone
                  ? [{ phoneNumber: phone, status: 'pending' as const }]
                  : []),
              ],
              order: { createdAt: 'ASC' },
            });
            if (winner) return { contact: winner, wasCreated: false };
          }
          throw err;
        }
      });
    };

    const { contact, wasCreated } = manager
      ? await run(manager)
      : await this.dataSource.transaction(run);

    // Best-effort, fire-and-forget — a Contact-scoped timeline event distinct
    // from `group.member_invited` (which is keyed to the GroupMember, not
    // the Contact, and stays unchanged).
    void this.writeAuditLog({
      actorUser: opts.createdByUser,
      action: wasCreated ? 'contact.created' : 'contact.linked',
      entityId: contact.id,
      metadata: { email: email ?? null, phone: phone ?? null },
    });

    return { type: 'contact', contact };
  }

  /**
   * Resolves an email/phone to an already-known person represented by a
   * non-pending Contact — a CLAIMED Contact (→ its `claimedByUser`) or a MERGED
   * (archived) Contact (→ `resolveMergeRedirect` to the survivor, then on to the
   * survivor's User if that survivor is itself claimed). Returns `null` when no
   * such Contact matches, so the caller falls through to the pending
   * resolve-or-create path. Read-only: never writes or repoints a row.
   *
   * The partial unique indexes only constrain PENDING rows, so several
   * claimed/archived rows may match one identifier; candidates are resolved in
   * creation order and the first that folds to a terminal (User or surviving
   * pending Contact) identity wins.
   */
  private async resolveKnownContactIdentity(
    email: string | undefined,
    phone: string | undefined,
    manager?: EntityManager,
  ): Promise<IdentityResolution | null> {
    const repo = manager
      ? manager.getRepository(Contact)
      : this.contactRepository;
    const idMatch = [
      ...(email ? [{ email }] : []),
      ...(phone ? [{ phoneNumber: phone }] : []),
    ];
    if (idMatch.length === 0) return null;

    // Claimed first, then archived (merged) — a directly-claimed row is a more
    // direct signal than a merge chain; both still fold to the same human.
    const candidates = await repo.find({
      where: idMatch.flatMap((m) => [
        { ...m, status: 'claimed' as const },
        { ...m, status: 'archived' as const },
      ]),
      relations: ['mergedIntoContact', 'claimedByUser'],
      // status DESC puts 'claimed' before 'archived' (c > a); createdAt breaks ties.
      order: { status: 'DESC', createdAt: 'ASC' },
    });

    for (const candidate of candidates) {
      const survivor =
        candidate.status === 'archived'
          ? await this.resolveMergeRedirect(candidate, manager)
          : candidate;
      // resolveMergeRedirect loads only `mergedIntoContact`; reload the terminal
      // row with its claim state so a merged→claimed chain folds to the User.
      const terminal =
        survivor.id === candidate.id
          ? candidate
          : ((await repo.findOne({
              where: { id: survivor.id },
              relations: ['claimedByUser'],
            })) ?? survivor);

      if (terminal.status === 'claimed' && terminal.claimedByUser) {
        return { type: 'user', user: terminal.claimedByUser };
      }
      if (terminal.status === 'pending') {
        return { type: 'contact', contact: terminal };
      }
      // Still archived (broken/cyclic chain) — skip and try the next candidate.
    }
    return null;
  }

  /**
   * Registration/verification-time claim: finds every unclaimed Contact
   * matching the now-verified email (or phone), links every GroupMember row
   * referencing it to the new User (keeping `contact` populated for audit),
   * activates the membership, and marks the Contact claimed — all inside one
   * transaction. Creates zero new Expense/ExpenseSplit/Settlement rows;
   * historical rows already reference the GroupMember and simply resolve
   * correctly the moment `GroupMember.user` is set.
   */
  async claimContactsForUser(
    user: User,
    opts: { email?: string; phone?: string } = {},
  ): Promise<{ linkedGroupIds: string[]; claimedContactIds: string[] }> {
    const email = this.normalizeEmail(opts.email ?? user.email);
    const phone = this.normalizePhone(opts.phone ?? user.phoneNumber);

    const result = await this.dataSource.transaction(async (manager) => {
      const contactRepo = manager.getRepository(Contact);
      const memberRepo = manager.getRepository(GroupMember);

      const matches = await contactRepo.find({
        where: [
          ...(email ? [{ email, status: 'pending' as const }] : []),
          ...(phone
            ? [{ phoneNumber: phone, status: 'pending' as const }]
            : []),
        ],
      });

      const linkedGroupIds = new Set<string>();
      const claimedContactIds: string[] = [];

      for (const contact of matches) {
        contact.status = 'claimed';
        contact.claimedByUser = user;
        contact.claimedAt = new Date();
        await contactRepo.save(contact);
        claimedContactIds.push(contact.id);

        const members = await memberRepo.find({
          where: { contact: { id: contact.id } },
          relations: ['group'],
        });
        for (const member of members) {
          member.user = user;
          member.joinStatus = 'active';
          await memberRepo.save(member);
          linkedGroupIds.add(member.group.id);
        }

        // Any durable invites issued to this Contact resolve to the new user too.
        await manager
          .getRepository(GroupInvite)
          .update({ contact: { id: contact.id } }, { inviteeUser: user });
      }

      return {
        linkedGroupIds: Array.from(linkedGroupIds),
        claimedContactIds,
      };
    });

    for (const contactId of result.claimedContactIds) {
      void this.writeAuditLog({
        actorUser: user,
        action: 'contact.claimed',
        entityId: contactId,
      });
    }

    return result;
  }

  /**
   * Scores how likely two Contact rows represent the same real-world person.
   * HIGH-confidence pairs share a hard identifier (email or phone); anything
   * weaker is a suggestion only, never an automatic merge target.
   */
  computeMergeConfidence(a: Contact, b: Contact): MergeCandidate {
    const emailA = this.normalizeEmail(a.email);
    const emailB = this.normalizeEmail(b.email);
    if (emailA && emailA === emailB) {
      return {
        contactA: a,
        contactB: b,
        confidence: 'HIGH',
        reason: 'Same email',
      };
    }
    const phoneA = this.normalizePhone(a.phoneNumber);
    const phoneB = this.normalizePhone(b.phoneNumber);
    if (phoneA && phoneA === phoneB) {
      return {
        contactA: a,
        contactB: b,
        confidence: 'HIGH',
        reason: 'Same phone',
      };
    }
    const nameA = a.displayName?.trim().toLowerCase();
    const nameB = b.displayName?.trim().toLowerCase();
    if (nameA && nameA === nameB) {
      return {
        contactA: a,
        contactB: b,
        confidence: 'MEDIUM',
        reason: 'Same display name',
      };
    }
    return {
      contactA: a,
      contactB: b,
      confidence: 'LOW',
      reason: 'No strong signal shared',
    };
  }

  /**
   * The caller's Contact address book: every still-pending (unregistered)
   * Contact they currently share at least one active group with, deduplicated
   * across groups. A Contact can back a `GroupMember` row in multiple
   * unrelated groups, so this aggregates by `Contact.id` rather than
   * returning one row per membership — mirrors the cross-group aggregation
   * pattern already used by `calculateFriendsBalances` for registered users.
   *
   * Claimed and archived Contacts are excluded: a claimed Contact is already
   * a registered co-member, visible via the group's member list and Friends;
   * an archived (merged) Contact has no active/invited membership left to
   * reference it, since `mergeContacts` repoints those in the same
   * transaction as the archive — no redirect-chasing is needed here.
   */
  async listAddressBook(userId: string): Promise<ContactAddressBookEntry[]> {
    const callerMemberships = await this.groupMemberRepository.find({
      where: { user: { id: userId }, joinStatus: 'active' },
      relations: ['group'],
    });
    const groupIds = callerMemberships.map((m) => m.group.id);
    if (groupIds.length === 0) {
      return [];
    }

    const members = await this.groupMemberRepository.find({
      where: {
        group: { id: In(groupIds) },
        joinStatus: In(['active', 'invited']),
      },
      relations: ['contact', 'group'],
    });

    const entries = new Map<string, ContactAddressBookEntry>();
    for (const member of members) {
      const contact = member.contact;
      if (!contact || contact.status !== 'pending') continue;

      let entry = entries.get(contact.id);
      if (!entry) {
        entry = {
          contactId: contact.id,
          displayName: contact.displayName ?? null,
          email: contact.email ?? null,
          phoneNumber: contact.phoneNumber ?? null,
          sharedGroups: [],
        };
        entries.set(contact.id, entry);
      }
      entry.sharedGroups.push({
        groupId: member.group.id,
        groupName: member.group.name,
      });
    }

    return Array.from(entries.values());
  }

  /** Suggested duplicate pairs among a group's currently-pending Contacts. */
  async findMergeCandidates(groupId: string): Promise<MergeCandidate[]> {
    const members = await this.groupMemberRepository.find({
      where: { group: { id: groupId } },
      relations: ['contact'],
    });
    const contacts = members
      .map((m) => m.contact)
      .filter((c): c is Contact => !!c && c.status === 'pending');

    const candidates: MergeCandidate[] = [];
    for (let i = 0; i < contacts.length; i++) {
      for (let j = i + 1; j < contacts.length; j++) {
        if (contacts[i].id === contacts[j].id) continue;
        const candidate = this.computeMergeConfidence(contacts[i], contacts[j]);
        if (candidate.confidence !== 'LOW') candidates.push(candidate);
      }
    }
    return candidates;
  }

  /**
   * Merges `losingContactId` into `survivingContactId`.
   *
   * Authorization (hardening item B): a merge is only allowed when the pair
   * meets the confidence rule (HIGH, or MEDIUM with the caller's explicit
   * `confirmed: true`) — an arbitrary pair with no shared signal cannot be
   * merged even by an owner/admin, closing the "combine two unrelated
   * people's financial identities" abuse path.
   *
   * Idempotency (hardening item E): merging an already-archived Contact is a
   * safe no-op that returns the current surviving Contact, resolved through
   * the full redirect chain (hardening item D) — never a single hop, and
   * never an error on retry.
   */
  async mergeContacts(opts: {
    survivingContactId: string;
    losingContactId: string;
    mergedByUser: User;
    confirmed?: boolean;
  }): Promise<Contact> {
    if (opts.survivingContactId === opts.losingContactId) {
      throw new BadRequestException('Cannot merge a Contact into itself');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const contactRepo = manager.getRepository(Contact);

      // Canonically-ordered advisory locks on both raw contact ids, so that
      // ANY two concurrent merge calls sharing either contact — in either
      // role, or with the pair reversed (merge(A,B) vs merge(B,A)) —
      // serialize against each other instead of racing on the
      // read-then-archive-then-repoint sequence below. Sorting first
      // guarantees identical acquisition order regardless of which side is
      // "surviving" vs "losing" in each call, which is what prevents a
      // deadlock between two such calls. Both locks are released together
      // on commit/rollback (pg_advisory_xact_lock is transaction-scoped).
      const [lockKeyA, lockKeyB] = [
        opts.survivingContactId,
        opts.losingContactId,
      ].sort();

      return this.withIdentityLock(manager, `contact-merge:${lockKeyA}`, () =>
        this.withIdentityLock(
          manager,
          `contact-merge:${lockKeyB}`,
          async () => {
            // All reads happen inside both locks so a caller that was
            // blocked here sees fully up-to-date (post-commit) state from
            // whichever merge ran first, not a stale pre-lock snapshot.
            const [survivingRaw, losingRaw] = await Promise.all([
              contactRepo.findOne({
                where: { id: opts.survivingContactId },
                relations: ['mergedIntoContact'],
              }),
              contactRepo.findOne({
                where: { id: opts.losingContactId },
                relations: ['mergedIntoContact'],
              }),
            ]);
            if (!survivingRaw || !losingRaw) {
              throw new NotFoundException('Contact not found');
            }

            // Idempotency: always resolve both sides to their terminal
            // Contact first. If that collapses the pair to the same row,
            // the merge this caller intended has already happened —
            // return it, don't error.
            const surviving = await this.resolveMergeRedirect(
              survivingRaw,
              manager,
            );
            const losing = await this.resolveMergeRedirect(losingRaw, manager);
            if (surviving.id === losing.id) {
              return { contact: surviving, merged: false as const };
            }

            // Authorization: the pair must satisfy the confidence rule.
            const candidate = this.computeMergeConfidence(surviving, losing);
            const authorized =
              candidate.confidence === 'HIGH' ||
              (candidate.confidence === 'MEDIUM' && opts.confirmed === true);
            if (!authorized) {
              throw new ForbiddenException({
                errorCode: 'CONTACT_MERGE_UNAUTHORIZED',
                message:
                  candidate.confidence === 'MEDIUM'
                    ? 'This pair only shares a weak signal (same name) — pass confirmed:true to merge anyway'
                    : 'These Contacts share no matching identifier and cannot be merged',
              });
            }

            // Archive the loser, never delete it — the timeline and every
            // historical reference stay readable (hardening item D/E +
            // Review 05).
            losing.status = 'archived';
            losing.mergedIntoContact = surviving;
            losing.mergedAt = new Date();
            losing.mergedByUser = opts.mergedByUser;
            await contactRepo.save(losing);

            // Re-point every GroupMember from the loser to the survivor —
            // except where the survivor is already a member of that same
            // group (both Contact rows were independently added to the
            // same group before anyone noticed they were the same
            // person). The GroupMember unique constraint on (group,
            // contact) forbids two rows for one Contact in one group, so
            // that specific losing membership is closed out instead of
            // repointed — its historical Expense/ExpenseSplit/Settlement
            // rows remain intact and still resolve via the surviving
            // membership.
            const memberRepo = manager.getRepository(GroupMember);
            const [losingMembers, survivorMembers] = await Promise.all([
              memberRepo.find({
                where: { contact: { id: losing.id } },
                relations: ['group'],
              }),
              memberRepo.find({
                where: { contact: { id: surviving.id } },
                relations: ['group'],
              }),
            ]);
            const survivorGroupIds = new Set(
              survivorMembers.map((m) => m.group.id),
            );
            for (const member of losingMembers) {
              if (survivorGroupIds.has(member.group.id)) {
                member.joinStatus = 'removed';
                await memberRepo.save(member);
              } else {
                member.contact = surviving;
                await memberRepo.save(member);
              }
            }

            await manager
              .getRepository(GroupInvite)
              .update({ contact: { id: losing.id } }, { contact: surviving });

            return {
              contact: surviving,
              merged: true as const,
              losingContactId: losing.id,
            };
          },
        ),
      );
    });

    if (result.merged) {
      // Archived, never deleted — the timeline stays fully reconstructible
      // for the surviving contact's aggregated history (see getTimeline).
      void this.writeAuditLog({
        actorUser: opts.mergedByUser,
        action: 'contact.merged',
        entityId: result.losingContactId,
        metadata: { survivingContactId: result.contact.id },
      });
    }

    return result.contact;
  }

  /**
   * Recursively collects every Contact ever merged into `survivorId`,
   * directly or transitively — the reverse of `resolveMergeRedirect`'s
   * forward chase. In normal operation a chain is only ever one hop deep
   * (`mergeContacts` always resolves both sides through the redirect chain
   * before archiving), but a two-hop chain is constructible if a contact is
   * merged again after already being a survivor, so this walks iteratively
   * rather than assuming a fixed depth.
   */
  private async collectMergeAncestorIds(survivorId: string): Promise<string[]> {
    const ancestorIds: string[] = [];
    const seen = new Set<string>([survivorId]);
    let frontier = [survivorId];

    while (frontier.length > 0) {
      const children = await this.contactRepository.find({
        where: { mergedIntoContact: { id: In(frontier) } },
      });
      const newIds = children.map((c) => c.id).filter((id) => !seen.has(id));
      newIds.forEach((id) => seen.add(id));
      ancestorIds.push(...newIds);
      frontier = newIds;
    }

    return ancestorIds;
  }

  /**
   * A Contact's timeline: every `entityType: 'contact'` AuditLog event for
   * it, aggregated across its full merge lineage. Calling this with an
   * archived (merged) Contact's id transparently resolves to — and returns
   * the same aggregated timeline as — its current surviving Contact, exactly
   * like `mergeContacts` treats a stale id as a safe redirect rather than an
   * error. Authorization mirrors `listAddressBook`: the caller must
   * currently share an active group with the surviving Contact or any
   * Contact ever merged into it.
   */
  async getTimeline(
    userId: string,
    contactId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    const contact = await this.contactRepository.findOne({
      where: { id: contactId },
      relations: ['mergedIntoContact'],
    });
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const survivor = await this.resolveMergeRedirect(contact);
    const ancestorIds = await this.collectMergeAncestorIds(survivor.id);
    const allContactIds = [survivor.id, ...ancestorIds];

    const callerMemberships = await this.groupMemberRepository.find({
      where: { user: { id: userId }, joinStatus: 'active' },
      relations: ['group'],
    });
    const callerGroupIds = callerMemberships.map((m) => m.group.id);
    if (callerGroupIds.length === 0) {
      throw new ForbiddenException('You do not have access to this contact');
    }

    const sharedMember = await this.groupMemberRepository.findOne({
      where: {
        group: { id: In(callerGroupIds) },
        contact: { id: In(allContactIds) },
      },
    });
    if (!sharedMember) {
      throw new ForbiddenException('You do not have access to this contact');
    }

    const p = page > 0 ? page : 1;
    const l = limit > 0 ? limit : 20;

    const [logs, total] = await this.auditLogRepository
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.actorUser', 'actorUser')
      .where('log.entityType = :entityType', { entityType: 'contact' })
      .andWhere('log.entityId IN (:...allContactIds)', { allContactIds })
      .orderBy('log.createdAt', 'DESC')
      .skip((p - 1) * l)
      .take(l)
      .getManyAndCount();

    const data = logs.map((log) => ({
      id: log.id,
      action: log.action,
      actorUserId: log.actorUser?.id ?? null,
      actorDisplayName: log.actorUser?.displayName ?? null,
      metadata: log.metadataJson ?? null,
      createdAt: log.createdAt,
    }));

    return paginate(
      data,
      total,
      p,
      l,
      `/api/v1/contacts/${survivor.id}/timeline`,
      {},
    );
  }
}
