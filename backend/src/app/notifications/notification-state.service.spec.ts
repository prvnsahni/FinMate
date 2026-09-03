import { NotificationStateService } from './notification-state.service';
import {
  MAX_SEEN_IDS,
  SEEN_STATE_TTL_SECONDS,
} from './notification-ranking.constants';

describe('NotificationStateService', () => {
  let redis: { get: jest.Mock; set: jest.Mock };
  let svc: NotificationStateService;

  beforeEach(() => {
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
    svc = new NotificationStateService(redis as any);
  });

  describe('seen/acted state', () => {
    it('returns {} when nothing stored and tolerates malformed JSON', async () => {
      expect(await svc.getSeenMap('u1')).toEqual({});
      redis.get.mockResolvedValue('not-json');
      expect(await svc.getSeenMap('u1')).toEqual({});
    });

    it('marks seen/acted scoped to the user, with TTL', async () => {
      await svc.markState('u1', 'n1', 'seen');
      expect(redis.set).toHaveBeenCalledWith(
        'notif_state:u1',
        JSON.stringify({ n1: 'seen' }),
        SEEN_STATE_TTL_SECONDS,
      );
      redis.set.mockClear();
      redis.get.mockResolvedValue(JSON.stringify({ n1: 'seen' }));
      await svc.markState('u1', 'n2', 'acted');
      expect(JSON.parse(redis.set.mock.calls[0][1])).toEqual({
        n1: 'seen',
        n2: 'acted',
      });
    });

    it('bounds the stored map to MAX_SEEN_IDS (no unbounded growth)', async () => {
      const big: Record<string, string> = {};
      for (let i = 0; i < MAX_SEEN_IDS + 50; i++) big[`old${i}`] = 'seen';
      redis.get.mockResolvedValue(JSON.stringify(big));
      await svc.markState('u1', 'newest', 'seen');
      const stored = JSON.parse(redis.set.mock.calls[0][1]);
      expect(Object.keys(stored).length).toBe(MAX_SEEN_IDS);
      expect(stored.newest).toBe('seen'); // newest retained
    });
  });

  describe('control preference', () => {
    it('defaults to standard and rejects unknown stored values', async () => {
      expect(await svc.getControl('u1')).toBe('standard');
      redis.get.mockResolvedValue('bogus');
      expect(await svc.getControl('u1')).toBe('standard');
      redis.get.mockResolvedValue('quieter');
      expect(await svc.getControl('u1')).toBe('quieter');
    });

    it('persists a valid control and coerces an invalid one to the default', async () => {
      expect(await svc.setControl('u1', 'off')).toBe('off');
      expect(redis.set).toHaveBeenCalledWith(
        'notif_control:u1',
        'off',
        expect.any(Number),
      );
      expect(await svc.setControl('u1', 'nonsense' as never)).toBe('standard');
    });
  });
});
