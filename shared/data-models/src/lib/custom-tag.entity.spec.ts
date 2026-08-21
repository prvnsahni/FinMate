import { getMetadataArgsStorage } from 'typeorm';
import { CustomTag } from './custom-tag.entity';
import { ExpenseTag } from './expense-tag.entity';

/**
 * TAG-BATCH-C1 — entity-shape guards (no DataSource needed): the custom-tag name
 * is E2EE-only with no plaintext companion and no server-side decrypt transformer,
 * the scope invariant is declared as a CHECK, and the unified-namespace `tagScope`
 * discriminator defaults to `global` so canonical assignments are unaffected.
 */
describe('CustomTag entity (TAG-BATCH-C1)', () => {
  const columns = getMetadataArgsStorage().columns.filter(
    (c) => c.target === CustomTag,
  );
  const colNames = columns.map((c) => c.propertyName);

  it('stores the name E2EE-only — text column, no transformer, no plaintext companion', () => {
    expect(colNames).toContain('encryptedName');
    const enc = columns.find((c) => c.propertyName === 'encryptedName');
    expect(enc?.options.type).toBe('text');
    // No server-side encrypt/decrypt transformer — the client owns the ciphertext.
    expect(enc?.options.transformer).toBeUndefined();
    for (const forbidden of [
      'name',
      'plaintextName',
      'normalizedKey',
      'nameKey',
      'nameHash',
      'nameSearch',
    ]) {
      expect(colNames).not.toContain(forbidden);
    }
  });

  it('carries the scope + lifecycle fields (and no finance fields)', () => {
    expect(colNames).toEqual(
      expect.arrayContaining(['scopeType', 'status', 'encryptedName']),
    );
    for (const finance of ['amountTotal', 'currency', 'amount', 'balance']) {
      expect(colNames).not.toContain(finance);
    }
  });

  it('declares the scope-invariant CHECK (personal XOR group)', () => {
    const checks = getMetadataArgsStorage().checks.filter(
      (c) => c.target === CustomTag,
    );
    const expr = checks.map((c) => String(c.expression)).join(' ');
    expect(expr).toContain("'personal'");
    expect(expr).toContain("'group'");
  });
});

describe('ExpenseTag.tagScope (TAG-BATCH-C1 unified namespace)', () => {
  it('adds tagScope defaulting to global so canonical assignments are unaffected', () => {
    const col = getMetadataArgsStorage().columns.find(
      (c) => c.target === ExpenseTag && c.propertyName === 'tagScope',
    );
    expect(col).toBeDefined();
    expect(col?.options.default).toBe('global');
    // Still ONE assignment table — no separate customTagId column was introduced.
    const expenseTagCols = getMetadataArgsStorage()
      .columns.filter((c) => c.target === ExpenseTag)
      .map((c) => c.propertyName);
    expect(expenseTagCols).not.toContain('customTagId');
  });
});
