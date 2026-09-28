import { Module } from "@nestjs/common";
import { PdpClientModule } from "../../shared/pdp/pdp-client.module";
import { RateLimitModule } from "../../shared/rate-limit/rate-limit.module";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { createLedgerClient } from "../../shared/ledger-client/create-ledger-client";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import { PartnerActionsController } from "./partner-actions.controller";
import { PARTNER_CREDENTIAL_REPOSITORY } from "./persistence/partner-credential.repository";
import { DrizzlePartnerCredentialRepository } from "./persistence/drizzle-partner-credential.repository";
import { PARTNER_RECEIPT_REPOSITORY } from "./persistence/partner-receipt.repository";
import { DrizzlePartnerReceiptRepository } from "./persistence/drizzle-partner-receipt.repository";
import { LINK_CODE_LOOKUP } from "./persistence/link-code-lookup";
import { DrizzleLinkCodeLookup } from "./persistence/drizzle-link-code-lookup";

const PARTNERS_DB = Symbol("PARTNERS_DB");

/**
 * TASKS.md 8.4.a: snap-app's receipt-scan integration. Its own DB pool and
 * ledger client, not `WalletModule`'s (Area A's module) — same
 * import-cycle-avoidance reasoning `devices.module.ts`'s own header gives
 * for the exact same choice.
 */
@Module({
  imports: [PdpClientModule, RateLimitModule],
  controllers: [PartnerActionsController],
  providers: [
    {
      provide: PARTNERS_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: LEDGER_INTERNAL_CLIENT,
      useFactory: (config: AppConfig, db: AppDb) => createLedgerClient(config, db),
      inject: [APP_CONFIG, PARTNERS_DB],
    },
    {
      provide: PARTNER_CREDENTIAL_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzlePartnerCredentialRepository(db),
      inject: [PARTNERS_DB],
    },
    {
      provide: PARTNER_RECEIPT_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzlePartnerReceiptRepository(db),
      inject: [PARTNERS_DB],
    },
    {
      provide: LINK_CODE_LOOKUP,
      useFactory: (db: AppDb) => new DrizzleLinkCodeLookup(db),
      inject: [PARTNERS_DB],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class PartnersModule {}
