import { Module } from "@nestjs/common";
import { createPaymentProviders } from "@yourtal/drivers/payment-providers";
import type { PaymentProviders } from "@yourtal/drivers/payment-providers";
import type { Region } from "@yourtal/contracts/region";

export const PAYMENT_PROVIDERS = Symbol("PAYMENT_PROVIDERS");

export type RegionPaymentProviders = Readonly<Record<Region, PaymentProviders>>;

/**
 * 5.1.a: the payment drivers per region. AU runs Stripe when
 * PAYMENTS_DRIVER=live (on staging, against the simulation, F106), ID always
 * runs the simulated driver (F104). Built once per process: the simulated
 * driver answers replays from memory, so every module must share one.
 */
@Module({
  providers: [
    { provide: PAYMENT_PROVIDERS, useFactory: () => createPaymentProviders(process.env) },
  ],
  exports: [PAYMENT_PROVIDERS],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
export class PaymentProvidersModule {}
