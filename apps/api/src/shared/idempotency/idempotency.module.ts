import { Global, Inject, Module } from "@nestjs/common";
import { Pool } from "pg";
import { InMemoryIdempotencyStore } from "@yourtal/idempotency/in-memory-store";
import { PostgresIdempotencyStore } from "@yourtal/idempotency/postgres-store";
import type { IdempotencyStore } from "@yourtal/idempotency/store";
import { AuthzModule } from "../authz/authz.module";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";

export const IDEMPOTENCY_STORE = Symbol("IDEMPOTENCY_STORE");

/**
 * Provides the idempotency store. YT-0039, durable since YT-0515.
 *
 * With a `DATABASE_URL` this is the Postgres store, backed by
 * `platform.idempotency` from the YT-0518 migration. Without one it falls
 * back to the in-memory store so tests and a bare `pnpm dev` still run.
 *
 * **That fallback is a development convenience and nothing more.** The
 * in-memory store is per-process: two instances behind a load balancer each
 * keep their own map, so a retry landing on the other instance executes the
 * operation a second time. An idempotency store that is not shared is not an
 * idempotency store — which is why `selectStore` refuses to use it outside
 * development and test rather than logging a warning nobody reads.
 */
function selectStore(config: AppConfig): IdempotencyStore {
  if (config.databaseUrl !== undefined) {
    return new PostgresIdempotencyStore(new Pool({ connectionString: config.databaseUrl }));
  }

  if (config.nodeEnv === "production") {
    throw new Error(
      "No DATABASE_URL, so the idempotency store would be in-memory and per-process. " +
        "Two instances would each keep their own map and a retry landing on the other " +
        "would execute the operation twice. Set DATABASE_URL.",
    );
  }

  return new InMemoryIdempotencyStore();
}

@Global()
@Module({
  imports: [AuthzModule],
  providers: [
    {
      provide: IDEMPOTENCY_STORE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => selectStore(config),
    },
  ],
  exports: [IDEMPOTENCY_STORE],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata, YT-0039
export class IdempotencyModule {
  // Constructor injection purely to keep the config dependency explicit in
  // the module graph; the factory above is what actually builds the store.
  constructor(@Inject(APP_CONFIG) _config: AppConfig) {}
}
