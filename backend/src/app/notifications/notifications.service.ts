import { Inject, Injectable } from '@nestjs/common';
import { FeatureFlagsService } from '../platform/feature-flags.service';
import {
  NOTIFICATION_PROVIDERS,
  NotificationCandidateProvider,
} from './notification-candidate.provider';
import { NotificationStateService } from './notification-state.service';
import { rankCandidates } from './notification-ranking';
import {
  NotificationCandidate,
  NotificationControl,
  RankedNotification,
} from './notification.types';
import {
  MAX_NOTIFICATIONS,
  WHILE_AWAY_ITEM_CAP,
} from './notification-ranking.constants';

export interface NotificationFetchResult {
  notifications: RankedNotification[];
  control: NotificationControl;
}

/**
 * Computed, read-only notification engine (BATCH-12). Gathers candidates from the
 * registered providers (scoped to the user), suppresses already seen/acted items,
 * ranks them deterministically for the user's control, and caps the result. It
 * NEVER writes to any financial record and performs no external/AI calls.
 *
 * When `notifications.inApp` is OFF the engine is inert — it returns an empty list
 * and does not gather candidates or mutate state.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly state: NotificationStateService,
    @Inject(NOTIFICATION_PROVIDERS)
    private readonly providers: NotificationCandidateProvider[],
  ) {}

  private enabled(): boolean {
    return this.flags.isEnabled('notifications.inApp');
  }

  /**
   * The ranked notifications for a user. `whileAway` applies the smaller
   * "while you were away" pull cap (UX-007); otherwise the standard cap.
   */
  async getNotifications(
    userId: string,
    whileAway = false,
  ): Promise<NotificationFetchResult> {
    const control = await this.state.getControl(userId);
    if (!this.enabled()) {
      return { notifications: [], control };
    }

    const candidates = await this.gatherCandidates(userId);
    const seen = await this.state.getSeenMap(userId);
    const unsuppressed = candidates.filter((c) => !seen[c.id]); // NOT-003

    const ranked = rankCandidates(unsuppressed, control);
    const cap = whileAway ? WHILE_AWAY_ITEM_CAP : MAX_NOTIFICATIONS;
    return { notifications: ranked.slice(0, cap), control };
  }

  /** Mark a notification seen/acted for the user (no-op when the feature is OFF). */
  async markState(
    userId: string,
    notificationId: string,
    acted: boolean,
  ): Promise<void> {
    if (!this.enabled()) return;
    await this.state.markState(
      userId,
      notificationId,
      acted ? 'acted' : 'seen',
    );
  }

  /** Update the user's 3-way control (no-op when OFF). */
  async setControl(
    userId: string,
    control: NotificationControl,
  ): Promise<NotificationControl> {
    if (!this.enabled()) return this.state.getControl(userId);
    return this.state.setControl(userId, control);
  }

  private async gatherCandidates(
    userId: string,
  ): Promise<NotificationCandidate[]> {
    const all: NotificationCandidate[] = [];
    for (const provider of this.providers) {
      try {
        all.push(...(await provider.getCandidates(userId)));
      } catch {
        // A failing provider must never break the whole feed.
      }
    }
    return all;
  }
}
