import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { AuthModule } from "../auth/auth.module";
import { SessionService } from "../auth/session/session.service";
import { InteractionController } from "./interaction.controller";
import { InteractionService, SIGN_IN_SESSIONS } from "./interaction.service";
import { OIDC_RUNTIME, OidcRuntime, createOidcRuntime } from "./oidc-runtime";
import { NO_TEEN_INVITES, TEEN_INVITE_CHECKER } from "./sign-in-checks";
import { TeenInviteClientGuard } from "./teen-invite-client.guard";
import { TeenInvitesController } from "./teen-invites.controller";

/**
 * Group 3.9 (docs/26): YourTal as an OpenID Connect provider. The provider
 * itself is mounted on the raw Fastify instance at `/oidc` (mount-oidc.ts),
 * outside Nest's guards; this module builds it and serves the interaction API
 * the `/connect/[uid]` screens call, and SnapApp's teen invite API. With OIDC_ENABLED off, nothing is built
 * and the interaction API answers 404.
 */
@Module({
  imports: [AuthModule],
  controllers: [InteractionController, TeenInvitesController],
  providers: [
    {
      provide: OIDC_RUNTIME,
      useFactory: (config: AppConfig): OidcRuntime => createOidcRuntime(config),
      inject: [APP_CONFIG],
    },
    {
      provide: TEEN_INVITE_CHECKER,
      useFactory: (runtime: OidcRuntime) => runtime.teenInvites ?? NO_TEEN_INVITES,
      inject: [OIDC_RUNTIME],
    },
    TeenInviteClientGuard,
    { provide: SIGN_IN_SESSIONS, useExisting: SessionService },
    InteractionService,
  ],
  exports: [OIDC_RUNTIME],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class OidcModule {}
