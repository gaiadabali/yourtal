import { Global, Inject, Module } from "@nestjs/common";
import { Pool } from "pg";
import { PostgresIdempotencyStore } from "@yourtal/idempotency/postgres-store";
import type { IdempotencyStore } from "@yourtal/idempotency/store";
import { AuthzModule } from "../authz/authz.module";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";

export const IDEMPOTENCY_STORE = Symbol("IDEMPOTENCY_STORE");

/**
 * Provides the idempotency store. YT-0039, durable since YT-0515, and
 * Postgres-only since YT-0552.
 *
 * Backed by `platform.idempotency` from the YT-0518 migration. There is no
 * in-memory branch any more.
 *
 * There used to be one, guarded so it could not be selected in production.
 * The guard was correct and the branch was still wrong: `DATABASE_URL` is
 * required as of YT-0552, so the fallback had become unreachable code that
 * still advertised an option — and while it existed, every test in this app
 * took it. An idempotency store exercised only as a `Map` proves nothing
 * about the `INSERT ... ON CONFLICT DO NOTHING` that does the actual work.
 *
 * The reason it must not come back: the in-memory store is per-process. Two
 * instances behind a load balancer each keep their own map, so a retry
 * landing on the other one executes the operation a second time. An
 * idempotency store that is not shared is not an idempotency store — the
 * same reasoning YT-0540 records for throttling counters.
 */
function selectStore(config: AppConfig): IdempotencyStore {
  return new PostgresIdempotencyStore(new Pool({ connectionString: config.databaseUrl }));
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
