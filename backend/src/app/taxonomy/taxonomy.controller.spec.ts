import { CanonicalTagDto, TaxonomyController } from './taxonomy.controller';

const list = (c: TaxonomyController): CanonicalTagDto[] =>
  c.getTaxonomy().data as CanonicalTagDto[];

/**
 * TAG-BATCH-B — the taxonomy endpoint must expose ONLY safe, active canonical
 * reference metadata: no user data, no E2EE content, no deprecated tags.
 */
describe('TaxonomyController', () => {
  const controller = new TaxonomyController();

  it('returns active canonical tags with the shared hierarchy', () => {
    const tags = list(controller);
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((t) => t.status === 'active')).toBe(true);

    const milk = tags.find((t) => t.id === 'milk');
    expect(milk).toMatchObject({
      id: 'milk',
      canonicalName: 'Milk',
      normalizedKey: 'milk',
      parentId: 'dairy',
      status: 'active',
    });
  });

  it('never exposes deprecated tags as selectable', () => {
    const tags = list(controller);
    // `misc` is deprecated in the seed — it must not be offered as a filter.
    expect(tags.find((t) => t.id === 'misc')).toBeUndefined();
  });

  it('exposes only safe canonical fields — no user/E2EE/expense data', () => {
    const tags = list(controller);
    const allowed = new Set([
      'id',
      'canonicalName',
      'normalizedKey',
      'parentId',
      'status',
      'version',
    ]);
    for (const tag of tags) {
      for (const key of Object.keys(tag)) {
        expect(allowed.has(key)).toBe(true);
      }
      // Explicitly assert none of the sensitive shapes leak in.
      expect(tag).not.toHaveProperty('description');
      expect(tag).not.toHaveProperty('userId');
      expect(tag).not.toHaveProperty('title');
    }
  });
});
