import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { DrizzlePrincipalSecurityStateRepository } from "./persistence/drizzle-principal-security-state.repository";
import { PRINCIPAL_SECURITY_STATE_REPOSITORY } from "./persistence/principal-security-state.repository";

export const IDENTITY_DB = Symbol("IDENTITY_DB");

/**
 * The identity domain's own storage (YT-0582) — currently just the freeze
 * state `AsyncPrincipalResolver.resolve()` reads. `AuthzModule` imports this
 * so the widened resolver has somewhere real to read from; nothing here has
 * an HTTP surface of its own.
 */
@Module({
  providers: [
    {
      provide: IDENTITY_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: PRINCIPAL_SECURITY_STATE_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzlePrincipalSecurityStateRepository(db),
      inject: [IDENTITY_DB],
    },
  ],
  exports: [PRINCIPAL_SECURITY_STATE_REPOSITORY],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class IdentityModule {}
