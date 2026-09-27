import { Module } from "@nestjs/common";
import { PaymentsDriverModule } from "../../shared/drivers/payments-driver.module";
import { StoreModule } from "../store/store.module";
import { WalletModule } from "../wallet/wallet.module";
import { BillingController } from "./billing.controller";

/**
 * 7.5: Studio billing (buying points). Owns no persistence of its own --
 * every write and read goes straight through `LEDGER_INTERNAL_CLIENT`
 * (`WalletModule`, already open) and the simulated payments driver
 * (`PaymentsDriverModule`, new for this module). `BUSINESS_REGION_LOOKUP`
 * comes from `StoreModule`, which already exports it for `PdpGuard` --
 * reused here rather than a second copy of the same cross-schema SELECT.
 */
@Module({
  imports: [WalletModule, PaymentsDriverModule, StoreModule],
  controllers: [BillingController],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class BillingModule {}
