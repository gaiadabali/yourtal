import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { AuthModule } from "../auth/auth.module";
import { InteractionController } from "./interaction.controller";
import { InteractionService } from "./interaction.service";
import { OIDC_RUNTIME, OidcRuntime, createOidcRuntime } from "./oidc-runtime";
import { NO_TEEN_INVITES_YET, TEEN_INVITE_CHECKER } from "./sign-in-checks";

/**
 * Group 3.9 (docs/26): YourTal as an OpenID Connect provider. The provider
 * itself is mounted on the raw Fastify instance at `/oidc` (mount-oidc.ts),
 * outside Nest's guards; this module builds it and serves the interaction API
 * the `/connect/[uid]` screens call. With OIDC_ENABLED off, nothing is built
 * and the interaction API answers 404.
 */
@Module({
  imports: [AuthModule],
  controllers: [InteractionController],
  providers: [
    {
      provide: OIDC_RUNTIME,
      useFactory: (config: AppConfig): OidcRuntime => createOidcRuntime(config),
      inject: [APP_CONFIG],
    },
    // The teen invite ticket (3.9.e) replaces this with the real check.
    { provide: TEEN_INVITE_CHECKER, useValue: NO_TEEN_INVITES_YET },
    InteractionService,
  ],
  exports: [OIDC_RUNTIME],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class OidcModule {}
