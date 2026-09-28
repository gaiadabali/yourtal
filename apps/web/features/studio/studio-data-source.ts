import type { DataSourceImplementations, DataSourceMode } from "@yourtal/contracts/mock-source";
import { parseDataSourceMode } from "@yourtal/contracts/mock-source";

/**
 * Studio's OWN mock/live switch — deliberately separate from
 * `@yourtal/contracts/mock-source`'s shared `dataSourceMode`/`resolveDataSource`,
 * which every other feature (`campaign-data`, `quick-data`, `store-data`,
 * `store-balance-data`, `merchant-data`, `provisioning-data`, …) still uses
 * unchanged. Those all reject "not implemented" in live mode today — the
 * viewer app and the merchant counter are not ready for it — so flipping
 * the shared, global switch on staging would break them there. Studio's
 * own backend (7.1–7.6, 7.3) is fully live-ready, and staging/production
 * should show a real signed-in account's own real data, not Phase U's
 * static demo fixtures — this file is the one place that decision is made,
 * for Studio only.
 *
 * Resolution order:
 *   1. `YOURTAL_DATA_SOURCE`, if set at all — an explicit override, same
 *      values and same fail-fast parse as the shared switch
 *      (`parseDataSourceMode`). This is what local dev already uses to
 *      force live against a local api.
 *   2. `APP_ENV === "staging" | "production"` — the pm2 process on Helios
 *      gets this from `/opt/yourtal/secrets/app.env` via Node's own
 *      `--env-file` (`deploy/ecosystem.config.cjs`), the same mechanism
 *      `features/shell/app-env.ts`'s `isStaging()` already reads.
 *   3. Otherwise `"mock"` — plain local dev and `vitest` both run with
 *      neither variable set, so both fall through to this, unchanged from
 *      today.
 */
export function resolveStudioDataSourceMode(
  env: Readonly<Record<string, string | undefined>>,
): DataSourceMode {
  if (env["YOURTAL_DATA_SOURCE"] !== undefined) {
    return parseDataSourceMode(env);
  }
  if (env["APP_ENV"] === "staging" || env["APP_ENV"] === "production") {
    return "live";
  }
  return "mock";
}

/** Parsed once at module load from `process.env`, mirroring the shared `dataSourceMode`'s own fail-fast timing. */
export const studioDataSourceMode: DataSourceMode = resolveStudioDataSourceMode(process.env);

/** Picks the mock or live implementation of `T` per `studioDataSourceMode` — the Studio-scoped counterpart to `resolveDataSource`. */
export function resolveStudioDataSource<T>(implementations: DataSourceImplementations<T>): T {
  return implementations[studioDataSourceMode];
}
