import { Module } from "@nestjs/common";
import { describeProblem, resolveDriverMode } from "@yourtal/drivers/driver-mode";
import { createMarketplacePaymentsDriver } from "@yourtal/drivers/marketplace-payments";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { EmailDriverModule } from "../../shared/drivers/email-driver.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { IdentityModule } from "../identity/identity.module";
import { WalletModule } from "../wallet/wallet.module";
import { AuctionAttributeLoader } from "./auction-attribute-loader";
import { AuctionController } from "./auction.controller";
import { AuctionService, MARKETPLACE_PAYMENTS } from "./auction.service";
import { AUCTION_STORE, AuctionStore } from "./persistence/auction-store";

/** 13.22 (F86): charity auctions. Payments go through the simulated marketplace driver. */
@Module({
  imports: [WalletModule, IdentityModule, EmailDriverModule],
  controllers: [AuctionController],
  providers: [
    {
      provide: AUCTION_STORE,
      useFactory: (config: AppConfig) => new AuctionStore(createAppDb(config.databaseUrl)),
      inject: [APP_CONFIG],
    },
    {
      provide: MARKETPLACE_PAYMENTS,
      useFactory: () => {
        const mode = resolveDriverMode("payments", process.env);
        if (mode.isErr()) throw new Error(describeProblem(mode.error));
        return createMarketplacePaymentsDriver(mode.value, process.env);
      },
    },
    AuctionService,
    AuctionAttributeLoader,
  ],
  exports: [AuctionService, AuctionAttributeLoader],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
export class AuctionModule {}
