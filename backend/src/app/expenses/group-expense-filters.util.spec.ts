import {
  applyExpenseDimensionFilters,
  GroupExpenseDimensionFilters,
} from './group-expense-filters.util';

/** Records the conditions added to a subquery so the member branch is assertable. */
class FakeSubQuery {
  conditions: string[] = [];
  select() {
    return this;
  }
  from() {
    return this;
  }
  where(c: string) {
    this.conditions.push(c);
    return this;
  }
  andWhere(c: string) {
    this.conditions.push(c);
    return this;
  }
  getQuery() {
    return `SUBQ(${this.conditions.join(' AND ')})`;
  }
}

/** Minimal SelectQueryBuilder stand-in that records where clauses + params. */
class FakeQB {
  clauses: string[] = [];
  params: Record<string, unknown> = {};
  lastSub?: FakeSubQuery;

  andWhere(arg: unknown, params?: Record<string, unknown>) {
    if (typeof arg === 'function') {
      this.lastSub = new FakeSubQuery();
      const sub = { subQuery: () => this.lastSub };
      this.clauses.push((arg as (s: unknown) => string)(sub));
    } else {
      this.clauses.push(String(arg));
      if (params) Object.assign(this.params, params);
    }
    return this;
  }

  setParameter(key: string, value: unknown) {
    this.params[key] = value;
    return this;
  }
}

function apply(filter: GroupExpenseDimensionFilters): FakeQB {
  const qb = new FakeQB();
  applyExpenseDimensionFilters(qb as never, filter);
  return qb;
}

