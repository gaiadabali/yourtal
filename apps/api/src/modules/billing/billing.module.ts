import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { SettingsModule } from "../../shared/settings/settings.module";
import { PAYMENT_EVENT_HANDLERS } from "../payments/payment-event-handlers";
import type { PaymentEventHandlers } from "../payments/payment-event-handlers";
import { PaymentsModule } from "../payments/payments.module";
import { StoreModule } from "../store/store.module";
import { WalletModule } from "../wallet/wallet.module";
import { BillingCardController } from "./billing-card.controller";
import { BillingController } from "./billing.controller";
import {
  BILLING_DB,
  CARD_PURCHASES,
  CardPurchaseRepository,
} from "./persistence/card-purchase.repository";
import { registerPurchaseEvents } from "./use-cases/purchase-events";

const PURCHASE_EVENTS = Symbol("PURCHASE_EVENTS");

/**
 * 7.5 / 5.1.a: Studio billing. Points go through `LEDGER_INTERNAL_CLIENT`
 * (`WalletModule`); card purchases live in `payment.card_purchase` and are
 * paid through `PaymentsModule`'s drivers, customers and webhook. The
 * region lookup comes from `StoreModule`, as for `PdpGuard`.
 */
@Module({
  imports: [WalletModule, StoreModule, SettingsModule, PaymentsModule],
  controllers: [BillingController, BillingCardController],
  providers: [
    {
      provide: BILLING_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: CARD_PURCHASES,
      useFactory: (db: AppDb) => new CardPurchaseRepository(db),
      inject: [BILLING_DB],
    },
    {
      // Subscribes billing to verified payment events once, at boot.
      provide: PURCHASE_EVENTS,
      useFactory: (
        handlers: PaymentEventHandlers,
        ledger: LedgerInternalClient,
        purchases: CardPurchaseRepository,
      ) => {
        registerPurchaseEvents(handlers, { ledger, purchases });
        return true;
      },
      inject: [PAYMENT_EVENT_HANDLERS, LEDGER_INTERNAL_CLIENT, CARD_PURCHASES],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class BillingModule {}
