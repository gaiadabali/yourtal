import { Global, Module } from "@nestjs/common";
import type { Redis } from "ioredis";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { REDIS_CLIENT } from "../redis/redis-client.module";
import { RateLimitService } from "./rate-limit.service";

/**
 * YT-0052 AC2's shared backend, wired up.
 *
 * `@Global` for the same reason `RedisClientModule` and `IdempotencyModule`
 * are: `RateLimitGuard` is registered once as an `APP_GUARD` in
 * `app.module.ts` and applies to every controller in the app, so every
 * module must be able to reach `RateLimitService` without importing a
 * module by hand. Takes no `imports` because `RedisClientModule` is itself
 * `@Global` and already exports `REDIS_CLIENT`.
 */
@Global()
@Module({
  providers: [
    {
      provide: RateLimitService,
      useFactory: (redis: Redis, config: AppConfig) =>
        new RateLimitService(redis, config.rateLimitNamespace ?? ""),
      inject: [REDIS_CLIENT, APP_CONFIG],
    },
  ],
  exports: [RateLimitService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class RateLimitModule {}
