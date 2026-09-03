import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { NotificationControl } from './notification.types';

export class SetNotificationControlDto {
  @IsIn(['quieter', 'standard', 'off'], {
    message: 'control must be one of: quieter, standard, off',
  })
  control!: NotificationControl;
}

export class MarkNotificationDto {
  /** When true the item is "acted" (also suppressed); otherwise just "seen". */
  @IsOptional()
  @IsBoolean()
  acted?: boolean;
}
