import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { createLedgerClient } from "../../shared/ledger-client/create-ledger-client";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { createVoucherClient } from "../../shared/voucher-client/create-voucher-client";
import { VOUCHER_INTERNAL_CLIENT } from "../../shared/voucher-client/voucher-internal-client";
import { IdentityModule } from "../identity/identity.module";
import { WalletAttributeLoader } from "./wallet-attribute-loader";
import { WalletController } from "./wallet.controller";

export const WALLET_DB = Symbol("WALLET_DB");

/**
 * The viewer's wallet (4.8). Owns this app's ledger and voucher clients;
 * checkout (4.7) imports them from here rather than opening a second pair.
 */
@Module({
  imports: [IdentityModule],
  controllers: [WalletController],
  providers: [
    {
      provide: WALLET_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: LEDGER_INTERNAL_CLIENT,
      useFactory: (config: AppConfig, db: AppDb) => createLedgerClient(config, db),
      inject: [APP_CONFIG, WALLET_DB],
    },
    {
      provide: VOUCHER_INTERNAL_CLIENT,
      useFactory: (config: AppConfig, db: AppDb) => createVoucherClient(config, db),
      inject: [APP_CONFIG, WALLET_DB],
    },
    WalletAttributeLoader,
  ],
  exports: [LEDGER_INTERNAL_CLIENT, VOUCHER_INTERNAL_CLIENT, WalletAttributeLoader],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class WalletModule {}
