import { BadRequestException } from '@nestjs/common';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import ormDataSource from '../../ormconfig';
import {
  Attachment,
  AuditLog,
  CustomTag,
  EncryptedExpenseKey,
  Expense,
  ExpensePayment,
  ExpenseSplit,
  ExpenseTag,
  ExpenseVersion,
  Group,
  GroupInvite,
  GroupKeyVersion,
  GroupMember,
  GroupMemberContribution,
  MemberWrappedGroupKey,
  RecurringExpense,
  RecurringExpenseSplit,
  Settlement,
  User,
} from '@finmate/data-models';
import { ExpensesService } from './expenses.service';
import { GroupsService } from '../groups/groups.service';
import { ExpenseEditPolicyService } from './services/expense-edit-policy.service';

/**
 * Integration proof for closeMonth/remove-member concurrency invariants on real
 * Postgres using two independent connections.
 *
 * What this proves:
 * - no carry-forward row is ever written naming a departed member;
 * - concurrent closeMonth calls for the same group/month do not double-roll.
 *
 * Opt-in execution:
 * - this suite is intentionally gated; run with RUN_CLOSEMONTH_LOCKING_IT=1.
 * - convenience command: npm run test:integration.
 *
 * Load-bearing regression check:
 * - weakening member FOR SHARE must fail race (a);
 * - removing the group-row FOR UPDATE must fail race (c).
 */

const THROWAWAY_DB = 'finmate_closemonth_locking_it';
const RUN_CLOSEMONTH_LOCKING_IT = process.env.RUN_CLOSEMONTH_LOCKING_IT === '1';
const LEDGER_MONTH = '2026-06';
const NEXT_LEDGER_MONTH = '2026-07';

dotenv.config({ path: '.env' });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: '.env.dev' });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}

function getBaseDbUrl(): URL {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL missing');
  const base = new URL(raw);
  const baseDbName = base.pathname.replace(/^\//, '');
  if (baseDbName === THROWAWAY_DB) {
    throw new Error(
      `Refusing to run: DATABASE_URL points at throwaway DB name (${THROWAWAY_DB})`,
    );
  }
  return base;
}

async function createThrowawayDb(): Promise<string> {
  const base = getBaseDbUrl();
  const admin = new URL(base.toString());
  admin.pathname = '/postgres';

  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [THROWAWAY_DB],
  );
  await client.query(`DROP DATABASE IF EXISTS "${THROWAWAY_DB}"`);
  await client.query(`CREATE DATABASE "${THROWAWAY_DB}"`);
  await client.end();

  const dbUrl = new URL(base.toString());
  dbUrl.pathname = `/${THROWAWAY_DB}`;
  return dbUrl.toString();
}

async function dropThrowawayDb(): Promise<void> {
  const base = getBaseDbUrl();
  const admin = new URL(base.toString());
  admin.pathname = '/postgres';

  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [THROWAWAY_DB],
  );
  await client.query(`DROP DATABASE IF EXISTS "${THROWAWAY_DB}"`);
  await client.end();
}

function createDataSource(url: string): DataSource {
  const opts = {
    ...(ormDataSource.options as DataSourceOptions),
    url,
  } as DataSourceOptions;
  return new DataSource(opts);
}

function makeExpensesService(ds: DataSource): ExpensesService {
  return new ExpensesService(
    ds,
    ds.getRepository(Expense),
    ds.getRepository(ExpenseSplit),
    ds.getRepository(ExpenseTag),
    ds.getRepository(CustomTag),
    ds.getRepository(ExpensePayment),
    ds.getRepository(Group),
    ds.getRepository(GroupMember),
    ds.getRepository(User),
    ds.getRepository(Attachment),
    ds.getRepository(AuditLog),
    ds.getRepository(EncryptedExpenseKey),
    new ExpenseEditPolicyService(undefined as any),
  );
}

