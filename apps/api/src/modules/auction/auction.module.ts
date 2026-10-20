import { StaffAuctionController } from "./staff-auction.controller";
import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { EmailDriverModule } from "../../shared/drivers/email-driver.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { IdentityModule } from "../identity/identity.module";
import { PAYMENT_EVENT_HANDLERS } from "../payments/payment-event-handlers";
import type { PaymentEventHandlers } from "../payments/payment-event-handlers";
import { PaymentsModule } from "../payments/payments.module";
import { WalletModule } from "../wallet/wallet.module";
import { AuctionAttributeLoader } from "./auction-attribute-loader";
import { registerAuctionPaymentEvents } from "./auction-payment-events";
import { AuctionController } from "./auction.controller";
import { AuctionService } from "./auction.service";
import { BidderCardController } from "./bidder-card.controller";
import { AUCTION_STORE, AuctionStore } from "./persistence/auction-store";

const AUCTION_PAYMENT_EVENTS = Symbol("AUCTION_PAYMENT_EVENTS");

/**
 * 13.22 (F86): charity auctions. Payments go through each region's marketplace driver from the
 * shared payment providers (AU on Stripe when live, Indonesia simulated); a bid holds the bidder's
 * saved card and the winner is captured into the charity's own account.
 */
@Module({
  imports: [WalletModule, IdentityModule, EmailDriverModule, PaymentsModule],
  controllers: [AuctionController, StaffAuctionController, BidderCardController],
  providers: [
    {
      provide: AUCTION_STORE,
      useFactory: (config: AppConfig) => new AuctionStore(createAppDb(config.databaseUrl)),
      inject: [APP_CONFIG],
    },
    {
      // Subscribes the cancelled-hold handler once, when the module is built.
      provide: AUCTION_PAYMENT_EVENTS,
      useFactory: (handlers: PaymentEventHandlers, store: AuctionStore) => {
        registerAuctionPaymentEvents(handlers, store);
        return true;
      },
      inject: [PAYMENT_EVENT_HANDLERS, AUCTION_STORE],
    },
    AuctionService,
    AuctionAttributeLoader,
  ],
  exports: [AuctionService, AuctionAttributeLoader],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
export class AuctionModule {}
