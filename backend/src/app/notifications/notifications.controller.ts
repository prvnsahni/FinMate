import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { SuccessResponse } from '../common/response.util';
import { ThrottleAs } from '../throttler/throttle-policy.decorator';
import { THROTTLE_PROFILES } from '../throttler/throttle.constants';
import { NotificationsService } from './notifications.service';
import { MarkNotificationDto, SetNotificationControlDto } from './notifications.dto';

/**
 * In-app ranked notifications (BATCH-12). Additive, authenticated, throttled, and
 * inert while the `notifications.inApp` flag is OFF. First-party display only — no
 * OS push, no AI, no external providers.
 */
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Ranked notifications for the caller. `?whileAway=true` applies the WYWA cap. */
  @Get()
  @ThrottleAs(THROTTLE_PROFILES.DEFAULT)
  async list(
    @Req() req: RequestWithUser,
    @Query('whileAway') whileAway?: string,
  ) {
    const result = await this.notifications.getNotifications(
      req.user.id,
      whileAway === 'true',
    );
    return new SuccessResponse('Notifications retrieved', result);
  }

  /** Mark a notification seen (or acted). Idempotent; scoped to the caller. */
  @Post(':id/seen')
  @ThrottleAs(THROTTLE_PROFILES.DEFAULT)
  @HttpCode(HttpStatus.OK)
  async markSeen(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: MarkNotificationDto,
  ) {
    await this.notifications.markState(req.user.id, id, dto?.acted === true);
    return new SuccessResponse('Notification updated', {});
  }

  /** Set the caller's 3-way control (quieter / standard / off). */
  @Put('preferences')
  @ThrottleAs(THROTTLE_PROFILES.DEFAULT)
  @HttpCode(HttpStatus.OK)
  async setPreferences(
    @Req() req: RequestWithUser,
    @Body() dto: SetNotificationControlDto,
  ) {
    const control = await this.notifications.setControl(
      req.user.id,
      dto.control,
    );
    return new SuccessResponse('Notification preferences updated', { control });
  }
}
