import { getMetadataArgsStorage } from 'typeorm';
import { PublicShare } from './public-share.entity';

/**
 * PUBLIC-1A — entity-shape guards (no DataSource needed): the public-share row is
 * a capability boundary only. It holds a token HASH + lifecycle and NOTHING that
 * could leak a raw token, PII, finance, E2EE ciphertext, keys, or internal ids.
 * FK delete behaviour is safe (group CASCADE; creator SET NULL provenance only).
 */
describe('PublicShare entity (PUBLIC-1A)', () => {
  const columns = getMetadataArgsStorage().columns.filter(
    (c) => c.target === PublicShare,
  );
  const colNames = columns.map((c) => c.propertyName);
  const relations = getMetadataArgsStorage().relations.filter(
    (r) => r.target === PublicShare,
  );

  it('stores the token as a UNIQUE 64-char HASH (never a raw/plaintext token)', () => {
    expect(colNames).toContain('tokenHash');
    const th = columns.find((c) => c.propertyName === 'tokenHash');
    expect(th?.options.type).toBe('varchar');
    expect(th?.options.length).toBe(64);
    expect(th?.options.unique).toBe(true);
    for (const forbidden of [
      'token',
      'rawToken',
      'plaintextToken',
      'tokenPlain',
      'secret',
    ]) {
      expect(colNames).not.toContain(forbidden);
    }
  });

  it('carries ONLY lifecycle fields', () => {
    expect(colNames).toEqual(
      expect.arrayContaining(['tokenHash', 'status', 'expiresAt', 'revokedAt']),
    );
    const expires = columns.find((c) => c.propertyName === 'expiresAt');
    expect(expires?.options.type).toBe('timestamptz');
    expect(expires?.options.nullable).toBe(true);
  });

  it('has NO name/PII/id/finance/E2EE/key columns (nothing sensitive is persisted)', () => {
    for (const forbidden of [
      // identity / PII
      'name',
      'groupName',
      'displayName',
      'memberName',
      'nickname',
      'email',
      'phone',
      'phoneNumber',
      'username',
      'userId',
      'memberId',
      'expenseId',
      'groupIdString',
      'labelPolicy',
      // finance
      'amount',
      'amountTotal',
      'total',
      'balance',
      'currency',
      // E2EE / keys / content
      'encryptedName',
      'ciphertext',
      'encrypted',
      'title',
      'description',
      'note',
      'key',
      'wrappedKey',
      'groupKey',
    ]) {
      expect(colNames).not.toContain(forbidden);
    }
  });

  it('group is a REQUIRED FK that CASCADEs the share on group deletion', () => {
    const group = relations.find((r) => r.propertyName === 'group');
    expect(group).toBeDefined();
    expect(group?.options.onDelete).toBe('CASCADE');
    expect(group?.options.nullable).toBe(false);
  });

  it('creator FK only SET NULLs on user deletion (provenance — never deletes the share/group)', () => {
    const creator = relations.find((r) => r.propertyName === 'createdByUser');
    expect(creator).toBeDefined();
    expect(creator?.options.onDelete).toBe('SET NULL');
    expect(creator?.options.nullable).toBe(true);
  });
});
