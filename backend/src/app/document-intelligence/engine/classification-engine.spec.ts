import { StubClassificationEngine } from './stub-classification-engine';
import {
  CLASSIFICATION_CONTRACT_VERSION,
  ClassificationInput,
} from './classification-engine.types';

const engine = new StubClassificationEngine();

const input = (
  over: Partial<ClassificationInput> = {},
): ClassificationInput => ({
  itemLabel: 'Amul Milk',
  category: 'Grocery',
  ...over,
});

describe('StubClassificationEngine (DOC-0 contract — independent of extraction)', () => {
  it('returns an explicit unsupported result with NO tags (no tag generation)', async () => {
    const r = await engine.classify(input());
    expect(r.status).toBe('unsupported');
    expect(r.candidateTags).toEqual([]);
    expect(r.candidatesOnly).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('never invents a taxonomy even for a well-known item', async () => {
    const r = await engine.classify(input({ itemLabel: 'Milk' }));
    // DOC-0 must NOT propose grocery/dairy/milk/household.
    expect(r.candidateTags).toHaveLength(0);
  });

  it('flags invalid input when no descriptor is supplied', async () => {
    const r = await engine.classify({});
    expect(r.status).toBe('invalid_input');
    expect(r.candidateTags).toEqual([]);
  });

  it('advertises stub capabilities with no external provider', () => {
    const c = engine.capabilities();
    expect(c.kind).toBe('stub');
    expect(c.contractVersion).toBe(CLASSIFICATION_CONTRACT_VERSION);
    expect(c.usesExternalProvider).toBe(false);
  });

  it('is independent of the extraction contract (test §15) — has no extract() surface', () => {
    const surface = engine as unknown as Record<string, unknown>;
    expect(typeof surface.extract).toBe('undefined');
    expect(typeof engine.classify).toBe('function');
    // And no persistence/learning surface.
    for (const forbidden of ['persist', 'saveTag', 'train', 'learn']) {
      expect(typeof surface[forbidden]).toBe('undefined');
    }
  });
});
