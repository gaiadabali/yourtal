import { Global, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import { Redis } from "ioredis";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

/**
 * The one Valkey (Redis-protocol) client this app opens. YT-0540.
 *
 * `docker-compose.yml` already runs Valkey with `--save "" --appendonly
 * no` — persistence fully off — which is the right tradeoff for what lives
 * here (session lookups, login-throttle counters) and the wrong one for
 * anything durable. Nothing in this app should ever treat Valkey as a
 * system of record; Postgres already holds the durable half of every
 * feature that touches this client (`identity.session`,
 * `identity.verification_token`) precisely because a Valkey restart clears
 * it.
 *
 * `@Global` for the same reason `IdempotencyModule` is: this is
 * infrastructure every module that needs it should be able to inject
 * without re-importing a client module by hand.
 */
@Injectable()
export class RedisClientShutdown implements OnApplicationShutdown {
  constructor(private readonly client: Redis) {}

  onApplicationShutdown(): void {
    this.client.disconnect();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: AppConfig): Redis =>
        new Redis(config.redisUrl, {
          // Fail a command rather than queueing it forever when the socket
          // is down — a throttle check that hangs instead of erroring would
          // block every login behind a dead Valkey, which is worse than
          // refusing the request.
          maxRetriesPerRequest: 3,
          lazyConnect: false,
        }),
      inject: [APP_CONFIG],
    },
    {
      provide: RedisClientShutdown,
      useFactory: (client: Redis): RedisClientShutdown => new RedisClientShutdown(client),
      inject: [REDIS_CLIENT],
    },
  ],
  exports: [REDIS_CLIENT],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0100
export class RedisClientModule {}
