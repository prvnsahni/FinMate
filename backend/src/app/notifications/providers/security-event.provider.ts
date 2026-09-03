import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AuditLog } from '@finmate/data-models';
import { NotificationCandidateProvider } from '../notification-candidate.provider';
import {
  NotificationCandidate,
  NotificationImportance,
} from '../notification.types';

interface SecurityEventDef {
  importance: NotificationImportance;
  title: string;
  message: string;
}

/**
 * Notification-worthy security events and how they present. Deliberately EXCLUDES
 * noisy/benign events (e.g. every `auth.login_success`, `auth.email_verified`) to
 * honour the anti-nag requirement (NOT-007). All are presentation-safe — no email,
 * IP, token, or audit metadata is surfaced.
 */
const SECURITY_EVENTS: Record<string, SecurityEventDef> = {
  'auth.password_changed': {
    importance: 'high',
    title: 'Your password was changed',
    message: 'If this was not you, secure your account immediately.',
  },
  'auth.password_reset': {
    importance: 'critical',
    title: 'Your password was reset',
    message:
      'If you did not request this, contact support and secure your account.',
  },
  'auth.mfa_disabled': {
    importance: 'critical',
    title: 'Two-factor authentication was disabled',
    message: 'If this was not you, re-enable 2FA and secure your account.',
  },
  'auth.mfa_verified': {
    importance: 'high',
    title: 'Two-factor authentication was enabled',
    message: 'Your account now requires a verification code at sign-in.',
  },
  'group.key_rotated': {
    importance: 'high',
    title: 'A group encryption key was rotated',
    message: 'Group members refresh their access automatically.',
  },
};

/** How recent an event must be to still be worth surfacing. [PRODUCT-TUNABLE] */
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 20;

const URGENCY_BY_IMPORTANCE: Record<NotificationImportance, number> = {
  critical: 1,
  high: 0.8,
  useful: 0.5,
  low: 0.3,
  optional: 0.1,
};

/**
 * Derives security-event notification candidates from the user's own `audit_logs`
 * rows. Strictly read-only and scoped to the authenticated user.
 */
@Injectable()
export class SecurityEventNotificationProvider
  implements NotificationCandidateProvider
{
  readonly name = 'security-events';

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async getCandidates(userId: string): Promise<NotificationCandidate[]> {
    const since = new Date(Date.now() - LOOKBACK_MS);
    const rows = await this.auditRepo
      .createQueryBuilder('log')
      .where('log.actorUser = :userId', { userId })
      .andWhere('log.entityType = :type', { type: 'auth' })
      .andWhere('log.createdAt >= :since', { since })
      .orderBy('log.createdAt', 'DESC')
      .take(MAX_EVENTS * 2)
      .getMany();

    // `group.key_rotated` is entityType 'group', fetch a small slice too.
    const groupRows = await this.auditRepo
      .createQueryBuilder('log')
      .where('log.actorUser = :userId', { userId })
      .andWhere('log.action = :action', { action: 'group.key_rotated' })
      .andWhere('log.createdAt >= :since', { since })
      .orderBy('log.createdAt', 'DESC')
      .take(MAX_EVENTS)
      .getMany();

    const candidates: NotificationCandidate[] = [];
    for (const row of [...rows, ...groupRows]) {
      const def = SECURITY_EVENTS[row.action];
      if (!def) continue; // ignore benign/noisy events (anti-nag)
      candidates.push({
        // Opaque, deterministic id — never exposes the raw audit primary key.
        id:
          'sec-' +
          createHash('sha256').update(row.id).digest('hex').slice(0, 16),
        category: 'security',
        sourceDomain: 'CORE',
        title: def.title,
        message: def.message,
        importance: def.importance,
        urgency: URGENCY_BY_IMPORTANCE[def.importance],
        confidence: 1, // audit log is authoritative
        actionable: def.importance === 'critical',
        observedAt: row.createdAt.toISOString(),
        security: def.importance === 'critical',
      });
    }
    return candidates.slice(0, MAX_EVENTS);
  }
}
