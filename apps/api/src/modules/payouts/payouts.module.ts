import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { PAYMENT_PROVIDERS } from "../../shared/drivers/payment-providers.module";
import type { RegionPaymentProviders } from "../../shared/drivers/payment-providers.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { PAYMENT_EVENT_HANDLERS } from "../payments/payment-event-handlers";
import type { PaymentEventHandlers } from "../payments/payment-event-handlers";
import { PaymentsModule } from "../payments/payments.module";
import { StoreModule } from "../store/store.module";
import {
  CONNECTED_ACCOUNTS,
  ConnectedAccountRepository,
  PAYOUTS_DB,
} from "./connected-account.repository";
import { CONNECTED_ACCOUNTS_SERVICE, ConnectedAccountsService } from "./connected-accounts.service";
import { DISBURSEMENTS, DisbursementRepository } from "./disbursement.repository";
import { StudioPayoutsController } from "./studio-payouts.controller";

/**
 * 5.2 (F103, F104): connected accounts for brands and charities, and the
 * webhook side of statement payouts. Owns `payment.connected_account`; the
 * worker's settlement-disburse job writes `payment.disbursement`, and this
 * module reads it and applies each payout's outcome. Australia only.
 */
@Module({
  imports: [PaymentsModule, StoreModule],
  controllers: [StudioPayoutsController],
  providers: [
    {
      provide: PAYOUTS_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: CONNECTED_ACCOUNTS,
      useFactory: (db: AppDb) => new ConnectedAccountRepository(db),
      inject: [PAYOUTS_DB],
    },
    {
      provide: DISBURSEMENTS,
      useFactory: (db: AppDb) => new DisbursementRepository(db),
      inject: [PAYOUTS_DB],
    },
    {
      provide: CONNECTED_ACCOUNTS_SERVICE,
      useFactory: (
        providers: RegionPaymentProviders,
        accounts: ConnectedAccountRepository,
        disbursements: DisbursementRepository,
        handlers: PaymentEventHandlers,
        config: AppConfig,
      ) => {
        const service = new ConnectedAccountsService(providers, accounts, config.webOrigin);
        service.registerHandlers(handlers, disbursements);
        return service;
      },
      inject: [
        PAYMENT_PROVIDERS,
        CONNECTED_ACCOUNTS,
        DISBURSEMENTS,
        PAYMENT_EVENT_HANDLERS,
        APP_CONFIG,
      ],
    },
  ],
  exports: [CONNECTED_ACCOUNTS_SERVICE, DISBURSEMENTS],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
export class PayoutsModule {}
