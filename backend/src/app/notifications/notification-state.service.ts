import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { NotificationControl, NotificationState } from './notification.types';
import {
  CONTROL_PREF_TTL_SECONDS,
  DEFAULT_CONTROL,
  MAX_SEEN_IDS,
  SEEN_STATE_TTL_SECONDS,
} from './notification-ranking.constants';

const VALID_CONTROLS: NotificationControl[] = ['quieter', 'standard', 'off'];

/**
 * Per-user notification state in Redis — NO database table (BATCH-12 architecture).
 * Everything is scoped to the authenticated user, bounded (capped + TTL'd), and
 * carries only opaque notification ids + a coarse state — never financial payloads,
 * tokens, secrets, or E2EE plaintext.
 */
@Injectable()
export class NotificationStateService {
  constructor(private readonly redis: RedisService) {}

  private seenKey(userId: string): string {
    return `notif_state:${userId}`;
  }

  private controlKey(userId: string): string {
    return `notif_control:${userId}`;
  }

  /** The user's seen/acted map: opaque notification id → state. */
  async getSeenMap(userId: string): Promise<Record<string, NotificationState>> {
    const raw = await this.redis.get(this.seenKey(userId));
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, NotificationState>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  /** Mark a notification seen or acted (acted implies it should also be suppressed). */
  async markState(
    userId: string,
    notificationId: string,
    state: NotificationState,
  ): Promise<void> {
    const map = await this.getSeenMap(userId);
    map[notificationId] = state;

    // Bound the blob: keep only the most recent MAX_SEEN_IDS entries (insertion
    // order is preserved for string keys in JS objects).
    const keys = Object.keys(map);
    if (keys.length > MAX_SEEN_IDS) {
      const trimmed: Record<string, NotificationState> = {};
      for (const k of keys.slice(keys.length - MAX_SEEN_IDS)) {
        trimmed[k] = map[k];
      }
      await this.redis.set(
        this.seenKey(userId),
        JSON.stringify(trimmed),
        SEEN_STATE_TTL_SECONDS,
      );
      return;
    }
    await this.redis.set(
      this.seenKey(userId),
      JSON.stringify(map),
      SEEN_STATE_TTL_SECONDS,
    );
  }

  /** Resolve the user's 3-way control, defaulting to `standard` (NOT-004). */
  async getControl(userId: string): Promise<NotificationControl> {
    const raw = await this.redis.get(this.controlKey(userId));
    return VALID_CONTROLS.includes(raw as NotificationControl)
      ? (raw as NotificationControl)
      : DEFAULT_CONTROL;
  }

  /** Persist the user's control preference. Rejects unknown values. */
  async setControl(
    userId: string,
    control: NotificationControl,
  ): Promise<NotificationControl> {
    const value = VALID_CONTROLS.includes(control) ? control : DEFAULT_CONTROL;
    await this.redis.set(
      this.controlKey(userId),
      value,
      CONTROL_PREF_TTL_SECONDS,
    );
    return value;
  }
}
