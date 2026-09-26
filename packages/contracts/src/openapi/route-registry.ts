import {
  HEALTH_ROUTE_DEFINITIONS,
  ME_ROUTE_DEFINITIONS,
  WALLET_ROUTE_DEFINITIONS,
  CHECKOUT_ROUTE_DEFINITIONS,
  DEV_CLOCK_ROUTE_DEFINITIONS,
} from "./route-registry.a";
import { CAMPAIGN_ROUTE_DEFINITIONS, WATCH_ROUTE_DEFINITIONS } from "./route-registry.b";
import { BUSINESS_ROUTE_DEFINITIONS } from "./route-registry.c";
import { buildPathsFrom, type RouteDefinition } from "./route-registry-shared";

/**
 * The route inventory behind `paths` in the generated document. YT-0552.
 *
 * 1.3.a split the route inventory into one file per area —
 * `route-registry.a.ts` (Area A), `route-registry.b.ts` (Area B),
 * `route-registry.c.ts` (Area C) — so a phase session only ever edits its own
 * area's file when it adds a route. This file concatenates them back into
 * one `paths` object; it is the only file that needs to know all three exist.
 * `route-registry-shared.ts` carries the `RouteDefinition` shape and the
 * OpenAPI-assembly helpers all three areas' files build on, and stays free
 * of any one area's routes so it never becomes a fourth thing everyone edits.
 *
 * `route-drift.test.ts` reads `apps/api`'s controllers from source (the same
 * trick `openapi.test.ts` uses to compare against the checked-in document)
 * and fails if a live route and an entry here disagree on method+path, in
 * either direction, scanning the whole of `apps/api/src` rather than a
 * hard-coded list of module directories — so a new module under any area's
 * own controller directory is picked up with no edit to that test file.
 *
 * Nothing (yet) checks that the SCHEMA below still matches the DTO or
 * use-case return type it was transcribed from. That drift is real and
 * unguarded — flagged here rather than silently assumed away.
 */
export {
  HEALTH_ROUTE_DEFINITIONS,
  ME_ROUTE_DEFINITIONS,
  WALLET_ROUTE_DEFINITIONS,
  CHECKOUT_ROUTE_DEFINITIONS,
  DEV_CLOCK_ROUTE_DEFINITIONS,
  CAMPAIGN_ROUTE_DEFINITIONS,
  WATCH_ROUTE_DEFINITIONS,
  BUSINESS_ROUTE_DEFINITIONS,
};
// `export *` is banned (docs/13b section 5) — named re-exports only, and only
// the pieces something outside this file's own siblings actually needs.
export type { RouteDefinition } from "./route-registry-shared";

/** Every area's routes, concatenated. What `route-drift.test.ts` compares live routes against. */
export const ALL_ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  ...HEALTH_ROUTE_DEFINITIONS,
  ...ME_ROUTE_DEFINITIONS,
  ...WALLET_ROUTE_DEFINITIONS,
  ...CHECKOUT_ROUTE_DEFINITIONS,
  ...DEV_CLOCK_ROUTE_DEFINITIONS,
  ...CAMPAIGN_ROUTE_DEFINITIONS,
  ...WATCH_ROUTE_DEFINITIONS,
  ...BUSINESS_ROUTE_DEFINITIONS,
];

/** Builds the `paths` object `build-document.ts` embeds in the document. */
export function buildPaths(): Record<string, Record<string, unknown>> {
  return buildPathsFrom(ALL_ROUTE_DEFINITIONS);
}
