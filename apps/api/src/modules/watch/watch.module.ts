import { Module } from "@nestjs/common";
import { AuthzModule } from "../../shared/authz/authz.module";
import { PdpClientModule } from "../../shared/pdp/pdp-client.module";
import { CampaignModule, CAMPAIGN_DB } from "../campaign/campaign.module";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import {
  DrizzleWatchSessionRepository,
  WATCH_SESSION_REPOSITORY,
} from "./persistence/drizzle-watch-session.repository";
import { WatchController } from "./watch.controller";
import { CampaignViewAttributeLoader } from "./campaign-view-attribute-loader";

/**
 * Watch sessions. YT-0553.
 *
 * Imports `CampaignModule` rather than re-reading campaigns itself: a
 * session's duration, terms version and liveness are all facts about a
 * campaign, and a second way to read them is a second place they can be
 * wrong. It reuses that module's database handle for the same reason one
 * pool is better than two.
 */
@Module({
  imports: [AuthzModule, PdpClientModule, CampaignModule],
  controllers: [WatchController],
  providers: [
    {
      provide: WATCH_SESSION_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleWatchSessionRepository(db),
      inject: [CAMPAIGN_DB],
    },
    CampaignViewAttributeLoader,
  ],
  // Exported so `CheckpointModule` (YT-0121) reads sessions through THIS
  // repository rather than constructing a second one over the same table.
  // Additive: exporting a provider changes nothing for existing consumers,
  // and two repositories over one table is how they drift.
  //
  // `CampaignViewAttributeLoader` is exported so `app.module.ts` can gather
  // it into `RESOURCE_ATTRIBUTE_LOADERS` for the app-wide `PdpGuard` (1.5.d).
  exports: [WATCH_SESSION_REPOSITORY, CampaignViewAttributeLoader],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class WatchModule {}
