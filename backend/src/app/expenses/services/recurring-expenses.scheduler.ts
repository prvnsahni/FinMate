import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThanOrEqual, Repository } from 'typeorm';
import {
  RecurringExpense,
  RecurringExpenseSplit,
  Expense,
  ExpenseSplit,
  GroupKeyVersion,
  GroupMember,
} from '@finmate/data-models';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class RecurringExpensesScheduler {
  private readonly logger = new Logger(RecurringExpensesScheduler.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(RecurringExpense)
    private readonly recurringExpenseRepository: Repository<RecurringExpense>,
    @InjectRepository(RecurringExpenseSplit)
    private readonly recurringExpenseSplitRepository: Repository<RecurringExpenseSplit>,
    private readonly redisService: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleRecurringExpensesCron() {
    this.logger.log({
      event: 'scheduler_started',
      scheduler: 'recurring_expenses',
      timestamp: new Date().toISOString(),
    });
    const lockKey = 'lock:recurring_expenses_cron';
    const acquired = await this.redisService.setNx(lockKey, 'locked', 3600);
    if (!acquired) {
      this.logger.log({
        event: 'redis_lock_failed',
        scheduler: 'recurring_expenses',
        lockKey,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    this.logger.log({
      event: 'redis_lock_acquired',
      scheduler: 'recurring_expenses',
      lockKey,
      timestamp: new Date().toISOString(),
    });
    try {
      await this.processDueExpenses();
      this.logger.log({
        event: 'scheduler_completed',
        scheduler: 'recurring_expenses',
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      this.logger.error(
        {
          event: 'scheduler_failed',
          scheduler: 'recurring_expenses',
          error: err.message,
          timestamp: new Date().toISOString(),
        },
        err.stack,
      );
    }
  }

  async processDueExpenses() {
    const todayStr = new Date().toISOString().slice(0, 10);

    const dueTemplates = await this.recurringExpenseRepository.find({
      where: {
        status: 'active',
        nextOccurrenceDate: LessThanOrEqual(todayStr),
      },
      relations: [
        'paidByUser',
        'paidByGroupMember',
        'ownerUser',
        'group',
        'groupKeyVersion',
      ],
    });

    this.logger.log({
      event: 'scheduler_processing_templates',
      scheduler: 'recurring_expenses',
      count: dueTemplates.length,
      timestamp: new Date().toISOString(),
    });

    for (const template of dueTemplates) {
      try {
        await this.generateDueOccurrences(template, todayStr);
      } catch (err: any) {
        this.logger.error(
          {
            event: 'scheduler_template_failed',
            scheduler: 'recurring_expenses',
            templateId: template.id,
            error: err.message,
            timestamp: new Date().toISOString(),
          },
          err.stack,
        );
      }
    }
  }

  /**
   * Materialize every occurrence of a template that is due on or before
   * `todayStr`, advancing `nextOccurrenceDate` and completing the template past
   * its end date. This is the single generation path — the daily cron calls it
   * for each due template, and `RecurringExpensesService.createRecurringExpense`
   * calls it once for a template whose first occurrence is already due (start
   * date today), so immediate and scheduled generation produce identical rows.
   */
  async generateDueOccurrences(template: RecurringExpense, todayStr: string) {
    // Never materialize expenses against an invalid target. A template whose
    // group has been archived, or whose group payer has left/been removed,
    // is skipped (not advanced, not failed) so it neither creates stale rows
    // nor blocks the rest of the cron sweep. It resumes automatically if the
    // condition clears (e.g. the group is un-archived).
    const skip = this.generationBlockedReason(template);
    if (skip) {
      this.logger.log({
        event: 'scheduler_template_skipped',
        scheduler: 'recurring_expenses',
        templateId: template.id,
        reason: skip,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Process all occurrences up to today (handles missed runs)
    let currentOccurrenceDate = template.nextOccurrenceDate;
    // Anchor month-end recurrence to the template's original day-of-month so
    // e.g. a "31st" schedule recovers to 31 in long months instead of sticking
    // at 28 after the first February clamp. startDate is NOT NULL, but stay
    // defensive so a malformed row can never crash the whole cron sweep.
    const anchorDay = template.startDate
      ? Number(template.startDate.split('-')[2])
      : undefined;

    while (currentOccurrenceDate <= todayStr && template.status === 'active') {
      const occurrenceDateStr = currentOccurrenceDate;
      const nextDate = this.advanceDate(
        occurrenceDateStr,
        template.frequency,
        anchorDay,
      );
      let pausedBecauseDepartedMember = false;

      await this.dataSource.transaction(async (manager) => {
        const blockedMemberIds = await this.findInvalidTemplateMemberIds(
          manager,
          template,
        );
        if (blockedMemberIds.length > 0) {
          template.status = 'paused';
          pausedBecauseDepartedMember = true;
          await manager.getRepository(RecurringExpense).save(template);
          this.logger.warn({
            event: 'scheduler_template_paused_departed_member',
            scheduler: 'recurring_expenses',
            templateId: template.id,
            groupId: template.group?.id ?? null,
            memberIds: blockedMemberIds,
            reason: 'departed_member_reference',
            timestamp: new Date().toISOString(),
          });
          return;
        }

        let groupKeyVersion: GroupKeyVersion | undefined;
        let encryptionScope: 'personal' | 'group' | 'direct_shared' =
          'personal';

        if (template.group) {
          encryptionScope = 'group';
          // The generated expense copies the TEMPLATE's ciphertext, so it must
          // carry the template's key version — stamping ACTIVE would break
          // decryption after a rotation (ciphertext/version mismatch).
          if (template.groupKeyVersion) {
            groupKeyVersion = template.groupKeyVersion;
          } else {
            const activeKeyVersion = await manager
              .getRepository(GroupKeyVersion)
              .findOne({
                where: { group: { id: template.group.id }, status: 'ACTIVE' },
                order: { version: 'DESC' },
              });
            if (activeKeyVersion) {
              groupKeyVersion = activeKeyVersion;
            } else {
              groupKeyVersion = await manager
                .getRepository(GroupKeyVersion)
                .save(
                  manager.getRepository(GroupKeyVersion).create({
                    group: template.group,
                    version: 1,
                    algorithm: 'AES-256-GCM',
                    status: 'ACTIVE',
                  }),
                );
            }
          }
        }

        // 1. Create standard Expense
        const expense = manager.getRepository(Expense).create({
          title: template.title,
          description: template.description,
          amountTotal: template.amountTotal,
          currency: template.currency,
          category: template.category,
          paidByUser: template.paidByUser,
          paidByGroupMember: template.paidByGroupMember,
          ownerUser: template.ownerUser,
          group: template.group,
          encryptionScope,
          groupKeyVersion,
          expenseDate: occurrenceDateStr,
          status: 'posted',
          ledgerMonth:
            template.group?.groupType === 'household'
              ? occurrenceDateStr.slice(0, 7)
              : undefined,
          isCarryForward: false,
        });
        const savedExpense = await manager.getRepository(Expense).save(expense);

        // 2. Load template splits
        const templateSplits = await manager
          .getRepository(RecurringExpenseSplit)
          .find({
            where: { recurringExpense: { id: template.id } },
            relations: ['participantUser', 'participantGroupMember'],
          });

        // 3. Create expense splits
        for (const tSplit of templateSplits) {
          const split = manager.getRepository(ExpenseSplit).create({
            expense: savedExpense,
            participantUser: tSplit.participantUser,
            participantGroupMember: tSplit.participantGroupMember,
            splitType: tSplit.splitType,
            shareValue: tSplit.shareValue,
            amountOwed: tSplit.amountOwed,
            isSettled: false,
          });
          await manager.getRepository(ExpenseSplit).save(split);
        }

        // 4. Update nextOccurrenceDate and status
        template.nextOccurrenceDate = nextDate;
        if (template.endDate && nextDate > template.endDate) {
          template.status = 'completed';
        }
        await manager.getRepository(RecurringExpense).save(template);
      });

      if (pausedBecauseDepartedMember) {
        break;
      }

      this.logger.log({
        event: 'scheduler_expense_created',
        scheduler: 'recurring_expenses',
        templateId: template.id,
        occurrenceDate: occurrenceDateStr,
        nextDate,
        timestamp: new Date().toISOString(),
      });
      currentOccurrenceDate = nextDate;
    }
  }

  /**
   * Reason a template must not generate right now, or `null` if it's clear.
   * Mirrors the app rule that archived groups can't receive new expenses, and
   * guards against a group payer that has left/been removed. Personal templates
   * (no group, no group payer) are always generable.
   */
  private generationBlockedReason(template: RecurringExpense): string | null {
    if (template.group?.isArchived) {
      return 'group_archived';
    }
    const payer = template.paidByGroupMember;
    if (
      payer &&
      (payer.joinStatus === 'removed' || payer.joinStatus === 'left')
    ) {
      return 'group_payer_removed';
    }
    return null;
  }

  private async findInvalidTemplateMemberIds(
    manager: {
      getRepository: <T>(entity: new () => T) => Repository<T>;
    },
    template: RecurringExpense,
  ): Promise<string[]> {
    if (!template.group?.id) return [];

    const referencedMemberIds = new Set<string>();
    if (template.paidByGroupMember?.id) {
      referencedMemberIds.add(template.paidByGroupMember.id);
    }

    const templateSplits = await manager
      .getRepository(RecurringExpenseSplit)
      .find({
        where: { recurringExpense: { id: template.id } },
        relations: ['participantGroupMember'],
      });
    for (const split of templateSplits) {
      if (split.participantGroupMember?.id) {
        referencedMemberIds.add(split.participantGroupMember.id);
      }
    }

    if (!referencedMemberIds.size) return [];

    const activeOrInvited = await manager.getRepository(GroupMember).find({
      where: {
        id: In([...referencedMemberIds]),
        group: { id: template.group.id },
        joinStatus: In(['active', 'invited']),
      },
    });
    const allowed = new Set((activeOrInvited ?? []).map((m) => m.id));
    return [...referencedMemberIds].filter((id) => !allowed.has(id));
  }

  /**
   * Advance a `YYYY-MM-DD` date by one frequency step, in **UTC**.
   *
   * All arithmetic goes through `Date.UTC(...)` so the result never depends on
   * the server's local timezone or DST — parsing with `new Date(dateStr)` then
   * mutating via local `setDate/setMonth` (the previous approach) shifts by a
   * day on negative-offset servers and around DST. Day/week overflow is handled
   * by `Date.UTC` normalization (e.g. Dec 31 + 1d → Jan 1).
   *
   * Month-end convention (monthly/yearly): if the anchor day does not exist in
   * the target month, land on that month's **last valid day** — and recover the
   * anchor day whenever a later month is long enough. `anchorDay` (the template
   * start date's day-of-month) is what makes "31st of every month" produce
   * Jan 31 → Feb 28 → Mar 31 → Apr 30 → May 31 instead of drifting to the 28th.
   * Without it (defaulting to the current day) each month would stick at the
   * clamped day.
   */
  advanceDate(
    dateStr: string,
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly',
    anchorDay?: number,
  ): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (frequency === 'daily') {
      return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    }
    if (frequency === 'weekly') {
      return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
    }
    const anchor = anchorDay ?? d;
    // monthly → next month (0-indexed m); yearly → same month next year.
    return frequency === 'monthly'
      ? this.clampToMonth(y, m, anchor)
      : this.clampToMonth(y + 1, m - 1, anchor);
  }

  /**
   * Build a `YYYY-MM-DD` for the given (possibly out-of-range) month index,
   * clamping the day to the target month's last valid day. `monthIdx0` may be
   * 12 (December + 1) and is normalized into the next year.
   */
  private clampToMonth(year: number, monthIdx0: number, day: number): string {
    const targetYear = year + Math.floor(monthIdx0 / 12);
    const targetMonth = ((monthIdx0 % 12) + 12) % 12;
    // Day 0 of the following month = the last day of the target month.
    const lastDay = new Date(
      Date.UTC(targetYear, targetMonth + 1, 0),
    ).getUTCDate();
    const clampedDay = Math.min(day, lastDay);
    return new Date(Date.UTC(targetYear, targetMonth, clampedDay))
      .toISOString()
      .slice(0, 10);
  }
}
