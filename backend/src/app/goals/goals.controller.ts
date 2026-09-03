import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RecoveryRequiredGuard } from '../recovery/recovery-required.guard';
import { GoalsEnabledGuard } from './goals-enabled.guard';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { SuccessResponse } from '../common/response.util';
import { ThrottleAs } from '../throttler/throttle-policy.decorator';
import { THROTTLE_PROFILES } from '../throttler/throttle.constants';
import { GoalsService } from './goals.service';
import { CreateGoalDto, UpdateGoalDto } from './dto/goal.dto';

/**
 * Goals-v2 (BATCH-11). Additive, authenticated, throttled, owner-scoped. The
 * whole surface is gated behind `feature.goals` (GoalsEnabledGuard → 404 when
 * OFF). Creating a goal establishes new Class-A key material, so it also passes
 * the REC-1 RecoveryRequiredGuard.
 */
@UseGuards(JwtAuthGuard, GoalsEnabledGuard)
@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @UseGuards(RecoveryRequiredGuard)
  @Post()
  @ThrottleAs(THROTTLE_PROFILES.DEFAULT)
  async create(@Body() dto: CreateGoalDto, @Req() req: RequestWithUser) {
    const goal = await this.goals.create(req.user.id, dto);
    return new SuccessResponse('Goal created successfully', goal);
  }

  @Get()
  @ThrottleAs(THROTTLE_PROFILES.DEFAULT)
  async list(@Req() req: RequestWithUser) {
    const goals = await this.goals.list(req.user.id);
    return new SuccessResponse('Goals retrieved successfully', goals);
  }

  @Get(':id')
  @ThrottleAs(THROTTLE_PROFILES.DEFAULT)
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ) {
    const goal = await this.goals.get(req.user.id, id);
    return new SuccessResponse('Goal retrieved successfully', goal);
  }

  @Get(':id/projection')
  @ThrottleAs(THROTTLE_PROFILES.DEFAULT)
  async projection(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
    @Query('assumedMonthlyContribution') assumed?: string,
  ) {
    const n = assumed != null && assumed !== '' ? Number(assumed) : undefined;
    const result = await this.goals.project(
      req.user.id,
      id,
      Number.isFinite(n) ? n : undefined,
    );
    return new SuccessResponse('Goal projection computed', result);
  }

  @Patch(':id')
  @ThrottleAs(THROTTLE_PROFILES.DEFAULT)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGoalDto,
    @Req() req: RequestWithUser,
  ) {
    const goal = await this.goals.update(req.user.id, id, dto);
    return new SuccessResponse('Goal updated successfully', goal);
  }

  @Delete(':id')
  @ThrottleAs(THROTTLE_PROFILES.DEFAULT)
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ) {
    await this.goals.remove(req.user.id, id);
    return new SuccessResponse('Goal deleted successfully', {});
  }
}
