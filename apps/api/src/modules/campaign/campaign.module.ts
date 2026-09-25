import { Module } from "@nestjs/common";
import { AuthzModule } from "../../shared/authz/authz.module";
import { PdpClientModule } from "../../shared/pdp/pdp-client.module";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { CampaignController } from "./campaign.controller";
import { CAMPAIGN_REPOSITORY } from "./persistence/campaign.repository";
import { DrizzleCampaignRepository } from "./persistence/drizzle-campaign.repository";
import { CAMPAIGN_AUTHZ_ATTRIBUTES_READER } from "./persistence/campaign-authz-attributes";
import { DrizzleCampaignAuthzAttributesReader } from "./persistence/drizzle-campaign-authz-attributes";

export const CAMPAIGN_DB = Symbol("CAMPAIGN_DB");

/**
 * Postgres-backed from the first line. YT-0553.
 *
 * There is no in-memory variant to fall back to, and none is coming — the
 * business module had one and it meant the whole backend could run without
 * executing a line of SQL (YT-0552). A fallback is the thing tests quietly
 * select.
 */
@Module({
  imports: [AuthzModule, PdpClientModule],
  controllers: [CampaignController],
  providers: [
    {
      provide: CAMPAIGN_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: CAMPAIGN_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleCampaignRepository(db),
      inject: [CAMPAIGN_DB],
    },
    {
      provide: CAMPAIGN_AUTHZ_ATTRIBUTES_READER,
      useFactory: (db: AppDb) => new DrizzleCampaignAuthzAttributesReader(db),
      inject: [CAMPAIGN_DB],
    },
  ],
  exports: [CAMPAIGN_REPOSITORY, CAMPAIGN_DB, CAMPAIGN_AUTHZ_ATTRIBUTES_READER],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class CampaignModule {}
