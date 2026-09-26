import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { RedisClientModule } from "../../shared/redis/redis-client.module";
import { EmailDriverModule } from "../../shared/drivers/email-driver.module";
import { IdentityModule } from "../identity/identity.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { DevTokenAccess } from "./dev-token-access";
import { SessionService } from "./session/session.service";
import { SESSION_VALIDATOR } from "../../shared/authz/session-validator";
import { ThrottleService } from "./throttle/throttle.service";
import { CREDENTIAL_REPOSITORY } from "./persistence/credential.repository";
import { DrizzleCredentialRepository } from "./persistence/drizzle-credential.repository";
import { SESSION_REPOSITORY } from "./persistence/session.repository";
import { DrizzleSessionRepository } from "./persistence/drizzle-session.repository";
import { VERIFICATION_TOKEN_REPOSITORY } from "./persistence/verification-token.repository";
import { DrizzleVerificationTokenRepository } from "./persistence/drizzle-verification-token.repository";
import { AUTH_DB } from "./persistence/auth-db.token";

/**
 * Email and password authentication (YT-0540). Owns `identity.credential`,
 * `identity.session` and `identity.verification_token` — NOT
 * `identity.principal_security_state` or `identity.user_profile`, both
 * `IdentityModule`'s. A separate `AUTH_DB` connection rather than reusing
 * `IDENTITY_DB`: this module's own three tables stay on their own pool, the
 * same reason `CheckpointModule` opens its own instead of sharing one.
 *
 * `IdentityModule` IS imported here, though, as of 1.4: `AuthService.register`
 * writes a profile row (`USER_PROFILE_REPOSITORY`) right after it writes a
 * credential. As of 2.5 (F31) this IS one atomic transaction despite the two
 * separate pools: `AUTH_DB` and `IDENTITY_DB` both point at the same
 * `config.databaseUrl` (one physical database), so `AuthService.register`
 * opens `db.transaction` on ITS OWN pool (`AUTH_DB`, injected directly —
 * docs/13b §7's "opened in the use-case") and passes the transaction handle
 * through `CredentialRepository.create`/`UserProfileRepository.create`'s own
 * optional `tx` parameter — the cross-module boundary stays the OTHER
 * module's provider interface, never its raw tables, exactly as docs/13b §7
 * also requires. See `AuthService.register`'s own comment for the failure
 * window this closes.
 *
 * Imports `RedisClientModule` for `ThrottleService`'s Valkey client, even
 * though that module is `@Global` and would already be visible — spelled
 * out here so a reader of this file sees every infrastructure dependency
 * this module actually has, matching how `CheckpointModule` imports
 * `AuthzModule`/`PdpClientModule` despite the same global availability.
 */
@Module({
  imports: [RedisClientModule, IdentityModule, EmailDriverModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    { provide: SESSION_VALIDATOR, useExisting: SessionService },
    ThrottleService,
    DevTokenAccess,
    {
      provide: AUTH_DB,
      useFactory: (config: AppConfig): AppDb => createAppDb(config.databaseUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: CREDENTIAL_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleCredentialRepository(db),
      inject: [AUTH_DB],
    },
    {
      provide: SESSION_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleSessionRepository(db),
      inject: [AUTH_DB],
    },
    {
      provide: VERIFICATION_TOKEN_REPOSITORY,
      useFactory: (db: AppDb) => new DrizzleVerificationTokenRepository(db),
      inject: [AUTH_DB],
    },
  ],
  // SESSION_VALIDATOR is exported so AuthzModule (1.5.a) can inject it into
  // PrincipalService — the real session read that replaced x-yt-user-id.
  // SessionService itself stays exported too, for anything that legitimately
  // needs the full class (issue/revoke), not just validation.
  exports: [SessionService, SESSION_VALIDATOR],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class AuthModule {}
