import { RuleBasedClassificationEngine } from './rule-based-classification-engine';

const engine = new RuleBasedClassificationEngine();

describe('RuleBasedClassificationEngine (DOC-5, shared taxonomy)', () => {
  it('classifies a known item into candidate tags (INFERRED, rule_based)', async () => {
    const r = await engine.classify({ itemLabel: 'Milk' });
    expect(r.status).toBe('ok');
    const names = r.candidateTags.map((t) => t.tag);
    expect(names).toEqual(expect.arrayContaining(['Milk', 'Grocery']));
    for (const t of r.candidateTags) {
      expect(t.authority).toBe('INFERRED');
      expect(t.source).toBe('rule_based');
      expect(t.confidence?.score).toBeGreaterThan(0);
    }
    expect(r.candidatesOnly).toBe(true);
  });

  it('uses the coarse category as a signal', async () => {
    const r = await engine.classify({ category: 'Grocery' });
    expect(r.candidateTags.some((t) => t.tag === 'Grocery')).toBe(true);
  });

  it('returns ok with no tags when nothing matches — never fabricates', async () => {
    const r = await engine.classify({ itemLabel: 'zzzq' });
    expect(r.status).toBe('ok');
    expect(r.candidateTags).toEqual([]);
  });

  it('flags invalid input when neither label nor category is given', async () => {
    const r = await engine.classify({});
    expect(r.status).toBe('invalid_input');
    expect(r.candidateTags).toEqual([]);
  });

  it('does not derive sensitive medical/pharmacy tags', async () => {
    const r = await engine.classify({ itemLabel: 'pharmacy medicine' });
    expect(r.candidateTags.map((t) => t.tag).join(' ')).not.toMatch(
      /medic|pharmac|health/i,
    );
  });

  it('uses no external provider', () => {
    expect(engine.capabilities().usesExternalProvider).toBe(false);
    expect(engine.capabilities().kind).toBe('rule_based');
  });

  it('does not echo E2EE keys, auth tokens, or raw bytes from adversarial input', async () => {
    const r = await engine.classify({
      itemLabel: 'Milk',
      category: 'Grocery',
      encryptedFileKey: 'wrapped-secret-key',
      authToken: 'bearer-secret-token',
      rawAttachmentBytes: 'raw-bytes',
    } as never);

    expect(JSON.stringify(r)).not.toMatch(
      /wrapped-secret-key|bearer-secret-token|raw-bytes/i,
    );
    expect(r.candidateTags.some((t) => t.tag === 'Milk')).toBe(true);
  });
});
