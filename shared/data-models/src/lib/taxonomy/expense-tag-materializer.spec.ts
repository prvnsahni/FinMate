import {
  ConfirmedTagInput,
  materializeConfirmedExpenseTags,
} from './expense-tag-materializer';

/**
 * TAG-BATCH-A — the materializer is the correctness core: it turns confirmed
 * DOC-5 tags into the exact set of `expense_tag` rows, preserving authority,
 * ancestors, provenance and de-dup — purely from stable tag ids (no free text).
 */
describe('materializeConfirmedExpenseTags', () => {
  const byId = (rows: ReturnType<typeof materializeConfirmedExpenseTags>) =>
    new Map(rows.map((r) => [r.tagId, r]));

  it('persists an INFERRED tag with its ancestors (milk → dairy → grocery → food)', () => {
    const rows = materializeConfirmedExpenseTags([
      { tagId: 'milk', authority: 'INFERRED', source: 'rule_based', confidence: 0.6 },
    ]);
    const ids = rows.map((r) => r.tagId).sort();
    expect(ids).toEqual(['dairy', 'food', 'grocery', 'milk']);

    const map = byId(rows);
    expect(map.get('milk')).toMatchObject({ authority: 'INFERRED', source: 'rule_based', confidence: 0.6 });
    // Derived ancestors are INFERRED/rule_based with no confidence.
    for (const anc of ['dairy', 'grocery', 'food']) {
      expect(map.get(anc)).toMatchObject({ authority: 'INFERRED', source: 'rule_based', confidence: null });
    }
    // Every row is stamped with the canonical taxonomy version.
    expect(rows.every((r) => r.taxonomyVersion === 1)).toBe(true);
  });

  it('preserves a USER_CORRECTED tag authority and source', () => {
    const rows = materializeConfirmedExpenseTags([
      { tagId: 'fuel', authority: 'USER_CORRECTED', source: 'user' },
    ]);
    const map = byId(rows);
    expect(map.get('fuel')).toMatchObject({ authority: 'USER_CORRECTED', source: 'user' });
    // Ancestors of fuel: vehicle → transport, derived INFERRED.
    expect(map.get('vehicle')).toMatchObject({ authority: 'INFERRED' });
    expect(map.get('transport')).toMatchObject({ authority: 'INFERRED' });
  });

  it('never downgrades USER_CONFIRMED to a later INFERRED (order-independent)', () => {
    const confirmedThenInferred: ConfirmedTagInput[] = [
      { tagId: 'grocery', authority: 'USER_CONFIRMED', source: 'user' },
      { tagId: 'milk', authority: 'INFERRED', source: 'rule_based' },
    ];
    const inferredThenConfirmed: ConfirmedTagInput[] = [
      { tagId: 'milk', authority: 'INFERRED', source: 'rule_based' },
      { tagId: 'grocery', authority: 'USER_CONFIRMED', source: 'user' },
    ];

    for (const inputs of [confirmedThenInferred, inferredThenConfirmed]) {
      const map = byId(materializeConfirmedExpenseTags(inputs));
      // grocery is BOTH an explicit USER_CONFIRMED tag AND an inferred ancestor
      // of milk — the higher authority must win regardless of order.
      expect(map.get('grocery')).toMatchObject({ authority: 'USER_CONFIRMED', source: 'user' });
    }
  });

  it('de-duplicates repeated tags into a single row each', () => {
    const rows = materializeConfirmedExpenseTags([
      { tagId: 'milk', authority: 'INFERRED' },
      { tagId: 'milk', authority: 'INFERRED' },
    ]);
    expect(rows.map((r) => r.tagId).sort()).toEqual(['dairy', 'food', 'grocery', 'milk']);
    expect(rows.filter((r) => r.tagId === 'milk')).toHaveLength(1);
  });

  it('drops deprecated and unknown tag ids (never fabricates)', () => {
    // `misc` is a deprecated seed tag; `does-not-exist` is unknown.
    expect(materializeConfirmedExpenseTags([{ tagId: 'misc', authority: 'USER_CONFIRMED' }])).toEqual([]);
    expect(materializeConfirmedExpenseTags([{ tagId: 'does-not-exist', authority: 'INFERRED' }])).toEqual([]);
  });

  it('returns [] for empty / nullish input', () => {
    expect(materializeConfirmedExpenseTags([])).toEqual([]);
    expect(materializeConfirmedExpenseTags(undefined)).toEqual([]);
    expect(materializeConfirmedExpenseTags(null)).toEqual([]);
  });

  it('operates purely on tag ids — it has no channel for title/description free text', () => {
    // The input shape carries only ids + authority/source/confidence; there is
    // no text field, so plaintext can never reach classification through here.
    const input: ConfirmedTagInput = { tagId: 'milk', authority: 'INFERRED' };
    expect(Object.keys(input).sort()).toEqual(['authority', 'tagId']);
    const rows = materializeConfirmedExpenseTags([input]);
    expect(rows.every((r) => Object.keys(r).sort().join(',') ===
      'authority,confidence,source,tagId,taxonomyVersion')).toBe(true);
  });
});
