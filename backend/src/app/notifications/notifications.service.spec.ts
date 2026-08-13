import { NotificationsService } from './notifications.service';
import { NotificationCandidate } from './notification.types';
import { WHILE_AWAY_ITEM_CAP } from './notification-ranking.constants';

const cand = (over: Partial<NotificationCandidate>): NotificationCandidate => ({
  id: 'c',
  category: 'finance',
  sourceDomain: 'FINANCE',
  title: 't',
  message: 'm',
  importance: 'useful',
  urgency: 0.5,
  confidence: 0.9,
  actionable: false,
  observedAt: '2026-08-10T00:00:00.000Z',
  ...over,
});

describe('NotificationsService (BATCH-12 engine)', () => {
  let flags: { isEnabled: jest.Mock };
  let state: {
    getControl: jest.Mock;
    getSeenMap: jest.Mock;
    markState: jest.Mock;
    setControl: jest.Mock;
  };
  let provider: { name: string; getCandidates: jest.Mock };
  let svc: NotificationsService;

  beforeEach(() => {
    flags = { isEnabled: jest.fn().mockReturnValue(true) };
    state = {
      getControl: jest.fn().mockResolvedValue('standard'),
      getSeenMap: jest.fn().mockResolvedValue({}),
      markState: jest.fn(),
      setControl: jest.fn().mockResolvedValue('off'),
    };
    provider = { name: 'p', getCandidates: jest.fn().mockResolvedValue([]) };
    svc = new NotificationsService(
      flags as any,
      state as any,
      [provider] as any,
    );
  });

  describe('feature flag OFF — inert', () => {
    beforeEach(() => flags.isEnabled.mockReturnValue(false));

    it('returns no notifications and does not gather candidates', async () => {
      const res = await svc.getNotifications('u1');
      expect(res.notifications).toEqual([]);
      expect(provider.getCandidates).not.toHaveBeenCalled();
    });

    it('markState is a no-op', async () => {
      await svc.markState('u1', 'n1', true);
      expect(state.markState).not.toHaveBeenCalled();
    });
  });

  describe('feature flag ON', () => {
    it('gathers, ranks, and returns notifications', async () => {
      provider.getCandidates.mockResolvedValue([
        cand({ id: 'crit', importance: 'critical', urgency: 0 }),
        cand({ id: 'norm', importance: 'high', urgency: 0 }),
      ]);
      const res = await svc.getNotifications('u1');
      expect(provider.getCandidates).toHaveBeenCalledWith('u1');
      expect(res.notifications.map((n) => n.id)).toEqual(['crit', 'norm']);
    });

    it('suppresses already seen/acted candidates (NOT-003)', async () => {
      provider.getCandidates.mockResolvedValue([
        cand({ id: 'seenOne', importance: 'high' }),
        cand({ id: 'fresh', importance: 'high' }),
      ]);
      state.getSeenMap.mockResolvedValue({ seenOne: 'seen' });
      const res = await svc.getNotifications('u1');
      expect(res.notifications.map((n) => n.id)).toEqual(['fresh']);
    });

    it('applies the while-away hard cap (UX-007)', async () => {
      provider.getCandidates.mockResolvedValue(
        Array.from({ length: WHILE_AWAY_ITEM_CAP + 5 }, (_, i) =>
          cand({ id: `n${i}`, importance: 'high', urgency: 1 - i / 100 }),
        ),
      );
      const res = await svc.getNotifications('u1', true);
      expect(res.notifications.length).toBe(WHILE_AWAY_ITEM_CAP);
    });

    it('a failing provider never breaks the feed', async () => {
      const bad = {
        name: 'bad',
        getCandidates: jest.fn().mockRejectedValue(new Error('boom')),
      };
      svc = new NotificationsService(
        flags as any,
        state as any,
        [bad, provider] as any,
      );
      provider.getCandidates.mockResolvedValue([cand({ id: 'ok', importance: 'high' })]);
      const res = await svc.getNotifications('u1');
      expect(res.notifications.map((n) => n.id)).toEqual(['ok']);
    });

    it('markState maps acted correctly', async () => {
      await svc.markState('u1', 'n1', true);
      expect(state.markState).toHaveBeenCalledWith('u1', 'n1', 'acted');
      await svc.markState('u1', 'n2', false);
      expect(state.markState).toHaveBeenCalledWith('u1', 'n2', 'seen');
    });
  });
});
