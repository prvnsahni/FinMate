import { CANONICAL_TAXONOMY } from './canonical-taxonomy';
import {
  classifyLabel,
  getActiveCanonicalTag,
  getActiveCanonicalTaxonomy,
  normalizeTagKey,
} from './classify';

describe('normalizeTagKey', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeTagKey('  Whole-Milk!! ')).toBe('whole milk');
    expect(normalizeTagKey('PETROL')).toBe('petrol');
    expect(normalizeTagKey('')).toBe('');
  });
});

describe('getActiveCanonicalTaxonomy / getActiveCanonicalTag (TAG-BATCH-B)', () => {
  it('returns only active tags (excludes deprecated seed terms)', () => {
    const active = getActiveCanonicalTaxonomy();
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((t) => t.status === 'active')).toBe(true);
    // `misc` is deprecated in the seed and must never be returned.
    expect(active.find((t) => t.id === 'misc')).toBeUndefined();
    // sanity: a known active tag is present with its hierarchy.
    expect(active.find((t) => t.id === 'milk')?.parentId).toBe('dairy');
  });

  it('looks up active tags by id and rejects deprecated/unknown ids', () => {
    expect(getActiveCanonicalTag('grocery')?.canonicalName).toBe('Grocery');
    expect(getActiveCanonicalTag('misc')).toBeUndefined();
    expect(getActiveCanonicalTag('does-not-exist')).toBeUndefined();
  });
});

describe('classifyLabel (deterministic, bounded, no fabrication)', () => {
  it('classifies milk into its ancestor chain (milk → dairy → grocery → food)', () => {
    const ids = classifyLabel('Milk')
      .map((t) => t.tagId)
      .sort();
    expect(ids).toEqual(['dairy', 'food', 'grocery', 'milk']);
  });

  it('classifies fuel into fuel → vehicle → transport', () => {
    const ids = classifyLabel('Petrol')
      .map((t) => t.tagId)
      .sort();
    expect(ids).toEqual(['fuel', 'transport', 'vehicle']);
  });

  it('resolves aliases (petrol/diesel/gas → fuel)', () => {
    for (const alias of ['petrol', 'diesel', 'gas']) {
      expect(classifyLabel(alias).some((t) => t.tagId === 'fuel')).toBe(true);
    }
  });

  it('is deterministic — same input, same output', () => {
    expect(classifyLabel('Milk')).toEqual(classifyLabel('Milk'));
  });

  it('every suggestion is INFERRED / rule_based, confidence is not correctness', () => {
    const tags = classifyLabel('Milk');
    for (const t of tags) {
      expect(t.authority).toBe('INFERRED');
      expect(t.source).toBe('rule_based');
      expect(t.confidence).toBeGreaterThan(0);
      expect(t.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('dedupes and returns stable ids', () => {
    const ids = classifyLabel('Milk milk MILK').map((t) => t.tagId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns [] when nothing matches — never fabricates a tag', () => {
    expect(classifyLabel('zzzq nonsense')).toEqual([]);
    expect(classifyLabel('')).toEqual([]);
  });

  it('bounded growth: only ever suggests ids from the active canonical seed', () => {
    const activeIds = new Set(
      CANONICAL_TAXONOMY.filter((t) => t.status === 'active').map((t) => t.id),
    );
    for (const label of ['Milk', 'Petrol', 'Detergent', 'Rice', 'Restaurant']) {
      for (const t of classifyLabel(label))
        expect(activeIds.has(t.tagId)).toBe(true);
    }
  });

  it('never suggests a deprecated tag (misc)', () => {
    expect(
      classifyLabel('misc miscellaneous').some((t) => t.tagId === 'misc'),
    ).toBe(false);
  });

  it('SENSITIVE-TAG boundary: does not derive medical/pharmacy/health tags', () => {
    for (const label of [
      'pharmacy',
      'medicine',
      'paracetamol',
      'hospital',
      'clinic',
      'therapy',
    ]) {
      const tags = classifyLabel(label);
      expect(tags.map((t) => t.canonicalName).join(' ')).not.toMatch(
        /medic|pharmac|health|clinic|hospital/i,
      );
    }
  });

  it('uses the coarse category as an additional signal', () => {
    expect(
      classifyLabel('unknownitem', 'Grocery').some(
        (t) => t.tagId === 'grocery',
      ),
    ).toBe(true);
  });
});
