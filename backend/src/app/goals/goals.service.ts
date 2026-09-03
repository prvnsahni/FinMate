import {
  Inject,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Goal, User } from '@finmate/data-models';
import { CreateGoalDto, UpdateGoalDto } from './dto/goal.dto';
import {
  GOAL_ENGINE,
  GoalEngine,
  GoalProjectionResult,
} from './engine/goal-engine.types';

/** Owner-visible goal shape. `title` stays E2EE ciphertext — never decrypted. */
export interface GoalView {
  id: string;
  title: string; // ciphertext
  encryptedContentKey: string | null;
  targetAmount: number;
  savedAmount: number;
  currency: string;
  targetDate: string | null;
  status: string;
  priority: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Whole calendar months between two dates (UTC, day-aware); min 0. */
function monthsElapsed(from: Date, to: Date): number {
  let m =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

/**
 * Goals-v2 (BATCH-11). Owner-scoped CRUD over born-E2EE goals; the server never
 * decrypts the title. Numeric projection is delegated to the stable GoalEngine
 * (deterministic V1) — the service never performs financial writes.
 */
@Injectable()
export class GoalsService {
  constructor(
    @InjectRepository(Goal)
    private readonly goalRepo: Repository<Goal>,
    @Inject(GOAL_ENGINE) private readonly engine: GoalEngine,
  ) {}

  async create(userId: string, dto: CreateGoalDto): Promise<GoalView> {
    const goal = this.goalRepo.create({
      ownerUser: { id: userId } as User,
      title: dto.title, // ciphertext — stored opaquely
      encryptedContentKey: dto.encryptedContentKey,
      targetAmount: dto.targetAmount,
      savedAmount: dto.savedAmount ?? 0,
      currency: dto.currency,
      targetDate: dto.targetDate ?? undefined,
      priority: dto.priority ?? 0,
      status: 'active',
    });
    const saved = await this.goalRepo.save(goal);
    return this.toView(saved);
  }

  /** All of the caller's goals, deterministically ordered (priority, then age). */
  async list(userId: string): Promise<GoalView[]> {
    const goals = await this.goalRepo.find({
      where: { ownerUser: { id: userId } },
      order: { priority: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
    return goals.map((g) => this.toView(g));
  }

  async get(userId: string, id: string): Promise<GoalView> {
    return this.toView(await this.ownedGoal(userId, id));
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateGoalDto,
  ): Promise<GoalView> {
    const goal = await this.ownedGoal(userId, id);
    if (goal.version !== dto.version) {
      throw new PreconditionFailedException(
        'This goal was changed elsewhere. Refresh and try again.',
      );
    }
    // Assign only provided fields; title/key stay opaque (no server decryption).
    for (const field of [
      'title',
      'encryptedContentKey',
      'targetAmount',
      'savedAmount',
      'currency',
      'targetDate',
      'priority',
      'status',
    ] as const) {
      if (dto[field] !== undefined) {
        (goal as unknown as Record<string, unknown>)[field] = dto[field];
      }
    }
    const saved = await this.goalRepo.save(goal);
    return this.toView(saved);
  }

  /**
   * Deletes the goal. Because the per-goal content key lives only in this row,
   * deleting it destroys the wrapped key — crypto-shredding the ciphertext title
   * (personal-scope hard delete, consistent with the frozen deletion model).
   */
  async remove(userId: string, id: string): Promise<void> {
    const goal = await this.ownedGoal(userId, id);
    await this.goalRepo.remove(goal);
  }

  /** Deterministic numeric projection via the GoalEngine (no free-text, no finance writes). */
  async project(
    userId: string,
    id: string,
    assumedMonthlyContribution?: number,
    nowIso?: string,
  ): Promise<GoalProjectionResult> {
    const goal = await this.ownedGoal(userId, id);
    const now = nowIso ?? new Date().toISOString();
    const savedAmount = Number(goal.savedAmount);
    const elapsed = monthsElapsed(new Date(goal.createdAt), new Date(now));
    const observedMonthlyRate =
      savedAmount > 0 && elapsed >= 1 ? savedAmount / elapsed : undefined;

    return this.engine.project({
      goal: {
        id: goal.id,
        currency: goal.currency,
        targetAmount: Number(goal.targetAmount),
        savedAmount,
        targetDate: goal.targetDate ?? null,
        status: goal.status,
        priority: goal.priority,
      },
      assumedMonthlyContribution,
      observedMonthlyRate,
      now,
    });
  }

  private async ownedGoal(userId: string, id: string): Promise<Goal> {
    const goal = await this.goalRepo.findOne({
      where: { id, ownerUser: { id: userId } },
    });
    if (!goal) {
      // Owner-scoped: a non-owner (IDOR) sees the same 404 as a missing goal.
      throw new NotFoundException('Goal not found');
    }
    return goal;
  }

  private toView(goal: Goal): GoalView {
    return {
      id: goal.id,
      title: goal.title,
      encryptedContentKey: goal.encryptedContentKey ?? null,
      targetAmount: Number(goal.targetAmount),
      savedAmount: Number(goal.savedAmount),
      currency: goal.currency,
      targetDate: goal.targetDate ?? null,
      status: goal.status,
      priority: goal.priority,
      version: goal.version,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
    };
  }
}
