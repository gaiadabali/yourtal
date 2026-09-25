import { Module } from "@nestjs/common";
import { Pool } from "pg";
import { createEmailDriver } from "@yourtal/drivers/email";
import type { EmailDriver } from "@yourtal/drivers/email";
import { resolveDriverMode, describeProblem } from "@yourtal/drivers/driver-mode";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { PostgresSimOutboxStore } from "./postgres-sim-outbox-store";

export const EMAIL_DRIVER = Symbol("EMAIL_DRIVER");

/**
 * The rest of 1.6.a: `AuthService.deliver` gets a real (simulated) send path
 * instead of only `DevTokenAccess`. `EMAIL_DRIVER` is unset by default,
 * which `resolveDriverMode` reads as `"simulated"` — see its own header for
 * why choosing `live` without credentials fails at boot rather than falling
 * back.
 *
 * Not `@Global()`, unlike `IdempotencyModule`: only `AuthModule` needs this
 * today, and 7.1.c's future `InvitationMailer` port will import it
 * explicitly too rather than reach for ambient global state.
 */
function buildEmailDriver(config: AppConfig): EmailDriver {
  const mode = resolveDriverMode("email", process.env);
  if (mode.isErr()) {
    throw new Error(describeProblem(mode.error));
  }
  const store = new PostgresSimOutboxStore(new Pool({ connectionString: config.databaseUrl }));
  return createEmailDriver(mode.value, process.env, undefined, store);
}

@Module({
  providers: [
    {
      provide: EMAIL_DRIVER,
      inject: [APP_CONFIG],
      useFactory: buildEmailDriver,
    },
  ],
  exports: [EMAIL_DRIVER],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
export class EmailDriverModule {}
