import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { DrizzlePrincipalSecurityStateRepository } from "./persistence/drizzle-principal-security-state.repository";
import { PRINCIPAL_SECURITY_STATE_REPOSITORY } from "./persistence/principal-security-state.repository";
import { DrizzleUserProfileRepository } from "./persistence/drizzle-user-profile.repository";
import { USER_PROFILE_REPOSITORY } from "./persistence/user-profile.repository";
import { DrizzleBusinessMembershipReader } from "./persistence/drizzle-business-membership-reader";
import { BUSINESS_MEMBERSHIP_READER } from "./persistence/business-membership-reader";
import { MeController } from "./me.controller";

export const IDENTITY_DB = Symbol("IDENTITY_DB");

/**
 * The identity domain's own storage: the freeze state
 * `AsyncPrincipalResolver.resolve()` reads (YT-0582), and — as of 1.4 —
 * `identity.user_profile`, the first canonical per-account row. `AuthzModule`
 * imports this for the freeze state; `AuthModule` imports it for the profile
 * repository, since registration writes a profile row alongside a
 * credential. `GET/PATCH /api/me` (1.4.d) are this module's own HTTP
 * surface — the first one it has.
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
    {
      provide: USER_PROFILE_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleUserProfileRepository(db),
      inject: [IDENTITY_DB],
    },
    {
      provide: BUSINESS_MEMBERSHIP_READER,
      useFactory: (db: AppDb) => new DrizzleBusinessMembershipReader(db),
      inject: [IDENTITY_DB],
    },
  ],
  controllers: [MeController],
  exports: [PRINCIPAL_SECURITY_STATE_REPOSITORY, USER_PROFILE_REPOSITORY],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class IdentityModule {}
