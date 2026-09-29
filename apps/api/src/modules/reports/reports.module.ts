import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { WalletModule } from "../wallet/wallet.module";
import { DrizzleCampaignReportRepository } from "./persistence/drizzle-campaign-report.repository";
import { CAMPAIGN_REPORT_REPOSITORY } from "./persistence/campaign-report.repository";
import { ReportsController } from "./reports.controller";

export const REPORTS_DB = Symbol("REPORTS_DB");

/**
 * 7.6: read-only aggregates over campaign/watch tables plus the ledger's
 * `campaignSpend` and the voucher client's `merchantCaptureStats`
 * (`WalletModule` already opens both — reused rather than a second pair of
 * pools, same move `BillingModule` makes).
 *
 * Owns no write path at all. 11.2.d: "open views" (Open Viewing / anonymous,
 * `watch.open_view_session`) now has a real data source and its own,
 * independently-suppressed field on the report -- see
 * `packages/contracts/src/report/campaign-report.ts`'s own doc comment.
 */
@Module({
  imports: [WalletModule],
  controllers: [ReportsController],
  providers: [
    {
      provide: REPORTS_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: CAMPAIGN_REPORT_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleCampaignReportRepository(db),
      inject: [REPORTS_DB],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class ReportsModule {}
