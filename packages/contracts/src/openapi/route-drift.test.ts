import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_ROUTE_DEFINITIONS } from "./route-registry";

/**
 * The contracts ↔ live-routes drift gate. YT-0552, reworked by 1.3.a.
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
 * `@Delete` handler found anywhere under `apps/api/src` (any `*.controller.ts`
 * file), against every entry across `route-registry.{a,b,c}.ts`
 * (`ALL_ROUTE_DEFINITIONS`, from `route-registry.ts`). A route in one list
 * with no counterpart in the other fails the build, in both directions — a
 * new endpoint that ships without a contract entry, and a contract entry for
 * a route that was renamed or removed, are the same class of drift and get
 * the same failure.
 *
 * It does NOT verify that a route's documented request/response SCHEMA still
 * matches the DTO or use-case it was transcribed from — `route-registry-
 * shared.ts`'s file header names that as a known, unguarded gap.
 *
 * ## Why this scans the whole tree instead of a hard-coded module list
 *
 * `route-registry.ts` used to be one file with one `RouteDefinition` array
 * per module (business, campaign, watch, health), and this test had one
 * `describe` block per module: a hard-coded source directory, a hard-coded
 * "declares exactly N routes" count, and its own missing/stale check. That
 * meant every phase session standing up a new module (auth, identity,
 * checkout, wallet, studio, store, staff, ...) had to add a new block here —
 * a file every area's phase session would touch, exactly the collision 1.3
 * exists to design out.
 *
 * Instead this file discovers live routes from `apps/api/src` as a whole and
 * diffs that single set against the single concatenated `declared` set —
 * true module-count independence. A route this package has deliberately not
 * given a contract entry yet (a separate in-flight stream with its own
 * contract question) is named in `KNOWN_OUT_OF_SCOPE` below, same convention
 * as `schema-drift.test.ts`'s "known storage gaps": an exemption is a
 * decision someone can see, not an absence nobody notices. Adding a new
 * module with routes that ARE ready for a contract needs no edit here at
 * all — only a new entry in that area's own `route-registry.<letter>.ts`.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const apiSrc = path.join(repoRoot, "apps", "api", "src");

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
 * Both forms are used across this API's controllers.
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
 * Every live route this package has deliberately not given a contract entry
 * yet, each with a reason (same convention as `schema-drift.test.ts`'s
 * `NOT_PUBLISHED` and "known storage gaps"). A route belongs here only while
 * its own ticket is genuinely still open — once a module gets a
 * `route-registry.<letter>.ts` entry, its lines come out of this ledger in
 * the same commit.
 */
