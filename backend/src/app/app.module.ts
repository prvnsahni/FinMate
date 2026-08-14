import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import { ThrottlerRedisStorage } from './throttler/throttler-redis.storage';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConditionalThrottleGuard } from './guards/conditional-throttle.guard';
import { UserThrottlerGuard } from './guards/user-throttler.guard';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { validate } from './env.validation';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import * as Migrations from '../migrations';
import { SnakeNamingStrategy } from './common/snake-naming-strategy';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { GroupsModule } from './groups/groups.module';
import { ContactsModule } from './contacts/contacts.module';
import { ExpensesModule } from './expenses/expenses.module';
import { SettlementsModule } from './settlements/settlements.module';
import { PeopleModule } from './people/people.module';
import { ImportModule } from './import/import.module';
import { AiModule } from './ai/ai.module';
import { EmailModule } from './email/email.module';
import { PlatformModule } from './platform/platform.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RecoveryModule } from './recovery/recovery.module';
import { Note, Goal, AuditLog } from '@finmate/data-models';
import { ThrottlerConfigModule } from './throttler/throttler-config.module';
import { ThrottlePolicyResolver } from './throttler/throttle-policy.resolver';
import { THROTTLE_PROFILES } from './throttler/throttle.constants';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, RedisModule, ThrottlerConfigModule],
      inject: [ConfigService, RedisService, ThrottlePolicyResolver],
      useFactory: (
        config: ConfigService,
        redisService: RedisService,
        resolver: ThrottlePolicyResolver,
      ) => {
        const envNode = config.get('NODE_ENV') || process.env.NODE_ENV;
        // Detect automated E2E/test contexts and disable throttling there.
        // Conditions covered:
        // - NODE_ENV === 'test'
        // - explicit THROTTLE_SKIP=true (env or config)
        // - NX orchestrator running an e2e target (NX_TASK_TARGET / NX_TASK_ID)
        // - Playwright worker environments (PLAYWRIGHT_WORKER_INDEX / PLAYWRIGHT_TEST)
        // - generic E2E flag (E2E=true)
        const isTest =
          envNode === 'test' ||
          config.get('THROTTLE_SKIP') === 'true' ||
          process.env.THROTTLE_SKIP === 'true' ||
          String(
            process.env.NX_TASK_TARGET || process.env.NX_TASK_ID || '',
          ).includes('e2e') ||
          typeof process.env.PLAYWRIGHT_WORKER_INDEX !== 'undefined' ||
          process.env.PLAYWRIGHT_TEST === '1' ||
          process.env.E2E === 'true';
        const getLimit = (key: string, defaultValue: number) => {
          if (isTest) return 10000;
          return Number(config.get(key)) || defaultValue;
        };

        // Helper: creates a skipIf callback that skips a named throttler
        // unless the route's resolved policy matches it.
        const skipUnlessPolicy = (profileName: string) => {
          return (ctx: any) => resolver.resolvePolicy(ctx) !== profileName;
        };

        const throttlers = [
          {
            name: THROTTLE_PROFILES.DEFAULT,
            ttl: 60000,
            limit: getLimit('THROTTLE_LIMIT_DEFAULT', 100),
            skipIf: skipUnlessPolicy(THROTTLE_PROFILES.DEFAULT),
          },
          {
            name: THROTTLE_PROFILES.LOGIN,
            ttl: 60000,
            limit: getLimit('THROTTLE_LIMIT_LOGIN', 5),
            skipIf: skipUnlessPolicy(THROTTLE_PROFILES.LOGIN),
          },
          {
            name: THROTTLE_PROFILES.REGISTER,
            ttl: 60000,
            limit: getLimit('THROTTLE_LIMIT_REGISTER', 5),
            skipIf: skipUnlessPolicy(THROTTLE_PROFILES.REGISTER),
          },
          {
            name: THROTTLE_PROFILES.FORGOT_PASSWORD,
            ttl: 60000,
            limit: getLimit('THROTTLE_LIMIT_FORGOT', 3),
            skipIf: skipUnlessPolicy(THROTTLE_PROFILES.FORGOT_PASSWORD),
          },
          {
            name: THROTTLE_PROFILES.RESET_PASSWORD,
            ttl: 60000,
            limit: getLimit('THROTTLE_LIMIT_RESET', 3),
            skipIf: skipUnlessPolicy(THROTTLE_PROFILES.RESET_PASSWORD),
          },
          {
            name: THROTTLE_PROFILES.OTP,
            ttl: 60000,
            limit: getLimit('THROTTLE_LIMIT_OTP', 5),
            skipIf: skipUnlessPolicy(THROTTLE_PROFILES.OTP),
          },
          {
            name: THROTTLE_PROFILES.REFRESH,
            ttl: 60000,
            limit: getLimit('THROTTLE_LIMIT_REFRESH', 15),
            skipIf: skipUnlessPolicy(THROTTLE_PROFILES.REFRESH),
          },
          {
            name: THROTTLE_PROFILES.INVITE,
            ttl: 60000,
            limit: getLimit('THROTTLE_LIMIT_INVITE', 10),
            skipIf: skipUnlessPolicy(THROTTLE_PROFILES.INVITE),
          },
          {
            name: THROTTLE_PROFILES.IMPORT,
            ttl: 60000,
            limit: getLimit('THROTTLE_LIMIT_IMPORT', 10),
            skipIf: skipUnlessPolicy(THROTTLE_PROFILES.IMPORT),
          },
          {
            name: THROTTLE_PROFILES.EXPORT,
            ttl: 60000,
            limit: getLimit('THROTTLE_LIMIT_EXPORT', 20),
            skipIf: skipUnlessPolicy(THROTTLE_PROFILES.EXPORT),
          },
        ];

        return {
          storage: new ThrottlerRedisStorage(redisService),
          throttlers,
        };
      },
    }),
    RedisModule,
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.dev'],
      validate,
    }),
    TypeOrmModule.forFeature([Note, Goal, AuditLog]),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const sslEnabled = configService.get<string>('DB_SSL') === 'true';
        const sslRejectUnauthorized =
          configService.get<string>('DB_SSL_REJECT_UNAUTHORIZED') !== 'false';
        const ssl = sslEnabled
          ? { rejectUnauthorized: sslRejectUnauthorized }
          : undefined;

        return {
          type: 'postgres',
          url: configService.get<string>('DATABASE_URL'),
          ssl,
          autoLoadEntities: true,
          synchronize: false, // never true in production
          migrations: [...Object.values(Migrations)],
          migrationsRun: true,
          namingStrategy: new SnakeNamingStrategy(),
        };
      },
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
    GroupsModule,
    ContactsModule,
    ExpensesModule,
    SettlementsModule,
    PeopleModule,
    ImportModule,
    AiModule,
    EmailModule,
    PlatformModule,
    NotificationsModule,
    RecoveryModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: ThrottlerGuard, useClass: UserThrottlerGuard },
    { provide: APP_GUARD, useClass: ConditionalThrottleGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
