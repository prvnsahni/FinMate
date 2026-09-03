import {
  computeLevel,
  isVisible,
  rankCandidates,
} from './notification-ranking';
import { NotificationCandidate } from './notification.types';

const candidate = (
  over: Partial<NotificationCandidate> = {},
): NotificationCandidate => ({
  id: 'c1',
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

describe('notification-ranking (NOT-001/003/006)', () => {
  describe('computeLevel', () => {
    it('maps importance to a base L1–L5', () => {
      expect(
        computeLevel(candidate({ importance: 'critical', urgency: 0 })),
      ).toBe(1);
      expect(computeLevel(candidate({ importance: 'high', urgency: 0 }))).toBe(
        2,
      );
      expect(
        computeLevel(candidate({ importance: 'useful', urgency: 0 })),
      ).toBe(3);
      expect(computeLevel(candidate({ importance: 'low', urgency: 0 }))).toBe(
        4,
      );
      expect(
        computeLevel(candidate({ importance: 'optional', urgency: 0 })),
      ).toBe(5);
    });

    it('high urgency + confidence promotes one level', () => {
      expect(
        computeLevel(
          candidate({ importance: 'high', urgency: 0.9, confidence: 0.9 }),
        ),
      ).toBe(1);
    });

    it('low confidence demotes one level (clamped to L5)', () => {
      expect(
        computeLevel(
          candidate({ importance: 'low', urgency: 0, confidence: 0.3 }),
        ),
      ).toBe(5);
      expect(
        computeLevel(
          candidate({ importance: 'optional', urgency: 0, confidence: 0.3 }),
        ),
      ).toBe(5); // clamp, never L6
    });
  });

  describe('isVisible (control filter + security override)', () => {
    it('standard shows L1–L4, hides L5', () => {
      expect(isVisible(4, 'standard')).toBe(true);
      expect(isVisible(5, 'standard')).toBe(false);
    });
    it('quieter shows only L1–L2', () => {
      expect(isVisible(2, 'quieter')).toBe(true);
      expect(isVisible(3, 'quieter')).toBe(false);
    });
    it('off hides everything EXCEPT critical security (NOT-006)', () => {
      expect(isVisible(1, 'off')).toBe(false);
      expect(isVisible(1, 'off', true)).toBe(true); // critical security survives
      expect(isVisible(2, 'off', true)).toBe(false);
    });
  });

  describe('rankCandidates', () => {
    it('orders by level then deterministic tie-breakers, and minimizes shape', () => {
      const ranked = rankCandidates(
        [
          candidate({
            id: 'b',
            importance: 'high',
            urgency: 0.5,
            confidence: 0.9,
          }),
          candidate({
            id: 'a',
            importance: 'high',
            urgency: 0.5,
            confidence: 0.9,
          }),
          candidate({ id: 'crit', importance: 'critical', urgency: 0 }),
        ],
        'standard',
      );
      expect(ranked.map((r) => r.id)).toEqual(['crit', 'a', 'b']); // L1 first; tie → id asc
      // minimized: no importance/urgency/confidence leaked
      expect(Object.keys(ranked[0]).sort()).toEqual(
        [
          'actionable',
          'category',
          'id',
          'level',
          'message',
          'observedAt',
          'title',
        ].sort(),
      );
    });

    it('urgency then confidence break ties within a level', () => {
      const ranked = rankCandidates(
        [
          candidate({
            id: 'lo',
            importance: 'high',
            urgency: 0.5,
            confidence: 0.7,
          }),
          candidate({
            id: 'hi',
            importance: 'high',
            urgency: 0.7,
            confidence: 0.7,
          }),
        ],
        'standard',
      );
      expect(ranked.map((r) => r.id)).toEqual(['hi', 'lo']);
    });

    it('applies the control filter (quieter drops L3+)', () => {
      const ranked = rankCandidates(
        [
          candidate({ id: 'useful', importance: 'useful', urgency: 0 }), // L3
          candidate({ id: 'high', importance: 'high', urgency: 0 }), // L2
        ],
        'quieter',
      );
      expect(ranked.map((r) => r.id)).toEqual(['high']);
    });

    it('returns [] for no candidates', () => {
      expect(rankCandidates([], 'standard')).toEqual([]);
    });
  });
});
