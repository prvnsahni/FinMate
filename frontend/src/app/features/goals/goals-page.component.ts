import { Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { GoalsApiService } from './services/goals-api.service';
import { GoalCryptoService } from './services/goal-crypto.service';
import { DecryptedGoal, Goal, GoalProjection } from './goal.model';

/**
 * V1 Goals page (BATCH-11). Owner-scoped goals with client-side born-E2EE titles
 * and the deterministic Goal Engine projection. Presents projections as neutral
 * estimates — never guaranteed outcomes, investment advice, or shame language.
 */
@Component({
  selector: 'app-goals-page',
  standalone: true,
  imports: [ReactiveFormsModule, DecimalPipe],
  templateUrl: './goals-page.component.html',
})
export class GoalsPageComponent {
  private readonly api = inject(GoalsApiService);
  private readonly crypto = inject(GoalCryptoService);
  private readonly fb = inject(FormBuilder);

  readonly goals = signal<DecryptedGoal[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly featureUnavailable = signal(false);
  readonly recoveryRequired = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly projection = signal<GoalProjection | null>(null);
  readonly projectionForId = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    targetAmount: [0, [Validators.required, Validators.min(0.01)]],
    savedAmount: [0, [Validators.min(0)]],
    currency: ['USD', [Validators.required, Validators.maxLength(3)]],
    targetDate: [''],
    priority: [0, [Validators.min(0)]],
  });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const goals = await firstValueFrom(this.api.list());
      this.goals.set(await this.decryptAll(goals));
      this.featureUnavailable.set(false);
    } catch (e) {
      this.handleError(e, 'Could not load goals.');
    } finally {
      this.loading.set(false);
    }
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return;
    this.error.set(null);
    this.recoveryRequired.set(false);
    const v = this.form.getRawValue();
    try {
      // Encrypt the title CLIENT-SIDE; plaintext never leaves the browser.
      const { title, encryptedContentKey } = await this.crypto.encryptTitle(
        v.title,
      );
      const numeric = {
        targetAmount: v.targetAmount,
        savedAmount: v.savedAmount,
        currency: v.currency,
        targetDate: v.targetDate || undefined,
        priority: v.priority,
      };
      const id = this.editingId();
      if (id) {
        const current = this.goals().find((g) => g.id === id);
        await firstValueFrom(
          this.api.update(id, {
            version: current?.version ?? 0,
            title,
            encryptedContentKey,
            ...numeric,
          }),
        );
      } else {
        await firstValueFrom(
          this.api.create({ title, encryptedContentKey, ...numeric }),
        );
      }
      this.resetForm();
      await this.load();
    } catch (e) {
      this.handleError(e, 'Could not save the goal.');
    }
  }

  edit(goal: DecryptedGoal): void {
    this.editingId.set(goal.id);
    this.form.setValue({
      title: goal.decryptedTitle,
      targetAmount: goal.targetAmount,
      savedAmount: goal.savedAmount,
      currency: goal.currency,
      targetDate: goal.targetDate ?? '',
      priority: goal.priority,
    });
  }

  async remove(goal: DecryptedGoal): Promise<void> {
    this.error.set(null);
    try {
      await firstValueFrom(this.api.remove(goal.id));
      await this.load();
    } catch (e) {
      this.handleError(e, 'Could not delete the goal.');
    }
  }

  async showProjection(goal: DecryptedGoal, assumed?: number): Promise<void> {
    this.error.set(null);
    try {
      const result = await firstValueFrom(
        this.api.projection(goal.id, assumed),
      );
      this.projection.set(result);
      this.projectionForId.set(goal.id);
    } catch (e) {
      this.handleError(e, 'Could not compute the projection.');
    }
  }

  resetForm(): void {
    this.editingId.set(null);
    this.form.reset({
      title: '',
      targetAmount: 0,
      savedAmount: 0,
      currency: 'USD',
      targetDate: '',
      priority: 0,
    });
  }

  private async decryptAll(goals: Goal[]): Promise<DecryptedGoal[]> {
    const out: DecryptedGoal[] = [];
    for (const g of goals) {
      let decryptedTitle: string;
      try {
        decryptedTitle = await this.crypto.decryptTitle(
          g.title,
          g.encryptedContentKey,
        );
      } catch {
        decryptedTitle = '[unable to decrypt]';
      }
      out.push({ ...g, decryptedTitle });
    }
    return out;
  }

  private handleError(e: unknown, fallback: string): void {
    if (e instanceof HttpErrorResponse) {
      const body = e.error as { errorCode?: string } | null;
      if (e.status === 404) {
        this.featureUnavailable.set(true);
        return;
      }
      if (e.status === 409 && body?.errorCode === 'REC_RECOVERY_REQUIRED') {
        this.recoveryRequired.set(true);
        return;
      }
      if (e.status === 412) {
        this.error.set('This goal changed elsewhere. Reload and try again.');
        return;
      }
    }
    this.error.set(fallback);
  }
}
