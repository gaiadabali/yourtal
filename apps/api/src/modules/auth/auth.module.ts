import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { RedisClientModule } from "../../shared/redis/redis-client.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { DevTokenAccess } from "./dev-token-access";
import { SessionService } from "./session/session.service";
import { ThrottleService } from "./throttle/throttle.service";
import { CREDENTIAL_REPOSITORY } from "./persistence/credential.repository";
import { DrizzleCredentialRepository } from "./persistence/drizzle-credential.repository";
import { SESSION_REPOSITORY } from "./persistence/session.repository";
import { DrizzleSessionRepository } from "./persistence/drizzle-session.repository";
import { VERIFICATION_TOKEN_REPOSITORY } from "./persistence/verification-token.repository";
import { DrizzleVerificationTokenRepository } from "./persistence/drizzle-verification-token.repository";

export const AUTH_DB = Symbol("AUTH_DB");

/**
 * Email and password authentication (YT-0540). Owns
 * `identity.credential`, `identity.session` and
 * `identity.verification_token` — NOT `identity.principal_security_state`,
 * which is `IdentityModule`'s (YT-0582, `apps/api/src/modules/identity/**`,
 * out of this ticket's reach). A separate `AUTH_DB` connection rather than
 * reusing `IDENTITY_DB` for the same reason `CheckpointModule` opens its
 * own pool instead of importing `IdentityModule`: that module's write set
 * belongs to a different, concurrently-in-flight ticket, and importing it
 * would couple this module's boot to a class this ticket must not modify.
 *
 * Imports `RedisClientModule` for `ThrottleService`'s Valkey client, even
 * though that module is `@Global` and would already be visible — spelled
 * out here so a reader of this file sees every infrastructure dependency
 * this module actually has, matching how `CheckpointModule` imports
 * `AuthzModule`/`PdpClientModule` despite the same global availability.
 */
@Module({
  imports: [RedisClientModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
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
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class AuthModule {}