describe('applyExpenseDimensionFilters', () => {
  it('adds no clauses for an empty filter', () => {
    const qb = apply({});
    expect(qb.clauses).toEqual([]);
    expect(qb.params).toEqual({});
  });

  it('filters by transaction type', () => {
    const qb = apply({ transactionType: 'refund' });
    expect(qb.clauses).toContain('expense.transactionType = :gefTxType');
    expect(qb.params['gefTxType']).toBe('refund');
  });

  it('filters by categories (IN)', () => {
    const qb = apply({ categories: ['Food & Drinks', 'Travel'] });
    expect(qb.clauses).toContain('expense.category IN (:...gefCats)');
    expect(qb.params['gefCats']).toEqual(['Food & Drinks', 'Travel']);
  });

  it('filters by amount range (inclusive bounds)', () => {
    const qb = apply({ minAmount: 100, maxAmount: 500 });
    expect(qb.clauses).toContain('expense.amountTotal >= :gefMinAmount');
    expect(qb.clauses).toContain('expense.amountTotal <= :gefMaxAmount');
    expect(qb.params['gefMinAmount']).toBe(100);
    expect(qb.params['gefMaxAmount']).toBe(500);
  });

  it('payers with backing users match both payer columns (IN)', () => {
    const qb = apply({
      paidBy: [
        { groupMemberId: 'gm-1', userId: 'u-1' },
        { groupMemberId: 'gm-2', userId: 'u-2' },
      ],
    });
    expect(qb.clauses).toContain(
      '(expense.paidByGroupMember IN (:...gefPaidGm) OR expense.paidByUser IN (:...gefPaidUser))',
    );
    expect(qb.params['gefPaidGm']).toEqual(['gm-1', 'gm-2']);
    expect(qb.params['gefPaidUser']).toEqual(['u-1', 'u-2']);
  });

  it('pending payers (no user) match only the group-member column', () => {
    const qb = apply({ paidBy: [{ groupMemberId: 'gm-2', userId: null }] });
    expect(qb.clauses).toContain(
      '(expense.paidByGroupMember IN (:...gefPaidGm))',
    );
    expect(qb.params['gefPaidGm']).toEqual(['gm-2']);
    expect(qb.params['gefPaidUser']).toBeUndefined();
  });

  it('members with backing users match both split columns via EXISTS (IN)', () => {
    const qb = apply({ member: [{ groupMemberId: 'gm-3', userId: 'u-3' }] });
    expect(qb.clauses.some((c) => c.startsWith('EXISTS'))).toBe(true);
    expect(qb.lastSub?.conditions).toContain(
      '(gefSplit.participantGroupMember IN (:...gefMemGm) OR gefSplit.participantUser IN (:...gefMemUser))',
    );
    expect(qb.params['gefMemGm']).toEqual(['gm-3']);
    expect(qb.params['gefMemUser']).toEqual(['u-3']);
  });

  it('pending members (no user) match only the group-member split column', () => {
    const qb = apply({ member: [{ groupMemberId: 'gm-4', userId: null }] });
    expect(qb.lastSub?.conditions).toContain(
      'gefSplit.participantGroupMember IN (:...gefMemGm)',
    );
    expect(qb.params['gefMemGm']).toEqual(['gm-4']);
    expect(qb.params['gefMemUser']).toBeUndefined();
  });

  it('correlates the subquery to the outer expense alias and excludes soft-deleted splits', () => {
    const qb = apply({ member: [{ groupMemberId: 'gm-5', userId: 'u-5' }] });
    expect(qb.lastSub?.conditions).toContain('gefSplit.expense = expense.id');
    expect(qb.lastSub?.conditions).toContain('gefSplit.deletedAt IS NULL');
  });

  // ── TAG-BATCH-B — canonical tag filter (match ANY, correlated EXISTS) ─────────
  describe('tag filter', () => {
    it('filters by active tag ids via a correlated EXISTS with IN (match ANY)', () => {
      const qb = apply({ tagIds: ['milk', 'grocery'] });
      expect(qb.clauses.some((c) => c.startsWith('EXISTS'))).toBe(true);
      // IN (...) is match-ANY, consistent with the other multi-select dimensions.
      expect(qb.lastSub?.conditions).toContain('gefTag.tagId IN (:...gefTagIds)');
      // Correlated to the outer expense — never multiplies rows.
      expect(qb.lastSub?.conditions).toContain('gefTag.expense = expense.id');
      expect(qb.params['gefTagIds']).toEqual(['milk', 'grocery']);
    });

    it('drops unknown/deprecated tag ids (no clause when none are active)', () => {
      // `misc` is a deprecated seed tag; `not-a-tag` is unknown.
      const qb = apply({ tagIds: ['misc', 'not-a-tag'] });
      expect(qb.clauses.some((c) => c.startsWith('EXISTS'))).toBe(false);
      expect(qb.params['gefTagIds']).toBeUndefined();
    });

    it('keeps only the active ids from a mixed list', () => {
      const qb = apply({ tagIds: ['milk', 'misc'] });
      expect(qb.params['gefTagIds']).toEqual(['milk']);
    });

    it('adds no clause for an empty tag list', () => {
      const qb = apply({ tagIds: [] });
      expect(qb.clauses).toEqual([]);
      expect(qb.params['gefTagIds']).toBeUndefined();
    });

    // ── TAG-BATCH-C3 — pre-authorized custom-tag ids join the SAME EXISTS ──────
    it('matches pre-authorized custom-tag ids in one EXISTS with the canonical ids (OR)', () => {
      const qb = apply({ tagIds: ['milk'], customTagIds: ['ct-uuid-1'] });
      expect(qb.clauses.some((c) => c.startsWith('EXISTS'))).toBe(true);
      // One unified namespace, one IN — canonical + custom together (match ANY).
      expect(qb.params['gefTagIds']).toEqual(['milk', 'ct-uuid-1']);
    });

    it('filters by custom-tag ids alone (no canonical selected)', () => {
      const qb = apply({ customTagIds: ['ct-uuid-1', 'ct-uuid-2'] });
      expect(qb.clauses.some((c) => c.startsWith('EXISTS'))).toBe(true);
      expect(qb.params['gefTagIds']).toEqual(['ct-uuid-1', 'ct-uuid-2']);
    });

    it('drops an unknown canonical id but keeps the authorized custom id', () => {
      const qb = apply({ tagIds: ['not-a-tag'], customTagIds: ['ct-uuid-1'] });
      expect(qb.params['gefTagIds']).toEqual(['ct-uuid-1']);
    });

    it('adds no clause when neither canonical nor custom ids resolve', () => {
      const qb = apply({ tagIds: ['not-a-tag'], customTagIds: [] });
      expect(qb.clauses.some((c) => c.startsWith('EXISTS'))).toBe(false);
      expect(qb.params['gefTagIds']).toBeUndefined();
    });
  });
});
