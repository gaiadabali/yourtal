import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { CampaignModule } from "../campaign/campaign.module";
import { WalletModule } from "../wallet/wallet.module";
import { StoreModule } from "../store/store.module";
import { SettingsModule } from "../../shared/settings/settings.module";
import { FeedController } from "./feed.controller";
import { FEED_SIGNALS_REPOSITORY } from "./persistence/feed-signals.repository";
import { DrizzleFeedSignalsRepository } from "./persistence/drizzle-feed-signals.repository";
import { PACING_STATE_REPOSITORY } from "./persistence/pacing-state.repository";
import { DrizzlePacingStateRepository } from "./persistence/drizzle-pacing-state.repository";
import { CHANNEL_SEARCH_REPOSITORY } from "./persistence/channel-search.repository";
import { DrizzleChannelSearchRepository } from "./persistence/drizzle-channel-search.repository";
import { SUSPENDED_BUSINESS_LOOKUP } from "./persistence/suspended-business-lookup";
import { DrizzleSuspendedBusinessLookup } from "./persistence/drizzle-suspended-business-lookup";

export const FEED_DB = Symbol("FEED_DB");

/**
 * 7.7: the feed/discovery engine. Reads `campaign.*` through
 * `CampaignModule`'s exported `CAMPAIGN_REPOSITORY` (never its own Drizzle
 * tables), ledger allocations through `WalletModule`'s
 * `LEDGER_INTERNAL_CLIENT`, listings through `StoreModule`'s exported
 * `LISTING_REPOSITORY`, and everything else (`me.follow`, `me.interest`,
 * `identity.consent_record`, `watch.session`) through its own raw-SQL
 * `FeedSignalsRepository` -- see that file's own doc comment for why not
 * those modules' repositories directly.
 *
 * `feed.pacing_state` and `feed.demotion` (7.7.b) are this module's own
 * tables, migration `20260927150000_feed_module.sql`.
 */
@Module({
  imports: [CampaignModule, WalletModule, StoreModule, SettingsModule],
  controllers: [FeedController],
  providers: [
    {
      provide: FEED_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: FEED_SIGNALS_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleFeedSignalsRepository(db),
      inject: [FEED_DB],
    },
    {
      provide: PACING_STATE_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzlePacingStateRepository(db),
      inject: [FEED_DB],
    },
    {
      provide: CHANNEL_SEARCH_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleChannelSearchRepository(db),
      inject: [FEED_DB],
    },
    {
      provide: SUSPENDED_BUSINESS_LOOKUP,
      useFactory: (db: AppDb) => new DrizzleSuspendedBusinessLookup(db),
      inject: [FEED_DB],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class FeedModule {}
