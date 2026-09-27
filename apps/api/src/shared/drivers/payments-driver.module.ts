import { Module } from "@nestjs/common";
import { createPaymentsDriver } from "@yourtal/drivers/payments";
import type { PaymentsDriver } from "@yourtal/drivers/payments";
import { resolveDriverMode, describeProblem } from "@yourtal/drivers/driver-mode";

export const PAYMENTS_DRIVER = Symbol("PAYMENTS_DRIVER");

/**
 * 7.5.a: Studio billing's payments boundary. Same pattern as
 * `email-driver.module.ts` -- `PAYMENTS_DRIVER` env var unset reads as
 * `"simulated"` (never a silent live fallback; see `resolveDriverMode`'s own
 * header), which is CLAUDE.md's rule that every external connection stays
 * simulated for now.
 */
function buildPaymentsDriver(): PaymentsDriver {
  const mode = resolveDriverMode("payments", process.env);
  if (mode.isErr()) {
    throw new Error(describeProblem(mode.error));
  }
  return createPaymentsDriver(mode.value, process.env);
}

@Module({
  providers: [{ provide: PAYMENTS_DRIVER, useFactory: buildPaymentsDriver }],
  exports: [PAYMENTS_DRIVER],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
export class PaymentsDriverModule {}
