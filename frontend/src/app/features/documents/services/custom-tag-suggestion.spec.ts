import {
  AuthorizedCustomTag,
  suggestCustomTags,
} from './custom-tag-suggestion';

const tag = (
  id: string,
  name: string,
  scope: 'personal' | 'group' = 'personal',
  groupId?: string,
): AuthorizedCustomTag => ({ id, name, scope, groupId });

describe('suggestCustomTags (TAG-BATCH-C4 pure engine)', () => {
  // ── determinism / client-only ──────────────────────────────────────────────

  it('is pure: same input always yields the same output (no I/O, no state)', () => {
    const tags = [tag('a', 'My Grocery'), tag('b', 'Fuel')];
    const first = suggestCustomTags('grocery run', tags, []);
    const second = suggestCustomTags('grocery run', tags, []);
    expect(first).toEqual(second);
  });

  it('makes no network call — it has no HttpClient/fetch dependency', () => {
    // Install a tripwire `fetch`/`XMLHttpRequest` that throws if the engine ever
    // reaches for the network; a pure function must never touch either.
    const g = globalThis as unknown as {
      fetch?: unknown;
      XMLHttpRequest?: unknown;
    };
    const originalFetch = g.fetch;
    const originalXhr = g.XMLHttpRequest;
    const tripwire = jest.fn(() => {
      throw new Error('network not allowed');
    });
    g.fetch = tripwire;
    g.XMLHttpRequest = tripwire;
    try {
      expect(() =>
        suggestCustomTags('milk', [tag('a', 'Milk')], []),
      ).not.toThrow();
      expect(tripwire).not.toHaveBeenCalled();
    } finally {
      g.fetch = originalFetch;
      g.XMLHttpRequest = originalXhr;
    }
  });

  it('returns [] for a blank label or no authorized tags', () => {
    expect(suggestCustomTags('', [tag('a', 'Milk')])).toEqual([]);
    expect(suggestCustomTags('   ', [tag('a', 'Milk')])).toEqual([]);
    expect(suggestCustomTags('milk', [])).toEqual([]);
    expect(suggestCustomTags(null, [tag('a', 'Milk')])).toEqual([]);
  });

  // ── deterministic signals ──────────────────────────────────────────────────

  it('suggests on an exact normalized name match (authority INFERRED downstream)', () => {
    const res = suggestCustomTags('MILK', [tag('a', 'Milk')]);
    expect(res).toEqual([
      { tagId: 'a', name: 'Milk', reason: 'Matched tag name', confidence: 0.8 },
    ]);
  });

  it('suggests on keyword match (every tag-name word present in the label)', () => {
    const res = suggestCustomTags('weekly grocery haul', [tag('a', 'Grocery')]);
    expect(res[0]).toMatchObject({
      tagId: 'a',
      reason: 'Matched label keywords',
    });
    expect(res[0].confidence).toBe(0.6);
  });

  it('does NOT keyword-match when a tag-name word is missing from the label', () => {
    expect(suggestCustomTags('petrol', [tag('a', 'My Grocery')])).toEqual([]);
  });

  it('ranks a remembered correction above name/keyword matches', () => {
    const tags = [tag('a', 'Milk'), tag('b', 'My Grocery')];
    const res = suggestCustomTags('milk', tags, ['b']);
    expect(res[0]).toMatchObject({
      tagId: 'b',
      reason: 'Matched a previous correction',
    });
    expect(res[0].confidence).toBe(0.95);
    // The exact-name match still appears, ranked lower.
    expect(res.find((r) => r.tagId === 'a')?.reason).toBe('Matched tag name');
  });

  it('ignores a remembered id that is no longer authorized (deprecated/removed)', () => {
    // `x` was corrected before but is not in the authorized set now → dropped.
    const res = suggestCustomTags('anything', [tag('a', 'Milk')], ['x']);
    expect(res.find((r) => r.tagId === 'x')).toBeUndefined();
  });

  // ── scope: engine only sees what the caller authorized ──────────────────────

  it('only ever suggests from the tags it was given (caller enforces scope)', () => {
    // Simulate a group-scoped call: only Group-A tags are passed in.
    const groupATags = [tag('ga', 'Team Lunch', 'group', 'A')];
    const res = suggestCustomTags('team lunch', groupATags);
    expect(res.map((r) => r.tagId)).toEqual(['ga']);
    // A Group-B tag simply cannot appear — it was never passed to the engine.
  });

  // ── sensitive / canonical safety ────────────────────────────────────────────

  it('never invents canonical or sensitive tags — output is exactly the given custom tags', () => {
    // No canonical/sensitive taxonomy is reachable here; a "pharmacy" label with
    // no matching authorized custom tag yields nothing.
    expect(
      suggestCustomTags('pharmacy medicine', [tag('a', 'Groceries')]),
    ).toEqual([]);
  });
});
