import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import {
  User,
  Profile,
  Contact,
  Group,
  GroupMember,
  GroupMemberContribution,
  CustomTag,
  Expense,
  ExpenseSplit,
  ExpensePayment,
  ExpenseSplitVersion,
  ExpenseTag,
  ExpenseVersion,
  DirectLedgerEntry,
  Settlement,
  SettlementVersion,
  Note,
  Goal,
  Attachment,
  AttachmentVersion,
  AuditLog,
  RecurringExpense,
  RecurringExpenseSplit,
  GroupInvite,
  EncryptedGroupKey,
  EncryptedExpenseKey,
  GroupKeyVersion,
  MemberWrappedGroupKey,
  ReceiptVersion,
  PublicShare,
} from '@finmate/data-models';
import * as Migrations from './migrations';
import { SnakeNamingStrategy } from './app/common/snake-naming-strategy';

dotenv.config({ path: '.env' });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: '.env.dev' });
}

const sslEnabled = process.env.DB_SSL === 'true';
const sslRejectUnauthorized =
  process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
const ssl = sslEnabled
  ? { rejectUnauthorized: sslRejectUnauthorized }
  : undefined;

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl,
  entities: [
    User,
    Profile,
    Contact,
    Group,
    GroupMember,
    GroupMemberContribution,
    CustomTag,
    Expense,
    ExpenseSplit,
    ExpensePayment,
    ExpenseTag,
    ExpenseVersion,
    ExpenseSplitVersion,
    DirectLedgerEntry,
    RecurringExpense,
    RecurringExpenseSplit,
    Settlement,
    SettlementVersion,
    Note,
    Goal,
    Attachment,
    AttachmentVersion,
    ReceiptVersion,
    AuditLog,
    GroupInvite,
    EncryptedGroupKey,
    EncryptedExpenseKey,
    GroupKeyVersion,
    MemberWrappedGroupKey,
    PublicShare,
  ],
  migrations: [...Object.values(Migrations)],
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
});
