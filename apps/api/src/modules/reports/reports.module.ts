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
 * Owns no write path at all. "Open views" (Open Viewing / anonymous) has no
 * data source yet in this codebase -- see `reports.controller.ts`'s own doc
 * comment and `packages/contracts/src/report/campaign-report.ts` for why
 * that stays a deliberate absence rather than a fabricated zero.
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
