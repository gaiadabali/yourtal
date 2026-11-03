import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../../../config/app-config.module";
import type { AppConfig } from "../../../config/app-config";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import { SettingsModule } from "../../../shared/settings/settings.module";
import { REGION_SETTINGS_READER } from "../../../shared/settings/region-settings-reader";
import type { RegionSettingsReader } from "../../../shared/settings/region-settings-reader";
import { DrizzleCredentialRepository } from "../persistence/drizzle-credential.repository";
import { DrizzlePasskeyRepository } from "../persistence/drizzle-passkey.repository";
import { EARNING_IDENTITY_CHECK, RepositoryEarningIdentityCheck } from "./earning-identity-check";

const EARNING_CHECK_DB = Symbol("EARNING_CHECK_DB");

/**
 * F126's check, for the watch, partner and streak paths. Its own module, not
 * `AuthModule`, so those modules can import it without pulling in sign-in
 * (and its controllers); its own pool, like every other module here.
 */
@Module({
  imports: [SettingsModule],
  providers: [
    {
      provide: EARNING_CHECK_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: EARNING_IDENTITY_CHECK,
      useFactory: (config: AppConfig, settings: RegionSettingsReader, db: AppDb) =>
        new RepositoryEarningIdentityCheck({
          appEnv: config.appEnv,
          settings,
          credentials: new DrizzleCredentialRepository(db),
          passkeys: new DrizzlePasskeyRepository(db),
        }),
      inject: [APP_CONFIG, REGION_SETTINGS_READER, EARNING_CHECK_DB],
    },
  ],
  exports: [EARNING_IDENTITY_CHECK],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class EarningCheckModule {}
