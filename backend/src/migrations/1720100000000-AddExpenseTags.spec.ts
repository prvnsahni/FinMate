import { QueryRunner } from 'typeorm';
import { AddExpenseTags1720100000000 } from './1720100000000-AddExpenseTags';

/**
 * TAG-BATCH-A — guards the `expense_tags` migration's safety contract: additive,
 * reversible, no backfill, cascade on expense delete, no touching of existing
 * (financial) columns.
 */
describe('AddExpenseTags1720100000000', () => {
  const runMigration = async (method: 'up' | 'down'): Promise<string[]> => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
      }),
    } as unknown as QueryRunner;
    await new AddExpenseTags1720100000000()[method](queryRunner);
    return queries;
  };

  it('up() creates ONLY the expense_tags table and its indexes (additive)', async () => {
    const sql = (await runMigration('up')).join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "expense_tags"');
    // No ALTER/DROP of any existing table — purely additive.
    expect(sql).not.toMatch(/ALTER TABLE/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
    // Never touches the expenses financial columns.
    expect(sql).not.toMatch(
      /amount_total|currency|paid_by|split|refund|settlement/i,
    );
  });

  it('cascades on expense delete and nulls provenance on user delete', async () => {
    const sql = (await runMigration('up')).join('\n');
    expect(sql).toMatch(
      /"expense_id"[\s\S]*REFERENCES "expenses"\("id"\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /"created_by_user_id"[\s\S]*REFERENCES "users"\("id"\) ON DELETE SET NULL/,
    );
  });

  it('performs NO backfill (no INSERT/UPDATE of historical rows)', async () => {
    const sql = (await runMigration('up')).join('\n');
    expect(sql).not.toMatch(/INSERT INTO/i);
    expect(sql).not.toMatch(/UPDATE /i);
  });

  it('down() is reversible — drops only the new table', async () => {
    const sql = (await runMigration('down')).join('\n');
    expect(sql).toContain('DROP TABLE IF EXISTS "expense_tags"');
    expect(sql).not.toMatch(/expenses|users|expense_splits/);
  });

  it('enforces one row per (expense, tag) and indexes tag for lookup', async () => {
    const sql = (await runMigration('up')).join('\n');
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*"expense_tags" \("expense_id", "tag_id"\)/,
    );
    expect(sql).toMatch(/CREATE INDEX[\s\S]*"expense_tags" \("tag_id"\)/);
  });
});
