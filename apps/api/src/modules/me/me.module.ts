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
import {
  VIEWER_SETTING_REPOSITORY,
  DrizzleViewerSettingRepository,
  AUTOPLAY_SETTING_READER,
  DrizzleAutoplaySettingReader,
} from "./persistence/viewer-setting.repository";
import { ConsentController } from "./consent.controller";
import { InterestsController } from "./interests.controller";
import { FollowsController } from "./follows.controller";
import { SavesController } from "./saves.controller";
import { SessionsController } from "./sessions.controller";
import { StreakController } from "./streak.controller";
import { NotificationsController } from "./notifications.controller";
import { AccountController } from "./account.controller";
import { LinkedAppsController } from "./linked-apps.controller";
import { SettingsController } from "./settings.controller";
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
    SettingsController,
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
    {
      provide: VIEWER_SETTING_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleViewerSettingRepository(db),
      inject: [ME_DB],
    },
    {
      provide: AUTOPLAY_SETTING_READER,
      useFactory: (repository: DrizzleViewerSettingRepository) =>
        new DrizzleAutoplaySettingReader(repository),
      inject: [VIEWER_SETTING_REPOSITORY],
    },
    StreakService,
  ],
  // `StreakService` is exported for `WatchCompletionHookModule` (5.5.d) —
  // the neutral module `WatchModule` will import instead of providing
  // `NoopWatchCompletionHook` locally (see that module's own header).
  // `AUTOPLAY_SETTING_READER` is exported for 6.3's feed module to inject
  // once it exists (TASKS.md 6.7.a: "a small reader the feed can use") —
  // nothing imports MeModule for either export yet.
  exports: [StreakService, AUTOPLAY_SETTING_READER],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class MeModule {}
