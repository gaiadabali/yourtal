import { Module } from "@nestjs/common";
import type { SpambankDriver } from "@yourtal/drivers/spambank";
import { APP_CONFIG } from "../../../config/app-config.module";
import type { AppConfig } from "../../../config/app-config";
import type { SpambankConfig } from "../../../config/spambank-config";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import { RateLimitService } from "../../../shared/rate-limit/rate-limit.service";
import { createOneClickPoster } from "../mail/ssrf-guard";
import { SpambankModule } from "../spambank.module";
import { SPAMBANK_CONFIG, SPAMBANK_DRIVER } from "../spambank.tokens";
import { createEventStreams } from "./event-streams";
import { createMailAuthenticator } from "./mail-auth";
import { createPgMailStore } from "./mail-store";
import type { ProxyContext } from "./proxy-context";
import { mailRateLimiter } from "./rate-limits";
import { createUpstreamSessions } from "./upstream-session";

export const SPAMBANK_PROXY_CONTEXT = Symbol("SPAMBANK_PROXY_CONTEXT");

/**
 * Builds what the mail API needs (spambank/BUILD.md §5.3); `main.ts` mounts the routes on the raw
 * Fastify instance with it, like `/oidc`. Building it makes no request to Stalwart or Postgres.
 */
@Module({
  imports: [SpambankModule],
  providers: [
    {
      provide: SPAMBANK_PROXY_CONTEXT,
      inject: [SPAMBANK_DRIVER, SPAMBANK_CONFIG, APP_CONFIG, RateLimitService],
      useFactory: (
        driver: SpambankDriver,
        config: SpambankConfig,
        app: AppConfig,
        rateLimits: RateLimitService,
      ): ProxyContext => {
        const store = createPgMailStore(createAppDb(app.databaseUrl));
        return {
          driver,
          config,
          // yourtal.gaiada.com serves both the web app and /api, so the web origin is the API's too.
          publicOrigin: app.webOrigin,
          store,
          auth: createMailAuthenticator({ tokenKey: config.tokenKey, store }),
          sessions: createUpstreamSessions(),
          limiter: mailRateLimiter(rateLimits),
          streams: createEventStreams(),
          oneClick: createOneClickPoster(),
        };
      },
    },
  ],
  exports: [SPAMBANK_PROXY_CONTEXT],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
export class SpambankMailModule {}
