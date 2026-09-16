import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { SettlementsService } from './settlements.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GroupRolesGuard } from '../auth/guards/group-roles.guard';
import { GroupRoles } from '../auth/decorators/group-roles.decorator';
import {
  ProposeSettlementDto,
  RecordPaymentDto,
  UpdateSettlementDto,
} from '@finmate/data-models';
import { SuccessResponse } from '../common/response.util';
import { parseRawGroupExpenseFilter } from '../expenses/group-expense-filters.util';

@Controller('groups/:groupId/settlements')
@UseGuards(JwtAuthGuard, GroupRolesGuard)
export class SettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  @Get('balances')
  @GroupRoles('owner', 'admin', 'member', 'viewer')
  async getBalances(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query() query: Record<string, string>,
    @Req() req: any,
  ) {
    const result = await this.settlementsService.calculateGroupBalances(
      req.user.id,
      groupId,
      parseRawGroupExpenseFilter(query),
    );
    return new SuccessResponse(
      'Group balances calculated successfully',
      result,
    );
  }

  @Post()
  @GroupRoles('owner', 'admin', 'member', 'viewer')
  async propose(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() proposeSettlementDto: ProposeSettlementDto,
    @Req() req: any,
  ) {
    const context = {
      ip:
        req.ip ||
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] as string,
    };
    const result = await this.settlementsService.proposeSettlement(
      req.user.id,
      groupId,
      proposeSettlementDto,
      context,
    );
    return new SuccessResponse('Settlement proposed successfully', result);
  }

  @Post('record')
  @GroupRoles('owner', 'admin', 'member')
  async record(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() recordPaymentDto: RecordPaymentDto,
    @Req() req: any,
  ) {
    const context = {
      ip:
        req.ip ||
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] as string,
    };
    const result = await this.settlementsService.recordPayment(
      req.user.id,
      groupId,
      recordPaymentDto,
      context,
    );
    return new SuccessResponse('Payment recorded successfully', result);
  }

  @Get()
  @GroupRoles('owner', 'admin', 'member', 'viewer')
  async findAll(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Req() req?: any,
  ) {
    let pageNum = page ? parseInt(page, 10) : 1;
    let limitNum = limit ? parseInt(limit, 10) : 20;
    if (isNaN(pageNum) || pageNum <= 0) pageNum = 1;
    if (isNaN(limitNum) || limitNum <= 0) limitNum = 20;
    const result = await this.settlementsService.listSettlements(
      req.user.id,
      groupId,
      pageNum,
      limitNum,
    );
    return new SuccessResponse('Settlements retrieved successfully', result);
  }

  @Patch(':id')
  @GroupRoles('owner', 'admin', 'member', 'viewer')
  async update(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateSettlementDto: UpdateSettlementDto,
    @Req() req: any,
  ) {
    const context = {
      ip:
        req.ip ||
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress,
      userAgent: req.headers['user-agent'] as string,
    };
    const result = await this.settlementsService.updateSettlement(
      req.user.id,
      groupId,
      id,
      updateSettlementDto,
      context,
    );
    return new SuccessResponse('Settlement updated successfully', result);
  }
}
