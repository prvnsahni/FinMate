import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Contact,
  DirectLedgerEntry,
  Expense,
  ExpensePayment,
  ExpenseSplit,
  Group,
  GroupMember,
  Settlement,
  User,
} from '@finmate/data-models';
import { PeopleController } from './people.controller';
import { PersonLedgerService } from './person-ledger.service';
import { ContactsModule } from '../contacts/contacts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contact,
      DirectLedgerEntry,
      Expense,
      ExpensePayment,
      ExpenseSplit,
      Group,
      GroupMember,
      Settlement,
      User,
    ]),
    // P2P-2: read-time Contact claim/merge resolution reuses ContactsService's
    // existing merge/redirect resolver (no second merge mechanism).
    ContactsModule,
  ],
  controllers: [PeopleController],
  providers: [PersonLedgerService],
  exports: [PersonLedgerService],
})
export class PeopleModule {}