const KNOWN_OUT_OF_SCOPE: Readonly<Record<string, string>> = {
  "GET /api/internal/hls-auth":
    "2.1.c: nginx's auth_request target for signed HLS URLs, blocked on the public vhost, so not a published contract.",
  "GET /api/dev/inbox":
    "1.6.b: a dev-only reader of simulated messages, 404 in production, so not a published contract.",
  "POST /api/watch/sessions/{sessionId}/checkpoints/{checkpointIndex}/token":
    "CheckpointModule — YT-0121, a separate in-flight stream. Its response is deliberately NOT a published contract yet: the body carries a signed single-use token and the one checkpoint time being asked for, and publishing that shape invites a client to expect the whole schedule alongside it — which is exactly the predictability the PRF in watch-checkpoint-token.ts exists to deny. It gets a contract when the player consumes it (YT-0122).",

  // StoreModule -- YT-0130/YT-0131/YT-0132 backend halves, the first pass of
  // the store module (previously 0 of 10 tasks, no module at all). Same
  // convention as campaign/watch above: out of THIS gate's scope rather than
  // undocumented, because a full route-registry entry needs the same
  // Zod-schema-to-OpenAPI transcription business.ts's schema-registry does,
  // which is a separate piece of work from standing the module up.
  "GET /api/store/listings": "StoreModule -- YT-0130/YT-0131/YT-0132, this pass's own ticket.",
  "GET /api/store/listings/{listingId}":
    "StoreModule -- YT-0130/YT-0131/YT-0132, this pass's own ticket.",
  "POST /api/{tenantId}/store/listings":
    "StoreModule -- YT-0130/YT-0131/YT-0132, this pass's own ticket.",
  "GET /api/{tenantId}/store/listings":
    "StoreModule -- YT-0130/YT-0131/YT-0132, this pass's own ticket.",
  "GET /api/{tenantId}/store/listings/{listingId}":
    "StoreModule -- YT-0130/YT-0131/YT-0132, this pass's own ticket.",
  "PATCH /api/{tenantId}/store/listings/{listingId}":
    "StoreModule -- YT-0130/YT-0131/YT-0132, this pass's own ticket.",
  "POST /api/{tenantId}/store/listings/{listingId}/settlement-value":
    "StoreModule -- YT-0130/YT-0131/YT-0132, this pass's own ticket.",
  "GET /api/{tenantId}/store/listings/{listingId}/price-revisions":
    "StoreModule -- YT-0130/YT-0131/YT-0132, this pass's own ticket.",
  "POST /api/{tenantId}/store/listings/{listingId}/pause":
    "StoreModule -- YT-0130/YT-0131/YT-0132, this pass's own ticket.",
  "POST /api/{tenantId}/store/listings/{listingId}/resume":
    "StoreModule -- YT-0130/YT-0131/YT-0132, this pass's own ticket.",
  "POST /api/{tenantId}/store/listings/{listingId}/retire":
    "StoreModule -- YT-0130/YT-0131/YT-0132, this pass's own ticket.",
  "POST /api/{tenantId}/store/listings/{listingId}/settlement-decrease-requests":
    "SettlementDecreaseController -- YT-0575, the two-person-approval workflow YT-0574's fix made necessary. Same StoreModule scope as the rest of this ledger's store entries.",
  "POST /api/{tenantId}/store/listings/{listingId}/settlement-decrease-requests/{requestId}/approve":
    "SettlementDecreaseController -- YT-0575, the two-person-approval workflow YT-0574's fix made necessary. Same StoreModule scope as the rest of this ledger's store entries.",

  // AuthModule -- YT-0540. No `:tenantId`, matching create-business's own
  // out-of-scope entry pattern: these are account-level, not business-level.
  // Not given a full route-registry entry for the same reason StoreModule
  // isn't: a request/response transcription is separate work from standing
  // the module up, and none of these responses are stable yet in the sense
  // route-registry.ts asserts (auth.service.test.ts is this ticket's
  // verification instead).
  "POST /api/auth/register": "AuthModule -- YT-0540, a separate in-flight stream.",
  "POST /api/auth/login": "AuthModule -- YT-0540, a separate in-flight stream.",
  "POST /api/auth/logout": "AuthModule -- YT-0540, a separate in-flight stream.",
  "POST /api/auth/password/change": "AuthModule -- YT-0540, a separate in-flight stream.",
  "POST /api/auth/password/reset/request": "AuthModule -- YT-0540, a separate in-flight stream.",
  "POST /api/auth/password/reset/confirm": "AuthModule -- YT-0540, a separate in-flight stream.",
  "POST /api/auth/email/verify/request": "AuthModule -- YT-0540, a separate in-flight stream.",
  "POST /api/auth/email/verify/confirm": "AuthModule -- YT-0540, a separate in-flight stream.",
};

describe("apps/api route inventory vs route-registry.{a,b,c}.ts", () => {
  const live = liveRoutes(apiSrc);
  const declared = ALL_ROUTE_DEFINITIONS;
  const declaredKeys = new Set(declared.map(key));
  const outOfScopeKeys = new Set(Object.keys(KNOWN_OUT_OF_SCOPE));

  it("finds live routes at all", () => {
    // Guards the guard: a moved directory or a decorator rename would
    // otherwise make every assertion below pass over an empty list.
    expect(live.length).toBeGreaterThan(0);
  });

  it("has no live route missing from a route-registry file or the known-out-of-scope ledger", () => {
    const missing = live
      .filter((route) => !declaredKeys.has(key(route)) && !outOfScopeKeys.has(key(route)))
      .map((route) => `${key(route)} (${route.file}:${String(route.line)})`);

    expect(
      missing,
      "These routes exist in apps/api with no entry in any of route-registry.{a,b,c}.ts and no " +
        "KNOWN_OUT_OF_SCOPE entry here. Add one to your area's route-registry.<letter>.ts file " +
        "(see route-registry-shared.ts's header for how request/response shapes are declared), " +
        "or add a ledger entry naming the ticket that still has to give it one.",
    ).toEqual([]);
  });

  it("has no route-registry entry for a route apps/api no longer serves", () => {
    const liveKeys = new Set(live.map(key));
    const stale = declared.filter((route) => !liveKeys.has(key(route))).map(key);

    expect(
      stale,
      "These entries in route-registry.{a,b,c}.ts do not match any live apps/api route. The " +
        "controller was renamed, moved, or removed — update or delete the entry in whichever " +
        "area's file declares it.",
    ).toEqual([]);
  });

  it("has no known-out-of-scope ledger entry that is stale or now declared", () => {
    const liveKeys = new Set(live.map(key));
    const staleLedger = [...outOfScopeKeys].filter((routeKey) => !liveKeys.has(routeKey));
    const nowDeclared = [...outOfScopeKeys].filter((routeKey) => declaredKeys.has(routeKey));

    expect(
      [
        ...staleLedger.map((routeKey) => `${routeKey}: no longer live — remove this ledger entry`),
        ...nowDeclared.map(
          (routeKey) => `${routeKey}: already in a route-registry file — remove this ledger entry`,
        ),
      ],
      "KNOWN_OUT_OF_SCOPE has entries that no longer describe a real gap.",
    ).toEqual([]);
  });
});
