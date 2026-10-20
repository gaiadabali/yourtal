import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import {
  PAYMENT_PROVIDERS,
  PaymentProvidersModule,
} from "../../shared/drivers/payment-providers.module";
import type { RegionPaymentProviders } from "../../shared/drivers/payment-providers.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import {
  PAYMENT_ACCOUNTS,
  PAYMENTS_DB,
  PaymentAccountsRepository,
} from "./payment-accounts.repository";
import { PAYMENT_ACCOUNTS_SERVICE, PaymentAccountsService } from "./payment-accounts.service";
import { PAYMENT_EVENT_HANDLERS, PaymentEventHandlers } from "./payment-event-handlers";
import { PROVIDER_EVENTS, ProviderEventRepository } from "./provider-event.repository";
import { StripeWebhookController } from "./stripe-webhook.controller";

/**
 * 5.1.a (Area A): the payment plumbing other modules build on: the webhook
 * route and its inbox, the handler registry billing and auctions subscribe
 * to, and customers and saved cards. Owns `payment.customer`,
 * `payment.saved_card`, `payment.card_setup` and `payment.provider_event`.
 */
@Module({
  imports: [PaymentProvidersModule],
  controllers: [StripeWebhookController],
  providers: [
    {
      provide: PAYMENTS_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: PAYMENT_ACCOUNTS,
      useFactory: (db: AppDb) => new PaymentAccountsRepository(db),
      inject: [PAYMENTS_DB],
    },
    {
      provide: PROVIDER_EVENTS,
      useFactory: (db: AppDb) => new ProviderEventRepository(db),
      inject: [PAYMENTS_DB],
    },
    { provide: PAYMENT_EVENT_HANDLERS, useFactory: () => new PaymentEventHandlers() },
    {
      provide: PAYMENT_ACCOUNTS_SERVICE,
      useFactory: (
        providers: RegionPaymentProviders,
        accounts: PaymentAccountsRepository,
        handlers: PaymentEventHandlers,
        config: AppConfig,
      ) => {
        const service = new PaymentAccountsService(providers, accounts, config.webOrigin);
        service.registerHandlers(handlers);
        return service;
      },
      inject: [PAYMENT_PROVIDERS, PAYMENT_ACCOUNTS, PAYMENT_EVENT_HANDLERS, APP_CONFIG],
    },
  ],
  exports: [PaymentProvidersModule, PAYMENT_ACCOUNTS_SERVICE, PAYMENT_EVENT_HANDLERS],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
export class PaymentsModule {}
