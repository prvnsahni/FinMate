import { SecurityEventNotificationProvider } from './security-event.provider';

/**
 * A chainable query-builder mock whose getMany resolves the queued row sets in
 * order (first call = auth events, second = group.key_rotated events).
 */
function makeRepo(rowSets: any[][]) {
  const wheres: Record<string, unknown>[] = [];
  let call = 0;
  const builder: any = {
    where: jest.fn((_c: string, p: Record<string, unknown>) => {
      wheres.push(p);
      return builder;
    }),
    andWhere: jest.fn((_c: string, p: Record<string, unknown>) => {
      if (p) wheres.push(p);
      return builder;
    }),
    orderBy: jest.fn(() => builder),
    take: jest.fn(() => builder),
    getMany: jest.fn(async () => rowSets[Math.min(call++, rowSets.length - 1)]),
  };
  return {
    repo: { createQueryBuilder: jest.fn(() => builder), save: jest.fn() },
    wheres,
  };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: '11111111-2222-3333-4444-555555555555',
  action: 'auth.password_changed',
  createdAt: new Date('2026-08-10T00:00:00.000Z'),
  ...over,
});

describe('SecurityEventNotificationProvider (NOT-006/007)', () => {
  it('maps known security events to candidates and IGNORES benign/noisy ones', async () => {
    const { repo } = makeRepo([
      [
        row({ action: 'auth.password_changed' }),
        row({ action: 'auth.login_success' }), // benign → excluded (anti-nag)
        row({ action: 'auth.mfa_disabled' }), // critical
      ],
      [], // no group events
    ]);
    const provider = new SecurityEventNotificationProvider(repo as any);
    const out = await provider.getCandidates('user-1');

    const actions = out.map((c) => c.title);
    expect(actions).toContain('Your password was changed');
    expect(actions).toContain('Two-factor authentication was disabled');
    expect(out.length).toBe(2); // login_success excluded
    // critical event flagged security (survives "off")
    const mfa = out.find((c) => c.title.includes('disabled'));
    expect(mfa?.security).toBe(true);
    expect(mfa?.importance).toBe('critical');
  });

  it('uses an opaque, deterministic id — never the raw audit primary key', async () => {
    const { repo } = makeRepo([[row()], []]);
    const provider = new SecurityEventNotificationProvider(repo as any);
    const out = await provider.getCandidates('user-1');
    expect(out[0].id).toMatch(/^sec-[0-9a-f]{16}$/);
    expect(out[0].id).not.toContain(row().id);
  });

  it('scopes the read to the authenticated user and never writes', async () => {
    const { repo, wheres } = makeRepo([[row()], []]);
    const provider = new SecurityEventNotificationProvider(repo as any);
    await provider.getCandidates('user-42');
    expect(wheres.some((w) => w.userId === 'user-42')).toBe(true);
    expect(repo.save).not.toHaveBeenCalled(); // strictly read-only
  });

  it('surfaces no email/IP/metadata in candidate content', async () => {
    const { repo } = makeRepo([
      [row({ metadataJson: { email: 'secret@example.com' } })],
      [],
    ]);
    const provider = new SecurityEventNotificationProvider(repo as any);
    const out = await provider.getCandidates('user-1');
    expect(JSON.stringify(out)).not.toContain('secret@example.com');
  });
});
