import { Inject, Injectable } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import { ResultAsync } from "neverthrow";
import { Pool } from "pg";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import type { HealthCheckResult, HealthResponse } from "./health-check.schema";

/**
 * Short on purpose. A slow dependency should make the health endpoint
 * report `"error"` quickly rather than hang the probe that is asking — the
 * same reasoning `PdpClientConfig.timeoutMs` uses for the PDP on the
 * request path (`packages/authz/src/pdp-client.ts`), applied here to both
 * checks.
 */
const CHECK_TIMEOUT_MS = 2_000;

/**
 * Proves the two dependencies this API cannot function without are actually
 * reachable — not just configured. `docs/13` calls for a readiness endpoint
 * that "actually proves dependency connectivity" rather than a bare 200; a
 * hardcoded `{ ok: true }` would have passed every deploy that shipped a
 * `DATABASE_URL` pointed at nothing.
 *
 * ## Its own Postgres connection, not `business.module.ts`'s
 *
 * `createBusinessDb` (`modules/business/persistence/drizzle-client.ts`)
 * already opens a pool, but reusing it here would make this module depend
 * on `business.module.ts`'s wiring — the wrong direction for a
 * cross-cutting concern, and outside this ticket's ownership boundary in
 * any case. This pool is deliberately tiny (`max: 1`): it exists only to
 * prove the database answers, not to carry application traffic.
 */
@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: 1,
      connectionTimeoutMillis: CHECK_TIMEOUT_MS,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  async check(): Promise<HealthResponse> {
    // Both checks run regardless of how the other lands — a caller needs to
    // know about a downed Postgres AND a downed Cerbos in one response, not
    // whichever one this function happened to check first.
    const [postgres, pdp] = await Promise.all([this.checkPostgres(), this.checkPdp()]);
    const status = postgres.status === "ok" && pdp.status === "ok" ? "ok" : "degraded";
    return { status, checks: { postgres, pdp } };
  }

  private checkPostgres(): Promise<HealthCheckResult> {
    const start = performance.now();
    const result = ResultAsync.fromPromise(this.pool.query("SELECT 1"), describeError);
    return toCheckResult(result, start);
  }

  /**
   * Cerbos exposes `/_cerbos/health` unauthenticated on every listener,
   * returning `{"status":"SERVING"}` with HTTP 200 when ready — the
   * standard Cerbos liveness/readiness probe path, not something this repo
   * invented. Asked directly with `fetch` rather than through
   * `PdpClient.checkResource` (`packages/authz/src/pdp-client.ts`): that
   * call answers a policy question about a resource, which would tie an
   * infra liveness check to whichever resource kind happened to be
   * convenient, and would fail this endpoint on a deny rather than only on
   * Cerbos being unreachable.
   */
  private checkPdp(): Promise<HealthCheckResult> {
    const start = performance.now();
    const endpoint = `${this.config.pdp.baseUrl.replace(/\/+$/, "")}/_cerbos/health`;
    const result = ResultAsync.fromPromise(
      fetch(endpoint, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) }).then((response) => {
        if (!response.ok) {
          throw new Error(`Cerbos returned HTTP ${String(response.status)}`);
        }
        return response;
      }),
      describeError,
    );
    return toCheckResult(result, start);
  }
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** `start` rather than a precomputed duration — `.match()` resolves after
 * whichever of the two branches below runs, so the clock has to stop here,
 * not at the call site. */
function toCheckResult<T>(
  result: ResultAsync<T, string>,
  start: number,
): Promise<HealthCheckResult> {
  return result.match(
    () => ({ status: "ok" as const, latencyMs: performance.now() - start }),
    (error) => ({ status: "error" as const, latencyMs: performance.now() - start, error }),
  );
}
