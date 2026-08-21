import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AuditLog,
  Attachment,
  AttachmentVersion,
  EncryptedExpenseKey,
  Expense,
  ExpenseSplit,
  ExpensePayment,
  ExpenseSplitVersion,
  ExpenseTag,
  ExpenseVersion,
  Group,
  GroupMember,
  User,
  RecurringExpense,
  RecurringExpenseSplit,
  ReceiptVersion,
} from '@finmate/data-models';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { RecurringExpensesController } from './recurring-expenses.controller';
import { RecurringExpensesService } from './services/recurring-expenses.service';
import { RecurringExpensesScheduler } from './services/recurring-expenses.scheduler';
import {
  ExpenseEditPolicyService,
  ExpenseExportQueryService,
  ExpensesAnalyticsService,
  ExpensesCarryForwardService,
  ExpensesCrudService,
} from './services';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Expense,
      ExpenseSplit,
      ExpensePayment,
      ExpenseTag,
      ExpenseVersion,
      ExpenseSplitVersion,
      RecurringExpense,
      RecurringExpenseSplit,
      Group,
      GroupMember,
      User,
      Attachment,
      AttachmentVersion,
      ReceiptVersion,
      AuditLog,
      EncryptedExpenseKey,
    ]),
  ],
  controllers: [ExpensesController, RecurringExpensesController],
  providers: [
    ExpensesService,
    ExpenseEditPolicyService,
    ExpensesAnalyticsService,
    ExpensesCarryForwardService,
    ExpensesCrudService,
    ExpenseExportQueryService,
    RecurringExpensesService,
    RecurringExpensesScheduler,
  ],
  exports: [
    ExpensesService,
    ExpenseEditPolicyService,
    ExpensesAnalyticsService,
    ExpensesCarryForwardService,
    ExpensesCrudService,
    ExpenseExportQueryService,
    RecurringExpensesService,
    RecurringExpensesScheduler,
  ],
})
export class ExpensesModule {}
