import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  Req,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
} from '@nestjs/common';
import { CreateGroupDto, UpdateContributionDto, UpdateGroupDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RecoveryRequiredGuard } from '../recovery/recovery-required.guard';
import { ExpensesCarryForwardService } from '../expenses/services';
import { parseRawGroupExpenseFilter } from '../expenses/group-expense-filters.util';
import {
  GroupsAuditService,
  GroupsContributionsService,
  GroupsCrudService,
  GroupsMembershipService,
} from './services';
import { SuccessResponse } from '../common/response.util';
import { ProvisionGroupKeysDto, RotateGroupKeyDto } from '@finmate/data-models';
import { ThrottleAs } from '../throttler/throttle-policy.decorator';
import { THROTTLE_PROFILES } from '../throttler/throttle.constants';

@Controller('groups')
@UseGuards(JwtAuthGuard)
export class GroupsController {
  constructor(
    private readonly groupsCrudService: GroupsCrudService,
    private readonly groupsMembershipService: GroupsMembershipService,
    private readonly groupsAuditService: GroupsAuditService,
    private readonly groupsContributionsService: GroupsContributionsService,
    private readonly expensesCarryForwardService: ExpensesCarryForwardService,
  ) {}

  @Post()
  async create(
    @Body() createGroupDto: CreateGroupDto,
    @Req()
    req: Request & {
      user: { id: string } & Record<string, unknown>;
      ip?: string;
      socket: { remoteAddress?: string };
    },
  ) {
    const context = {
      ip:
        req.ip ||
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] as string,
    };
    const result = await this.groupsCrudService.createGroup(
      req.user as unknown as Parameters<
        typeof this.groupsCrudService.createGroup
      >[0],
      createGroupDto,
      context,
    );
    return new SuccessResponse('Group created successfully', result);
  }

  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('isArchived') isArchived?: string,
    @Req() req?: Request & { user: { id: string } },
  ) {
    let pageNum = page ? parseInt(page, 10) : 1;
    let limitNum = limit ? parseInt(limit, 10) : 20;
    if (isNaN(pageNum) || pageNum <= 0) pageNum = 1;
    if (isNaN(limitNum) || limitNum <= 0) limitNum = 20;
    const isArchivedBool =
      isArchived === 'true' ? true : isArchived === 'false' ? false : undefined;

    const result = await this.groupsCrudService.listGroups(
      req!.user.id,
      pageNum,
      limitNum,
      isArchivedBool,
    );
    return new SuccessResponse('Groups retrieved successfully', result);
  }

  // REC-1: joining establishes the joiner's wrapped group key (Class-A material).
  @UseGuards(RecoveryRequiredGuard)
  @Post('join/:inviteToken')
  async joinGroupByToken(
    @Param('inviteToken', ParseUUIDPipe) inviteToken: string,
    @Req()
    req: Request & {
      user: { id: string };
      ip?: string;
      socket: { remoteAddress?: string };
    },
  ) {
    const context = {
      ip:
        req.ip ||
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] as string,
    };
    const result = await this.groupsMembershipService.joinGroupByToken(
      req.user.id,
      inviteToken,
      context,
    );
    return new SuccessResponse('Joined group successfully', result);
  }

  @Get('invitations/pending')
  async findPendingInvitations(@Req() req: Request & { user: { id: string } }) {
    const result = await this.groupsMembershipService.getPendingInvitations(
      req.user.id,
    );
    return new SuccessResponse(
      'Pending invitations retrieved successfully',
      result,
    );
  }

  @Post(':id/invites')
  @ThrottleAs(THROTTLE_PROFILES.INVITE)
  async createInvite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { wrappedGroupKey?: string },
    @Req() req: any,
  ) {
    const result = await this.groupsMembershipService.createGroupInvite(
      req.user.id,
      id,
      body,
    );
    return new SuccessResponse('Invite link generated successfully', result);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    const result = await this.groupsCrudService.findGroupById(req.user.id, id);
    return new SuccessResponse('Group retrieved successfully', result);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateGroupDto: UpdateGroupDto,
    @Req()
    req: Request & {
      user: { id: string };
      ip?: string;
      socket: { remoteAddress?: string };
    },
  ) {
    const context = {
      ip:
        req.ip ||
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] as string,
    };
    const result = await this.groupsCrudService.updateGroup(
      req.user.id,
      id,
      updateGroupDto,
      context,
    );
    return new SuccessResponse('Group updated successfully', result);
  }

  /**
   * Archive (soft-delete) a group. Exposed to users as "Delete Group".
   * Restricted to the group owner only — admins, editors, and viewers are rejected.
   */
  @Delete(':id')
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
    @Req()
    req: Request & {
      user: { id: string };
      ip?: string;
      socket: { remoteAddress?: string };
    },
  ) {
    const context = {
      ip:
        req.ip ||
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] as string,
    };
    const result = await this.groupsCrudService.archiveGroup(
      req.user.id,
      id,
      body?.reason,
      context,
    );
    return new SuccessResponse('Group deleted successfully', result);
  }

  @Post(':id/invite-link/regenerate')
  @ThrottleAs(THROTTLE_PROFILES.INVITE)
  async regenerateInviteToken(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    const result = await this.groupsCrudService.regenerateInviteToken(
      req.user.id,
      id,
    );
    return new SuccessResponse('Invite token regenerated successfully', result);
  }

  // ─── Group History ────────────────────────────────────────────────────────

  /**
   * Get the audit history for a group (expense create/update/delete/restore events).
   * All active group members can view the history.
   */
  @Get(':id/history')
  async getHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() req: Request & { user: { id: string } },
  ) {
    const result = await this.groupsAuditService.getGroupHistory(
      req.user.id,
      id,
      page,
      limit,
      { from, to },
    );
    return new SuccessResponse('Group history retrieved successfully', result);
  }

  /**
   * List soft-deleted expenses for the group (for group history / restore UI).
   */
  @Get(':id/expenses/deleted')
  async findDeleted(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query() query: Record<string, string>,
    @Req() req: Request & { user: { id: string } },
  ) {
    const result = await this.expensesCarryForwardService.listDeletedExpenses(
      req.user.id,
      id,
      page,
      limit,
      parseRawGroupExpenseFilter(query),
    );
    return new SuccessResponse(
      'Deleted expenses retrieved successfully',
      result,
    );
  }

  // ─── Carry-Forward Summary ────────────────────────────────────────────────

  /**
   * Get the household carry-forward balance summary for a specific ledger month.
   * Only available for `household` type groups.
   */
  @Get(':id/carry-forward')
  async getCarryForward(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: Record<string, string>,
    @Req() req: Request & { user: { id: string } },
  ) {
    // Range-aware: the household summary now honors the shared TimeScope (date
    // range + preset) passed as query params, aggregating every month in range.
    // An empty range (All Time) yields the full-history figures.
    const filter = parseRawGroupExpenseFilter(query);
    const result =
      await this.expensesCarryForwardService.getHouseholdScopeSummary(
        req.user.id,
        id,
        filter,
      );
    return new SuccessResponse(
      'Carry-forward summary retrieved successfully',
      result,
    );
  }

  @Post(':id/close-month')
  async closeMonth(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { ledgerMonth: string },
    @Req() req: Request & { user: { id: string } },
  ) {
    if (!body || !body.ledgerMonth) {
      throw new BadRequestException('ledgerMonth is required');
    }
    const result = await this.expensesCarryForwardService.closeMonth(
      req.user.id,
      id,
      body.ledgerMonth,
    );
    return new SuccessResponse(
      'Billing month closed and carry-forward balances rolled over successfully',
      result,
    );
  }

  @Get(':id/contributions')
  async getContributions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('month') month: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    const ledgerMonth = month ?? new Date().toISOString().slice(0, 7);
    const result = await this.groupsContributionsService.getContributions(
      req.user.id,
      id,
      ledgerMonth,
    );
    return new SuccessResponse(
      'Group contribution shares retrieved successfully',
      result,
    );
  }

  @Post(':id/contributions')
  async updateContributions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContributionDto,
    @Req() req: Request & { user: { id: string } },
  ) {
    const result = await this.groupsContributionsService.updateContributions(
      req.user.id,
      id,
      dto,
    );
    return new SuccessResponse(
      'Group contribution shares updated successfully',
      result,
    );
  }

  // ─── Group Encryption Keys ──────────────────────────────────────────────

  /**
   * Provision wrapped group data keys for one or more members.
   * The caller must be an active member with the group key loaded.
   */
  // REC-1: provisioning writes wrapped group data keys (Class-A material).
  @UseGuards(RecoveryRequiredGuard)
  @Post(':id/keys')
  async provisionGroupKeys(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ProvisionGroupKeysDto,
    @Req() req: Request & { user: { id: string } },
  ) {
    await this.groupsMembershipService.provisionGroupKeys(
      req.user.id,
      id,
      body.keys,
    );
    return new SuccessResponse('Group keys provisioned successfully', null);
  }

  // REC-1: rotation creates new Class-A key material (precondition only; no
  // change to versionId/rotation semantics — SEC-KI1 untouched).
  @UseGuards(RecoveryRequiredGuard)
  @Post(':id/keys/rotate')
  async rotateGroupKey(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RotateGroupKeyDto,
    @Req() req: Request & { user: { id: string } },
  ) {
    const result = await this.groupsMembershipService.rotateGroupKey(
      req.user.id,
      id,
      body,
    );
    return new SuccessResponse('Group key rotated successfully', result);
  }

  /**
   * Get the caller's wrapped group data key.
   */
  @Get(':id/keys/me')
  async getMyGroupKey(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { id: string } },
    @Query('versionId', new ParseUUIDPipe({ optional: true }))
    versionId?: string,
  ) {
    const result = await this.groupsMembershipService.getMyGroupKey(
      req.user.id,
      id,
      versionId,
    );
    return new SuccessResponse('Group key retrieved', result);
  }

  /**
   * List every key version of the group (metadata only, no key material).
   */
  @Get(':id/keys/versions')
  async listKeyVersions(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { id: string } },
  ) {
    const result = await this.groupsMembershipService.listGroupKeyVersions(
      req.user.id,
      id,
    );
    return new SuccessResponse('Group key versions retrieved', result);
  }

  /**
   * Get list of user IDs in the group who do not have a wrapped group key yet.
   */
  @Get(':id/keys/missing')
  async getMissingKeys(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
  ) {
    const missingUserIds =
      await this.groupsMembershipService.getMissingGroupKeys(req.user.id, id);

    return new SuccessResponse('Missing keys retrieved', missingUserIds);
  }
}