function makeGroupsService(
  ds: DataSource,
  balancesService: { assertZeroBalance: (...args: any[]) => Promise<void> },
): GroupsService {
  return new GroupsService(
    ds.getRepository(Group),
    ds.getRepository(GroupMember),
    ds.getRepository(AuditLog),
    ds.getRepository(GroupInvite),
    ds.getRepository(GroupKeyVersion),
    ds.getRepository(MemberWrappedGroupKey),
    ds,
    { get: () => undefined } as any,
    { sendGroupInviteEmail: async () => undefined } as any,
    {} as any,
    balancesService as any,
  );
}

type SeedRefs = {
  ownerUserId: string;
  ownerMemberId: string;
  peerMemberId: string;
  targetMemberId: string;
  groupId: string;
};

async function resetDatabase(ds: DataSource): Promise<void> {
  await ds.query(`
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> 'migrations'
  ) LOOP
    EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
  END LOOP;
END $$;
  `);
}

async function seedScenario(ds: DataSource): Promise<SeedRefs> {
  const ownerUserId = '10000000-0000-4000-8000-000000000001';
  const peerUserId = '10000000-0000-4000-8000-000000000002';
  const targetUserId = '10000000-0000-4000-8000-000000000003';

  const groupId = '20000000-0000-4000-8000-000000000001';

  const ownerMemberId = '30000000-0000-4000-8000-000000000001';
  const peerMemberId = '30000000-0000-4000-8000-000000000002';
  const targetMemberId = '30000000-0000-4000-8000-000000000003';

  await ds.query(
    `INSERT INTO users (id, email, password_hash, display_name, status)
     VALUES
     ($1, 'owner@example.com', 'x', 'Owner', 'active'),
     ($2, 'peer@example.com', 'x', 'Peer', 'active'),
     ($3, 'target@example.com', 'x', 'Target', 'active')`,
    [ownerUserId, peerUserId, targetUserId],
  );

  await ds.query(
    `INSERT INTO groups (id, name, owner_user_id, currency, visibility, is_archived, group_type, carry_forward_enabled)
     VALUES ($1, 'Household', $2, 'USD', 'private', false, 'household', true)`,
    [groupId, ownerUserId],
  );

  await ds.query(
    `INSERT INTO group_members (id, group_id, user_id, role, join_status, joined_at)
     VALUES
     ($1, $4, $5, 'owner', 'active', now()),
     ($2, $4, $6, 'member', 'active', now()),
     ($3, $4, $7, 'member', 'active', now())`,
    [
      ownerMemberId,
      peerMemberId,
      targetMemberId,
      groupId,
      ownerUserId,
      peerUserId,
      targetUserId,
    ],
  );

  await ds.query(
    `INSERT INTO group_member_contributions (id, group_member_id, ledger_month, percentage)
     VALUES
     ('40000000-0000-4000-8000-000000000001', $1, $4, 50.00),
     ('40000000-0000-4000-8000-000000000002', $2, $4, 50.00),
     ('40000000-0000-4000-8000-000000000003', $3, $4, 0.00)`,
    [ownerMemberId, peerMemberId, targetMemberId, LEDGER_MONTH],
  );

  await ds.query(
    `INSERT INTO expenses
     (id, title, description, amount_total, currency, category, paid_by_user_id, paid_by_group_member_id, owner_user_id, group_id, expense_date, ledger_month, status, transaction_type, is_carry_forward)
     VALUES
     ('50000000-0000-4000-8000-000000000001', 'June spend', NULL, 100.00, 'USD', 'Other', NULL, $1, $2, $3, '2026-06-15', $4, 'posted', 'expense', false)`,
    [ownerMemberId, ownerUserId, groupId, LEDGER_MONTH],
  );

  await ds.query(
    `INSERT INTO expense_splits
     (id, expense_id, participant_user_id, participant_group_member_id, split_type, share_value, amount_owed, is_settled)
     VALUES
     ('60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', NULL, $1, 'fixed', 50.00, 50.00, false),
     ('60000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', NULL, $2, 'fixed', 50.00, 50.00, false)`,
    [ownerMemberId, peerMemberId],
  );

  return { ownerUserId, ownerMemberId, peerMemberId, targetMemberId, groupId };
}

