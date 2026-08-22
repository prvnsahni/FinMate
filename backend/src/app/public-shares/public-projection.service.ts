import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import {
  Expense,
  GroupMember,
  PublicShare,
} from '@finmate/data-models';
import { FeatureFlagsService } from '../platform/feature-flags.service';
import { SettlementsService } from '../settlements/settlements.service';
import {
  PublicBalanceSummaryDto,
  PublicExpenseEntryDto,
  PublicGroupLedgerDto,
} from './dto';

/** Cap the anonymous entry list to bound the public payload. */
const MAX_PUBLIC_ENTRIES = 500;

/**
 * PUBLIC-1C — builds the ANONYMOUS, read-only public ledger projection for a
 * capability token. Everything here is allowlist-only and read-only:
 *  - the raw token is hashed (sha256) and matched to `PublicShare.tokenHash`;
 *  - every failure mode (flag off, unknown/revoked/expired token, deleted group,
 *    creator no longer an active member, any error) returns the SAME generic 404
 *    — a visitor can never tell which condition occurred or whether the token
 *    ever existed;
 *  - member identity is a per-group pseudonym label ("Member N"); NO real name /
 *    email / phone / username / id of any kind is exposed;
 *  - balances come VERBATIM from the authoritative
 *    `SettlementsService.calculateGroupBalances(creatorId, groupId)` — no second
 *    calculator, no finance mutation, no E2EE decryption.
 */
@Injectable()
export class PublicProjectionService {
  constructor(
    @InjectRepository(PublicShare)
    private readonly publicShareRepository: Repository<PublicShare>,
    @InjectRepository(GroupMember)
    private readonly groupMemberRepository: Repository<GroupMember>,
    @InjectRepository(Expense)
    private readonly expenseRepository: Repository<Expense>,
    private readonly settlementsService: SettlementsService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /** The single generic "unavailable" result — identical for every failure mode. */
  private unavailable(): never {
    throw new NotFoundException();
  }

  private isShareUsable(share: PublicShare): boolean {
    if (share.status !== 'active') return false;
    if (share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now()) {
      return false;
    }
    return true;
  }

  /**
   * Resolve the public ledger for a raw capability token, or throw a generic 404.
   * @param rawToken the token from the URL path (used only in-memory for lookup).
   */
  async getPublicLedger(rawToken: string): Promise<PublicGroupLedgerDto> {
    // Feature flag OFF → behave exactly as an unknown token (no data, generic 404).
    if (!this.flags.isEnabled('public.groupShare')) this.unavailable();
    if (!rawToken || typeof rawToken !== 'string') this.unavailable();

    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const share = await this.publicShareRepository.findOne({
      where: { tokenHash },
      relations: ['group', 'createdByUser'],
    });
    if (!share || !this.isShareUsable(share) || !share.group || !share.createdByUser) {
      this.unavailable();
    }
    const group = share!.group;
    const creatorId = share!.createdByUser!.id;

    // Authoritative balances ONLY. The creator must still be an active member —
    // if not (or the group vanished), the service throws and we return the same
    // generic 404 (never impersonate another member, never bypass the check).
    let overall: {
      balances: Array<{ groupMemberId: string; currency: string }>;
      suggestedSettlements: Array<{
        fromGroupMemberId: string;
        toGroupMemberId: string;
        amount: number;
        currency: string;
      }>;
    };
    try {
      const result = await this.settlementsService.calculateGroupBalances(
        creatorId,
        group.id,
      );
      overall = result.overall;
    } catch {
      this.unavailable();
    }

    const { labelByMemberId, memberIdByUserId } =
      await this.buildPseudonyms(group.id);

    const entries = await this.buildEntries(group.id, labelByMemberId, memberIdByUserId);

    const balanceSummary: PublicBalanceSummaryDto[] = overall!.suggestedSettlements.map(
      (s) => ({
        fromLabel: labelByMemberId.get(s.fromGroupMemberId) ?? 'Member',
        toLabel: labelByMemberId.get(s.toGroupMemberId) ?? 'Member',
        amount: s.amount,
        currency: s.currency,
      }),
    );

    return {
      groupName: group.name,
      currency: group.currency,
      entries,
      balanceSummary,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Deterministic per-group pseudonyms: order ALL of the group's members by
   * (joinedAt, id) — a hidden internal key, never exposed — and assign
   * "Member 1", "Member 2", … The same member always gets the same label across
   * requests. Also returns a userId→groupMemberId map for legacy payer rows.
   */
  private async buildPseudonyms(groupId: string): Promise<{
    labelByMemberId: Map<string, string>;
    memberIdByUserId: Map<string, string>;
  }> {
    const members = await this.groupMemberRepository.find({
      where: { group: { id: groupId } },
      relations: ['user'],
    });
    members.sort((a, b) => {
      const ta = a.joinedAt ? new Date(a.joinedAt).getTime() : Number.MAX_SAFE_INTEGER;
      const tb = b.joinedAt ? new Date(b.joinedAt).getTime() : Number.MAX_SAFE_INTEGER;
      return ta - tb || a.id.localeCompare(b.id);
    });
    const labelByMemberId = new Map<string, string>();
    const memberIdByUserId = new Map<string, string>();
    members.forEach((m, i) => {
      labelByMemberId.set(m.id, `Member ${i + 1}`);
      if (m.user) memberIdByUserId.set(m.user.id, m.id);
    });
    return { labelByMemberId, memberIdByUserId };
  }

  /**
   * The descriptive expense list (server-readable metadata only). This performs
   * NO balance math — it never reads title/description/notes/tags/attachments and
   * never decrypts anything. Payer is resolved to a pseudonym label.
   */
  private async buildEntries(
    groupId: string,
    labelByMemberId: Map<string, string>,
    memberIdByUserId: Map<string, string>,
  ): Promise<PublicExpenseEntryDto[]> {
    const expenses = await this.expenseRepository.find({
      where: { group: { id: groupId }, status: 'posted' },
      relations: ['paidByUser', 'paidByGroupMember'],
      order: { expenseDate: 'DESC', createdAt: 'DESC', id: 'DESC' },
      take: MAX_PUBLIC_ENTRIES,
    });

    return expenses.map((e) => {
      const payerMemberId =
        e.paidByGroupMember?.id ??
        (e.paidByUser ? memberIdByUserId.get(e.paidByUser.id) : undefined);
      const payerLabel =
        (payerMemberId && labelByMemberId.get(payerMemberId)) || 'Member';
      return {
        date: e.expenseDate,
        amount: Number(e.amountTotal),
        currency: e.currency,
        category: e.category,
        transactionType: e.transactionType ?? 'expense',
        payerLabel,
      };
    });
  }
}
