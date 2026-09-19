import { z } from "zod";

/**
 * The single seam between mock and live data for every screen in the app.
 *
 * The rule (docs/tasks/phase-u-ui.md phase preamble): "One switch flips
 * every screen between mock and live." That switch is `dataSourceMode`
 * below — parsed once, from environment, at module load, per
 * docs/13b-typescript-standards.md section 3 ("parse env at startup,
 * failing fast"). Nothing in this package or its consumers should read
 * `process.env.YOURTAL_DATA_SOURCE` directly anywhere else; if a second
 * call site needs the mode, it imports `dataSourceMode` (or, more usually,
 * calls `resolveDataSource` below) from here.
 *
 * How a screen uses this: a data-access module (in `apps/web`, not in this
 * package) builds a mock implementation of whatever shape it needs from one
 * of this package's "mock" subpath exports (e.g. `@yourtal/contracts/campaign/mock`),
 * and, once it exists, a live implementation that talks to the BFF against
 * the exact same TypeScript shape. It then calls
 * `resolveDataSource({ mock, live })` once, at module scope, and exports
 * the result. Every screen imports that resolved value. When the live
 * implementation lands, the screen's import does not change at all — only
 * the data-access module gains a second argument to a call it already
 * makes. That is what makes this a seam rather than a throwaway: the mock
 * and live paths are two implementations of one interface, chosen in
 * exactly one place.
 */

const dataSourceModeSchema = z.enum(["mock", "live"]);
export type DataSourceMode = z.infer<typeof dataSourceModeSchema>;

const dataSourceEnvSchema = z.object({
  YOURTAL_DATA_SOURCE: dataSourceModeSchema.default("mock"),
});

/**
 * Parses the data-source mode from an environment-like record. Exported
 * (rather than only used internally) so tests can exercise the fail-fast
 * behaviour without mutating `process.env` for the whole test process.
 */
export function parseDataSourceMode(env: Readonly<Record<string, string | undefined>>): DataSourceMode {
  const result = dataSourceEnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid YOURTAL_DATA_SOURCE environment configuration: ${z.prettifyError(result.error)}`);
  }
  return result.data.YOURTAL_DATA_SOURCE;
}

/**
 * The resolved switch, computed once at module load from `process.env`.
 * Fails fast: an invalid value (anything other than "mock" or "live")
 * throws at import time rather than silently falling back.
 */
export const dataSourceMode: DataSourceMode = parseDataSourceMode(process.env);

export interface DataSourceImplementations<T> {
  mock: T;
  live: T;
}

/**
 * Picks the mock or live implementation of `T` according to the single
 * resolved switch. `T` is left generic on purpose — it might be a fetch
 * function, a small client object with several methods, or a class
 * instance; this package does not need to know the shape of any given
 * domain's data-access layer, only that exactly one of the two provided
 * implementations is selected.
 */
export function resolveDataSource<T>(implementations: DataSourceImplementations<T>): T {
  return implementations[dataSourceMode];
}
