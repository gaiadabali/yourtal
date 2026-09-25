import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import {
  LEDGER_INTERNAL_CLIENT,
  type LedgerInternalClient,
} from "../../shared/ledger-client/ledger-internal-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import {
  VOUCHER_INTERNAL_CLIENT,
  type VoucherInternalClient,
} from "../../shared/voucher-client/voucher-internal-client";
import { IdentityModule } from "../identity/identity.module";
import { WalletModule } from "../wallet/wallet.module";
import { CheckoutController } from "./checkout.controller";
import { CheckoutRecoveryService } from "./checkout-recovery.service";
import { CHECKOUT_DB, SAGA_DEPS } from "./checkout.tokens";
import { PostgresSagaRepository } from "./persistence/postgres-saga.repository";
import type { SagaDeps } from "./use-cases/run-saga";

/** The burn saga (4.7). Uses the wallet module's ledger and voucher clients. */
@Module({
  imports: [IdentityModule, WalletModule],
  controllers: [CheckoutController],
  providers: [
    {
      provide: CHECKOUT_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: SAGA_DEPS,
      useFactory: (
        db: AppDb,
        ledger: LedgerInternalClient,
        vouchers: VoucherInternalClient,
      ): SagaDeps => ({
        sagas: new PostgresSagaRepository(db),
        ledger,
        vouchers,
        now: () => new Date(),
      }),
      inject: [CHECKOUT_DB, LEDGER_INTERNAL_CLIENT, VOUCHER_INTERNAL_CLIENT],
    },
    CheckoutRecoveryService,
  ],
  exports: [SAGA_DEPS],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class CheckoutModule {}
