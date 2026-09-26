import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { IdentityModule } from "../identity/identity.module";
import { WalletModule } from "../wallet/wallet.module";
import { CampaignModule, CAMPAIGN_DB } from "../campaign/campaign.module";
import { ME_PG_POOL } from "./me.tokens";
import {
  CONSENT_RECORD_REPOSITORY,
  DrizzleConsentRecordRepository,
} from "./persistence/consent-record.repository";
import { INTEREST_REPOSITORY, DrizzleInterestRepository } from "./persistence/interest.repository";
import { FOLLOW_REPOSITORY, DrizzleFollowRepository } from "./persistence/follow.repository";
import { SAVE_REPOSITORY, DrizzleSaveRepository } from "./persistence/save.repository";
import {
  LINK_CODE_REPOSITORY,
  DrizzleLinkCodeRepository,
} from "./persistence/link-code.repository";
import {
  STREAK_STATE_REPOSITORY,
  DrizzleStreakStateRepository,
} from "./persistence/streak-state.repository";
import {
  NOTIFICATION_REPOSITORY,
  DrizzleNotificationRepository,
} from "./persistence/notification.repository";
import {
  COMPLETED_WATCH_DAYS_READER,
  DrizzleCompletedWatchDaysReader,
} from "./persistence/completed-watch-days.reader";
import {
  CONTINUE_WATCHING_READER,
  DrizzleContinueWatchingReader,
} from "./persistence/continue-watching.reader";
import {
  FOLLOWABLE_BUSINESS_READER,
  DrizzleFollowableBusinessReader,
} from "./persistence/followable-business.reader";
import { ConsentController } from "./consent.controller";
import { InterestsController } from "./interests.controller";
import { FollowsController } from "./follows.controller";
import { SavesController } from "./saves.controller";
import { SessionsController } from "./sessions.controller";
import { StreakController } from "./streak.controller";
import { NotificationsController } from "./notifications.controller";
import { AccountController } from "./account.controller";
import { LinkedAppsController } from "./linked-apps.controller";
import { StreakService } from "./streak.service";

export const ME_DB = Symbol("ME_DB");

/**
 * The viewer's own API (5.4/5.5): consents, interests, follows, saves,
 * continue-watching, streak and notifications. Shares `CampaignModule`'s DB
 * handle for reading campaigns (saves' existence check) rather than opening
 * a third pool onto the same database; imports `IdentityModule` for the
 * user-profile read (trust tier, for the streak grant) and `WalletModule`
 * for the ledger client (grantAction/coverage/settings).
 */
@Module({
  imports: [IdentityModule, WalletModule, CampaignModule],
  controllers: [
    ConsentController,
    InterestsController,
    FollowsController,
    SavesController,
    SessionsController,
    StreakController,
    NotificationsController,
    AccountController,
    LinkedAppsController,
  ],
  providers: [
    {
      provide: ME_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: ME_PG_POOL,
      useFactory: (config: AppConfig) => new Pool({ connectionString: config.databaseUrl }),
      inject: [APP_CONFIG],
    },
    {
      provide: CONSENT_RECORD_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleConsentRecordRepository(db),
      inject: [ME_DB],
    },
    {
      provide: INTEREST_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleInterestRepository(db),
      inject: [ME_DB],
    },
    {
      provide: FOLLOW_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleFollowRepository(db),
      inject: [ME_DB],
    },
    {
      provide: SAVE_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleSaveRepository(db),
      inject: [ME_DB],
    },
    {
      provide: LINK_CODE_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleLinkCodeRepository(db),
      inject: [ME_DB],
    },
    {
      provide: STREAK_STATE_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleStreakStateRepository(db),
      inject: [ME_DB],
    },
    {
      provide: NOTIFICATION_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleNotificationRepository(db),
      inject: [ME_DB],
    },
    {
      provide: COMPLETED_WATCH_DAYS_READER,
      // Same physical database as CampaignModule's own handle — reused
      // rather than opened a second time, same convention WatchModule
      // follows for its own repository.
      useFactory: (db: AppDb) => new DrizzleCompletedWatchDaysReader(db),
      inject: [CAMPAIGN_DB],
    },
    {
      provide: CONTINUE_WATCHING_READER,
      useFactory: (db: AppDb) => new DrizzleContinueWatchingReader(db),
      inject: [CAMPAIGN_DB],
    },
    {
      provide: FOLLOWABLE_BUSINESS_READER,
      useFactory: (db: AppDb) => new DrizzleFollowableBusinessReader(db),
      inject: [ME_DB],
    },
    StreakService,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class MeModule {}