async function countCarryForwardRowsNamingDeparted(
  ds: DataSource,
  groupId: string,
  memberId: string,
): Promise<number> {
  const rows = await ds.query(
    `SELECT COUNT(*)::int AS count
     FROM expenses e
     LEFT JOIN expense_splits es
       ON es.expense_id = e.id AND es.deleted_at IS NULL
     LEFT JOIN group_members gm_p
       ON gm_p.id = e.paid_by_group_member_id
     LEFT JOIN group_members gm_s
       ON gm_s.id = es.participant_group_member_id
     WHERE e.group_id = $1
       AND e.is_carry_forward = true
       AND (
         (e.paid_by_group_member_id = $2 AND gm_p.join_status IN ('left','removed'))
         OR
         (es.participant_group_member_id = $2 AND gm_s.join_status IN ('left','removed'))
       )`,
    [groupId, memberId],
  );
  return Number(rows[0]?.count ?? 0);
}

const describeCloseMonthLockingIT = RUN_CLOSEMONTH_LOCKING_IT
  ? describe
  : describe.skip;

describeCloseMonthLockingIT(
  'closeMonth FOR SHARE locking (integration, real postgres)',
  () => {
    let migrated: DataSource;
    let dsA: DataSource;
    let dsB: DataSource;

    beforeAll(async () => {
      const throwawayUrl = await createThrowawayDb();
      migrated = createDataSource(throwawayUrl);
      await migrated.initialize();
      await migrated.runMigrations();

      dsA = createDataSource(throwawayUrl);
      dsB = createDataSource(throwawayUrl);
      await dsA.initialize();
      await dsB.initialize();
    }, 120000);

    afterAll(async () => {
      if (dsA?.isInitialized) await dsA.destroy();
      if (dsB?.isInitialized) await dsB.destroy();
      if (migrated?.isInitialized) await migrated.destroy();
      await dropThrowawayDb();
    }, 120000);

    beforeEach(async () => {
      await resetDatabase(dsA);
    });

    it('race (a): closeMonth lock then remove mid-flight blocks until closeMonth advances', async () => {
      const refs = await seedScenario(dsA);

      const closeSvc = makeExpensesService(dsA);
      const groupsSvc = makeGroupsService(dsB, {
        assertZeroBalance: async () => undefined,
      });

      const original =
        closeSvc.getCarryForwardSummaryInTransaction.bind(closeSvc);
      let reachedWindow!: () => void;
      const reachedWindowP = new Promise<void>((resolve) => {
        reachedWindow = resolve;
      });
      let releaseWindow!: () => void;
      const releaseWindowP = new Promise<void>((resolve) => {
        releaseWindow = resolve;
      });

      jest
        .spyOn(closeSvc, 'getCarryForwardSummaryInTransaction')
        .mockImplementation(async (...args: any[]) => {
          reachedWindow();
          await releaseWindowP;
          return original(...(args as [string, string, string, any]));
        });

      const closeP = closeSvc.closeMonth(
        refs.ownerUserId,
        refs.groupId,
        LEDGER_MONTH,
      );
      await withTimeout(reachedWindowP, 10000, 'reach between lock and reread');

      const removeP = groupsSvc.removeMember(
        refs.ownerUserId,
        refs.groupId,
        refs.targetMemberId,
      );

      try {
        const removeState = await Promise.race([
          removeP.then(() => 'done'),
          delay(400).then(() => 'pending'),
        ]);
        expect(removeState).toBe('pending');
      } finally {
        releaseWindow();
      }

      await withTimeout(closeP, 15000, 'closeMonth completion');
      await withTimeout(removeP, 15000, 'remove completion');

      const departedCarryRows = await countCarryForwardRowsNamingDeparted(
        dsA,
        refs.groupId,
        refs.targetMemberId,
      );
      expect(departedCarryRows).toBe(0);
    }, 40000);

    it('race (b): remove first then closeMonth mid-flight preserves invariant', async () => {
      const refs = await seedScenario(dsA);

      let holdZeroBalance!: () => void;
      const holdZeroBalanceP = new Promise<void>((resolve) => {
        holdZeroBalance = resolve;
      });
      let releaseZeroBalance!: () => void;
      const releaseZeroBalanceP = new Promise<void>((resolve) => {
        releaseZeroBalance = resolve;
      });

      const groupsSvc = makeGroupsService(dsA, {
        assertZeroBalance: async () => {
          holdZeroBalance();
          await releaseZeroBalanceP;
        },
      });
      const closeSvc = makeExpensesService(dsB);

      const removeP = groupsSvc.removeMember(
        refs.ownerUserId,
        refs.groupId,
        refs.targetMemberId,
      );
      await withTimeout(
        holdZeroBalanceP,
        10000,
        'remove reaches zero-balance gate',
      );

      const closeP = closeSvc.closeMonth(
        refs.ownerUserId,
        refs.groupId,
        LEDGER_MONTH,
      );
      const closeState = await Promise.race([
        closeP.then(() => 'done'),
        delay(400).then(() => 'pending'),
      ]);
      expect(closeState).toBe('pending');

      releaseZeroBalance();

      await withTimeout(removeP, 15000, 'remove completion');
      await withTimeout(closeP, 15000, 'close completion');

      const departedCarryRows = await countCarryForwardRowsNamingDeparted(
        dsA,
        refs.groupId,
        refs.targetMemberId,
      );
      expect(departedCarryRows).toBe(0);
    }, 40000);

    it('race (c): two concurrent closeMonth calls for same group/month -> exactly one succeeds', async () => {
      const refs = await seedScenario(dsA);

      const closeA = makeExpensesService(dsA);
      const closeB = makeExpensesService(dsB);

      const [r1, r2] = await withTimeout(
        Promise.allSettled([
          closeA.closeMonth(refs.ownerUserId, refs.groupId, LEDGER_MONTH),
          closeB.closeMonth(refs.ownerUserId, refs.groupId, LEDGER_MONTH),
        ]),
        30000,
        'concurrent closeMonth race',
      );

      const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled');
      const rejected = [r1, r2].filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejection = rejected[0] as PromiseRejectedResult;
      expect(rejection.reason).toBeInstanceOf(BadRequestException);

      const cfRows = await dsA.query(
        `SELECT COUNT(*)::int AS count
       FROM expenses
       WHERE group_id = $1
         AND ledger_month = $2
         AND is_carry_forward = true`,
        [refs.groupId, NEXT_LEDGER_MONTH],
      );
      expect(Number(cfRows[0]?.count ?? 0)).toBe(1);
    }, 40000);

    it('race (d): remove-member expense scans + closeMonth writes complete without deadlock', async () => {
      const refs = await seedScenario(dsA);

      const groupsSvc = makeGroupsService(dsA, {
        assertZeroBalance: async () => {
          await delay(250);
        },
      });
      const closeSvc = makeExpensesService(dsB);

      const removeP = groupsSvc.removeMember(
        refs.ownerUserId,
        refs.groupId,
        refs.targetMemberId,
      );
      await delay(40);
      const closeP = closeSvc.closeMonth(
        refs.ownerUserId,
        refs.groupId,
        LEDGER_MONTH,
      );

      await withTimeout(
        Promise.all([removeP, closeP]),
        30000,
        'remove/close interleaving',
      );

      const departedCarryRows = await countCarryForwardRowsNamingDeparted(
        dsA,
        refs.groupId,
        refs.targetMemberId,
      );
      expect(departedCarryRows).toBe(0);
    }, 40000);
  },
);
