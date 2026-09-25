import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../persistence/drizzle-client";
import { createAppDb } from "../persistence/drizzle-client";
import { DrizzleRegionSettingsReader } from "./drizzle-region-settings-reader";
import { REGION_SETTINGS_READER } from "./region-settings-reader";

const SETTINGS_DB = Symbol("SETTINGS_DB");

/**
 * 1.2.f: provides `getSetting(region, key)` to the rest of the app. Not
 * `@Global()` — modules that need it (4.4.k's earn caps, 7.3's reward
 * ceiling, and 9.5.d's staff console once it lands) import `SettingsModule`
 * explicitly, the same shape `IdentityModule` follows rather than
 * `IdempotencyModule`'s global one, because a settings read is a normal
 * per-feature dependency, not infrastructure every request passes through.
 */
@Module({
  providers: [
    {
      provide: SETTINGS_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: REGION_SETTINGS_READER,
      useFactory: (db: AppDb) => new DrizzleRegionSettingsReader(db),
      inject: [SETTINGS_DB],
    },
  ],
  exports: [REGION_SETTINGS_READER],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class SettingsModule {}
