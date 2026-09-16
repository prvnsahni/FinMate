import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Group,
  GroupMember,
  Expense,
  ExpenseSplit,
  ExpensePayment,
  Settlement,
  SettlementVersion,
  AuditLog,
} from '@finmate/data-models';
import { SettlementsService } from './settlements.service';
import { BalancesService } from './balances.service';
import { SettlementsController } from './settlements.controller';
import { FriendsController } from './friends.controller';
import { GroupRolesGuard } from '../auth/guards/group-roles.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Group,
      GroupMember,
      Expense,
      ExpenseSplit,
      ExpensePayment,
      Settlement,
      SettlementVersion,
      AuditLog,
    ]),
  ],
  controllers: [SettlementsController, FriendsController],
  providers: [SettlementsService, BalancesService, GroupRolesGuard],
  exports: [SettlementsService, BalancesService],
})
export class SettlementsModule {}
