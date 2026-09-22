import { ConflictException, Injectable } from '@nestjs/common';
import { SettlementsService } from './settlements.service';

/** One outstanding (non-zero) balance line for a member. */
export interface MemberCurrencyBalance {
  currency: string;
  net: number;
}

/**
 * Single reusable place to read one group member's net balance per currency and
 * to enforce the "balance must be zero before any identity change" rule.
 *
 * A leaf service: it depends only on `SettlementsService` (which owns the group
 * balance engine) and is depended on by `GroupsService`/merge/claim paths — so
 * there is no dependency cycle. Balances are always **computed**, never stored;
 * this never mutates anything.
 */
@Injectable()
export class BalancesService {
  constructor(private readonly settlementsService: SettlementsService) {}

  /**
   * Net balance per currency for a single group member. Only **non-zero**
   * currencies are returned, so an empty map means the member is fully settled
   * across every currency.
   */
  async getGroupMemberNetByCurrency(
    groupId: string,
    memberId: string,
  ): Promise<Map<string, number>> {
    const balances = await this.settlementsService.getOverallBalances(groupId);
    const byCurrency = new Map<string, number>();
    for (const b of balances) {
      if (b.groupMemberId !== memberId) continue;
      const net = Math.round(b.netBalance * 100) / 100;
      if (net !== 0) byCurrency.set(b.currency, net);
    }
    return byCurrency;
  }

  /**
   * Throws `409 MEMBER_BALANCE_NONZERO` (with a per-currency breakdown) unless
   * the member's net balance is zero in every currency. Callers hold the
   * appropriate row lock and run this inside the same transaction as the
   * identity change so nothing can be added between the check and the mutation.
   */
  async assertZeroBalance(
    groupId: string,
    memberId: string,
    opts?: { displayName?: string },
  ): Promise<void> {
    const nonZero = await this.getGroupMemberNetByCurrency(groupId, memberId);
    if (nonZero.size === 0) return;

    const balances: MemberCurrencyBalance[] = [...nonZero.entries()].map(
      ([currency, net]) => ({ currency, net }),
    );
    throw new ConflictException({
      errorCode: 'MEMBER_BALANCE_NONZERO',
      message: `${
        opts?.displayName ?? 'This member'
      } still has an outstanding balance — settle up or edit expenses to bring it to zero before this change`,
      balances,
    });
  }
}
