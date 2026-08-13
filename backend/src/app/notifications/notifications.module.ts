import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '@finmate/data-models';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationStateService } from './notification-state.service';
import { SecurityEventNotificationProvider } from './providers/security-event.provider';
import { NOTIFICATION_PROVIDERS } from './notification-candidate.provider';

/**
 * In-app ranked notifications (BATCH-12 / W-NOT-01). Computed and read-only — no
 * notifications table. FeatureFlagsService (PlatformModule) and RedisService
 * (RedisModule) are global. AuditLog is read-only for the security-event provider.
 * Additional providers can be added to the NOTIFICATION_PROVIDERS array without
 * changing the controller or the API contract.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationStateService,
    SecurityEventNotificationProvider,
    {
      provide: NOTIFICATION_PROVIDERS,
      useFactory: (security: SecurityEventNotificationProvider) => [security],
      inject: [SecurityEventNotificationProvider],
    },
  ],
})
export class NotificationsModule {}
