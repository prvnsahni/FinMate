import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AuditLog,
  EncryptedGroupKey,
  Group,
  GroupKeyVersion,
  GroupMember,
  GroupMemberContribution,
  GroupInvite,
  MemberWrappedGroupKey,
} from '@finmate/data-models';
import { GroupsService } from './groups.service';
import { GroupsController } from './groups.controller';
import { MembersController } from './members.controller';
import { InviteController } from './invite.controller';
import { GroupRolesGuard } from '../auth/guards/group-roles.guard';
import { ExpensesModule } from '../expenses/expenses.module';
import { EmailModule } from '../email/email.module';
import { ContactsModule } from '../contacts/contacts.module';
import { SettlementsModule } from '../settlements/settlements.module';
import {
  GroupsAuditService,
  GroupsContributionsService,
  GroupsCrudService,
  GroupsMembershipService,
} from './services';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Group,
      GroupMember,
      GroupMemberContribution,
      AuditLog,
      EncryptedGroupKey,
      GroupInvite,
      GroupKeyVersion,
      MemberWrappedGroupKey,
    ]),
    ExpensesModule,
    EmailModule,
    ContactsModule,
    SettlementsModule,
  ],
  controllers: [GroupsController, MembersController, InviteController],
  providers: [
    GroupsService,
    GroupsAuditService,
    GroupsContributionsService,
    GroupsCrudService,
    GroupsMembershipService,
    GroupRolesGuard,
  ],
  exports: [
    GroupsService,
    GroupsAuditService,
    GroupsContributionsService,
    GroupsCrudService,
    GroupsMembershipService,
  ],
})
export class GroupsModule {}
