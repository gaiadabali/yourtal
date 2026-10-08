import { Module } from "@nestjs/common";
import { createPool } from "../../shared/persistence/create-pool";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { IDENTITY_PG_POOL } from "./persistence/identity-pg-pool.token";
import { createLedgerClient } from "../../shared/ledger-client/create-ledger-client";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import { DrizzlePrincipalSecurityStateRepository } from "./persistence/drizzle-principal-security-state.repository";
import { PRINCIPAL_SECURITY_STATE_REPOSITORY } from "./persistence/principal-security-state.repository";
import { DrizzleUserProfileRepository } from "./persistence/drizzle-user-profile.repository";
import { USER_PROFILE_REPOSITORY } from "./persistence/user-profile.repository";
import { DrizzleBusinessMembershipReader } from "./persistence/drizzle-business-membership-reader";
import { BUSINESS_MEMBERSHIP_READER } from "./persistence/business-membership-reader";
import { DrizzleStaffRoleReader } from "./persistence/drizzle-staff-role-reader";
import { STAFF_ROLE_READER } from "./persistence/staff-role-reader";
import {
  ACCOUNT_EMAIL_READER,
  DrizzleAccountEmailReader,
} from "./persistence/account-email-reader";
import { DrizzleGuardianConsentRepository } from "./persistence/drizzle-guardian-consent.repository";
import { GUARDIAN_CONSENT_REPOSITORY } from "./persistence/guardian-consent.repository";
import { IDENTITY_DB } from "./persistence/identity-db.token";
import { MeController } from "./me.controller";
import { GuardianConsentController } from "./guardian-consent.controller";

export { IDENTITY_DB };

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
    {
      provide: STAFF_ROLE_READER,
      useFactory: (db: AppDb) => new DrizzleStaffRoleReader(db),
      inject: [IDENTITY_DB],
    },
    {
      provide: ACCOUNT_EMAIL_READER,
      useFactory: (db: AppDb) => new DrizzleAccountEmailReader(db),
      inject: [IDENTITY_DB],
    },
    {
      provide: GUARDIAN_CONSENT_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleGuardianConsentRepository(db),
      inject: [IDENTITY_DB],
    },
    // 12.1.a: `GuardianConsentController.revoke` escrows the teen's balance.
    // A second instance, on IDENTITY_DB's own pool — same physical database
    // as WALLET_DB (`config.databaseUrl`), so `fake` mode's
    // `platform.ledger_fake_*` reads/writes agree with the one every other
    // module sees — rather than importing WalletModule, which would import
    // IdentityModule right back (WalletModule already does, for
    // USER_PROFILE_REPOSITORY) and make the two modules circular.
    {
      provide: LEDGER_INTERNAL_CLIENT,
      useFactory: (config: AppConfig, db: AppDb) => createLedgerClient(config, db),
      inject: [APP_CONFIG, IDENTITY_DB],
    },
    // 12.4.b (#6): `GuardianConsentController.deleteAccount` runs the same
    // `postgresHandlers`/`executeDeletion` deletion `AccountController`'s
    // own `DELETE /api/me` does, which takes a raw `pg.Pool` rather than a
    // Drizzle handle -- same reason `me.module.ts`'s own `ME_PG_POOL`
    // exists, on the same physical database as `IDENTITY_DB`.
    {
      provide: IDENTITY_PG_POOL,
      useFactory: (config: AppConfig) => createPool(config.databaseUrl),
      inject: [APP_CONFIG],
    },
  ],
  controllers: [MeController, GuardianConsentController],
  exports: [
    PRINCIPAL_SECURITY_STATE_REPOSITORY,
    USER_PROFILE_REPOSITORY,
    BUSINESS_MEMBERSHIP_READER,
    STAFF_ROLE_READER,
    GUARDIAN_CONSENT_REPOSITORY,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class IdentityModule {}
