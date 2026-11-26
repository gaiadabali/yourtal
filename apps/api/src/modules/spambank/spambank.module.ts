import { Module } from "@nestjs/common";
import { describeProblem, resolveDriverMode } from "@yourtal/drivers/driver-mode";
import { createSpambankDriver } from "@yourtal/drivers/spambank";
import type { SpambankDriver } from "@yourtal/drivers/spambank";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { SpambankConfig } from "../../config/spambank-config";
import { SPAMBANK_CONFIG, SPAMBANK_DRIVER } from "./spambank.tokens";

export { SPAMBANK_CONFIG, SPAMBANK_DRIVER };

/**
 * Spambank (spambank/BUILD.md B1): the mail service inside the YourTal API. This is the skeleton the
 * other tickets add to: the driver and the settings every part reads, with no routes yet.
 *
 * Building the driver makes no request to Stalwart, so a mail server that is down never fails the
 * boot, the deploy's boot check or `/api/health`. `SPAMBANK_DRIVER` unset is the simulator.
 */
function buildDriver(): SpambankDriver {
  const mode = resolveDriverMode("spambank", process.env);
  if (mode.isErr()) throw new Error(describeProblem(mode.error));
  return createSpambankDriver(mode.value, process.env);
}

function spambankConfig(config: AppConfig): SpambankConfig {
  if (config.spambank === undefined) {
    throw new Error("AppConfig.spambank is missing: loadAppConfig always sets it.");
  }
  return config.spambank;
}

@Module({
  providers: [
    { provide: SPAMBANK_DRIVER, useFactory: buildDriver },
    { provide: SPAMBANK_CONFIG, useFactory: spambankConfig, inject: [APP_CONFIG] },
  ],
  exports: [SPAMBANK_DRIVER, SPAMBANK_CONFIG],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
export class SpambankModule {}
