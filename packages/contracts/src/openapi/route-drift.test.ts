import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_DEFINITIONS } from "./route-registry";

/**
 * The contracts ↔ live-routes drift gate. YT-0552.
 *
 * ## Why it lives in `packages/contracts` and not in `apps/api`
 *
 * Same reasoning as `db-drift/schema-drift.test.ts`: the check belongs where
 * the artifact it protects is checked in, so it runs and fails in the same
 * command as the change that broke it. Reading `apps/api`'s controllers from
 * disk creates no package dependency — the same trick `openapi.test.ts` uses
 * against the checked-in JSON document, and `authorized-routes.test.ts` /
 * `mutating-routes.test.ts` use against `apps/api`'s own controllers.
 *
 * ## What it does and does not catch
 *
 * It compares METHOD + PATH only: every `@Get`/`@Post`/`@Put`/`@Patch`/
 * `@Delete` handler found in a `*.controller.ts` file, against every entry in
 * `route-registry.ts`. A route in one list with no counterpart in the other
 * fails the build, in both directions — a new endpoint that ships without a
 * contract entry, and a contract entry for a route that was renamed or
 * removed, are the same class of drift and get the same failure.
 *
 * It does NOT verify that a route's documented request/response SCHEMA still
 * matches the DTO or use-case it was transcribed from — `route-registry.ts`'s
 * file header names that as a known, unguarded gap.
 *
 * ## Why it only scopes the `business` module in
 *
 * `apps/api/src/app.module.ts` currently wires up four things with routes:
 * `BusinessModule`, `CampaignModule`, `WatchModule`, and the shared
 * `HealthModule`. This ticket's brief (YT-0552) is specifically "the 12 live
 * routes" the business module serves — campaign and watch are separate,
 * concurrently in-flight streams (YT-0101/YT-0120/YT-0548) with their own
 * contract questions this ticket is not positioned to answer. Scanning the
 * whole tree and silently ignoring their routes would be worse than not
 * checking at all, so instead: `businessLiveRoutes()` is compared exactly
 * against `route-registry.ts` (this ticket's actual scope), and every route
 * OUTSIDE the business module is compared against `KNOWN_OUT_OF_SCOPE`
 * below — an explicit, asserted ledger, in the same spirit as
 * `db-drift/schema-drift.test.ts`'s "known storage gaps". A new
 * campaign/watch/health endpoint, or one of theirs disappearing, fails this
 * suite until the ledger is updated — it cannot go unnoticed, it is just not
 * this ticket's job to give it a contract entry.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const apiSrc = path.join(repoRoot, "apps", "api", "src");
const businessModuleSrc = path.join(apiSrc, "modules", "business");

const ROUTE_VERB = /^\s*@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/;
const CONTROLLER_PREFIX = /^\s*@Controller\(([^)]*)\)/;

interface LiveRoute {
  readonly method: string;
  readonly path: string;
  readonly file: string;
  readonly line: number;
}

function controllerFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...controllerFiles(full));
    else if (entry.name.endsWith(".controller.ts")) found.push(full);
  }
  return found;
}

/** Strips the quotes off a decorator's single string-literal argument, if that is all it is. */
function stringArg(raw: string): string | undefined {
  const trimmed = raw.trim();
  const match = /^["'`]([^"'`]*)["'`]$/.exec(trimmed);
  return match?.[1];
}

/** `:tenantId` (Nest/Express param syntax) -> `{tenantId}` (OpenAPI param syntax). */
function toOpenApiPath(nestPath: string): string {
  return nestPath.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
}

function joinPaths(prefix: string, suffix: string | undefined): string {
  const parts = [prefix, suffix ?? ""].filter((part) => part.length > 0);
  return `/${parts.join("/").replace(/\/+/g, "/").replace(/^\/+/, "")}`;
}

/**
 * Every live route, read straight from the controllers' decorators.
 *
 * `@Controller("api/:tenantId/business")` with no argument on `@Get()` means
 * the controller prefix IS the route; `@Post("invite")` appends a segment.
 * Both forms are used across this module's controllers.
 */
function liveRoutes(dir: string): LiveRoute[] {
  const found: LiveRoute[] = [];

  for (const file of controllerFiles(dir)) {
    const lines = readFileSync(file, "utf8").split("\n");
    let controllerPath: string | undefined;

    lines.forEach((line, index) => {
      const controllerMatch = CONTROLLER_PREFIX.exec(line);
      if (controllerMatch?.[1] !== undefined) {
        controllerPath = stringArg(controllerMatch[1]);
        return;
      }

      const routeMatch = ROUTE_VERB.exec(line);
      const verb = routeMatch?.[1];
      if (verb === undefined || controllerPath === undefined) return;

      const subPath = routeMatch?.[2] !== undefined ? stringArg(routeMatch[2]) : undefined;
      found.push({
        method: verb.toLowerCase(),
        path: toOpenApiPath(joinPaths(controllerPath, subPath)),
        file: path.relative(apiSrc, file).replace(/\\/g, "/"),
        line: index + 1,
      });
    });
  }

  return found;
}

function key(route: { method: string; path: string }): string {
  return `${route.method.toUpperCase()} ${route.path}`;
}

/**
 * Every route outside the `business` module, as of this ticket. Each needs a
 * reason, same convention as `schema-drift.test.ts`'s `NOT_PUBLISHED` and
 * "known storage gaps" — an exemption is a decision someone can see, not an
 * absence nobody notices.
 */
const KNOWN_OUT_OF_SCOPE: Readonly<Record<string, string>> = {
  "GET /api/campaigns": "CampaignModule — YT-0101/YT-0548, a separate in-flight stream.",
  "GET /api/campaigns/{campaignId}": "CampaignModule — YT-0101/YT-0548, a separate in-flight stream.",
  "POST /api/watch/sessions": "WatchModule — YT-0120, a separate in-flight stream.",
  "GET /api/watch/sessions/{sessionId}": "WatchModule — YT-0120, a separate in-flight stream.",
  "POST /api/watch/sessions/{sessionId}/progress": "WatchModule — YT-0120, a separate in-flight stream.",
  "POST /api/watch/sessions/{sessionId}/complete": "WatchModule — YT-0120, a separate in-flight stream.",
  "GET /api/health": "Platform infrastructure endpoint, not business-domain API surface.",
};

describe("business-module route inventory vs route-registry.ts", () => {
  const live = liveRoutes(businessModuleSrc);
  const declared = ROUTE_DEFINITIONS;

  it("finds live routes at all", () => {
    // Guards the guard: a moved directory or a decorator rename would
    // otherwise make every assertion below pass over an empty list.
    expect(live.length).toBeGreaterThanOrEqual(9);
  });

  it("has no live route missing from route-registry.ts", () => {
    const declaredKeys = new Set(declared.map(key));
    const missing = live
      .filter((route) => !declaredKeys.has(key(route)))
      .map((route) => `${key(route)} (${route.file}:${String(route.line)})`);

    expect(
      missing,
      "These routes exist in apps/api/src/modules/business with no entry in " +
        "packages/contracts/src/openapi/route-registry.ts. Add one — see that file's header " +
        "for how request/response shapes are declared.",
    ).toEqual([]);
  });

  it("has no route-registry.ts entry for a route apps/api no longer serves", () => {
    const liveKeys = new Set(live.map(key));
    const stale = declared.filter((route) => !liveKeys.has(key(route))).map(key);

    expect(
      stale,
      "These entries in route-registry.ts do not match any live business-module route. The " +
        "controller was renamed, moved, or removed — update or delete the entry.",
    ).toEqual([]);
  });

  it("declares exactly the 10 routes the business module serves", () => {
    // Not load-bearing on its own — the two checks above already prove
    // set-equality — but a reviewer scanning `--reporter=verbose` output can
    // see the count agree with the ticket's ground truth at a glance.
    expect(declared.length).toBe(live.length);
  });
});

describe("routes outside the business module (out of scope for YT-0552)", () => {
  const outOfScope = liveRoutes(apiSrc).filter(
    (route) => !route.file.startsWith("modules/business/"),
  );

  it("matches the recorded ledger exactly", () => {
    const found = new Set(outOfScope.map(key));
    const recorded = new Set(Object.keys(KNOWN_OUT_OF_SCOPE));

    const undocumented = [...found]
      .filter((routeKey) => !recorded.has(routeKey))
      .map((routeKey) => `${routeKey}: new route with no ledger entry — add one, or give it a contract`);
    const stale = [...recorded]
      .filter((routeKey) => !found.has(routeKey))
      .map((routeKey) => `${routeKey}: ledger entry for a route that no longer exists — remove it`);

    expect([...undocumented, ...stale]).toEqual([]);
  });
});
