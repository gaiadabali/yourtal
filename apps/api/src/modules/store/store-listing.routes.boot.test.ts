import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import { seedBusinessMembership } from "../../shared/testing/seed-business-membership";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";

/**
 * Every `@Authorize` action the listing routes declare, asked of a LIVE
 * Cerbos through the real `PdpGuard`.
 *
 * ## Why this file exists
 *
 * On 2026-09-21 `create`, `edit` and `archive` were **denied over HTTP for
 * everyone** and this module's suite stayed green. YT-0574 had put a
 * positive-evidence condition on `merchandisers-run-inventory`, a single
 * rule covering four actions — but only `set_settlement_value` has a route
 * that supplies `isMaterialSettlementDecrease` (the controller's second,
 * explicit PDP call after loading the listing). The other three are wired
 * with `@Authorize` alone, which supplies no attributes, so `has(...)` was
 * false and the ALLOW never fired. Found by the platform session while
 * applying the YT-0576 policy half.
 *
 * Nothing here could see it. `store-listing.controller.material-decrease
 * .test.ts` calls controller methods DIRECTLY, so `PdpGuard` never runs —
 * its settlement-value cases pass only because that controller asks the PDP
 * a second time in its own body. A test that invokes the method has skipped
 * the decorator, and the decorator was the part that was broken.
 *
 * So this asserts the one thing neither the policy suite nor the controller
 * suite can: **that the route reaches the PDP and the PDP says yes.** The
 * policy repo's own tests prove the rules are right about actions; the
 * authz drift test proves the registry and the policy agree on names.
 * Neither proves a request survives the round trip.
 *
 * Existence is deliberately not under test — a 404 from the use-case is a
 * pass. Only a 403 is a failure, which is why no listing row is seeded.
 * Same reasoning as `app.boot.test.ts`, whose harness this copies.
 *
 * 1.5.a: `TENANT` is a real `business.business_accounts` row now (a
 * `business.business_members` FK requires one), and the merchandiser is a
 * real, registered account via `sessionFor` — `AsyncPrincipalResolver`'s
 * 1.5.b overlay reads real business roles only for a principal with a real
 * `identity.user_profile` row.
 */
let app: NestFastifyApplication;
let db: AppDb;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
});

afterAll(async () => {
  await app.close();
});

// `merchandiser` rather than `owner` on purpose, below. `business_inventory_editor_of`
// admits `owner`, `admin` and `merchandiser` alike (`derived_roles/business.yaml:72`),
// and testing the least-privileged role that should pass is what catches a rule
// narrowing to owners only — an owner-only test goes green through exactly that
// regression.

const listingId = randomUUID();

/** Each row is one `@Authorize({ kind: "listing", action })` on the controller. */
function routesFor(tenantId: string) {
  return [
    { action: "create", method: "POST" as const, url: `/api/${tenantId}/store/listings` },
    { action: "view (list)", method: "GET" as const, url: `/api/${tenantId}/store/listings` },
    {
      action: "view (one)",
      method: "GET" as const,
      url: `/api/${tenantId}/store/listings/${listingId}`,
    },
    {
      action: "view (price revisions)",
      method: "GET" as const,
      url: `/api/${tenantId}/store/listings/${listingId}/price-revisions`,
    },
    {
      action: "edit",
      method: "PATCH" as const,
      url: `/api/${tenantId}/store/listings/${listingId}`,
    },
    {
      action: "edit (pause)",
      method: "POST" as const,
      url: `/api/${tenantId}/store/listings/${listingId}/pause`,
    },
    {
      action: "edit (resume)",
      method: "POST" as const,
      url: `/api/${tenantId}/store/listings/${listingId}/resume`,
    },
    {
      action: "archive (retire)",
      method: "POST" as const,
      url: `/api/${tenantId}/store/listings/${listingId}/retire`,
    },
  ];
}

// The route list is the same shape for every tenant; only the URLs differ.
// Iterating action NAMES (rather than a fixed list of route objects) is what
// lets each test below build its own real tenant and regenerate the URLs
// that belong to it.
const ROUTE_ACTIONS = routesFor("_").map((route) => route.action);

describe("listing routes reach a live PDP and are not refused for a merchandiser", () => {
  for (const action of ROUTE_ACTIONS) {
    it(`${action} is not 403`, async () => {
      const session = await sessionFor(app);
      const businessId = await seedBusinessMembership(db, {
        userId: session.userId,
        role: "merchandiser",
      });
      const ownRoute = routesFor(businessId).find((route) => route.action === action);
      if (ownRoute === undefined) throw new Error("route not found");

      const response = await app.inject({
        method: ownRoute.method,
        url: ownRoute.url,
        headers: { cookie: session.cookie },
        // Spread rather than `payload: cond ? undefined : {}`. `exactOptionalPropertyTypes`
        // is on (packages/tsconfig/base.json), so an optional property cannot be
        // handed an explicit `undefined` -- omitting the key and passing it as
        // undefined are different types, and only the first one compiles.
        ...(ownRoute.method === "GET" ? {} : { payload: {} }),
      });
      expect(response.statusCode).not.toBe(403);
    });
  }
});

describe("the same routes still refuse someone with no role at this tenant", () => {
  // This half does two jobs, and the second one is why it is not optional.
  //
  // 1. Without it the suite above could be satisfied by an authorization
  //    layer that allows everything -- the failure mode opposite to the one
  //    that prompted the file.
  // 2. It is the ONLY thing proving these URLs exist. `not.toBe(403)` passes
  //    on a 404, so the allow half is vacuous against a wrong path -- and it
  //    was: this file was first written against `/api/:tenantId/listings`,
  //    missing the `store` segment, and all eight allow cases passed green
  //    on 404s. A stranger getting 403 can only happen if the route exists
  //    AND the guard ran, so it pins both.
  for (const action of ROUTE_ACTIONS) {
    it(`${action} is 403 for a stranger`, async () => {
      const stranger = await sessionFor(app);
      const tenantId = randomUUID(); // a syntactically valid, but nonexistent, business
      const ownRoute = routesFor(tenantId).find((route) => route.action === action);
      if (ownRoute === undefined) throw new Error("route not found");

      const response = await app.inject({
        method: ownRoute.method,
        url: ownRoute.url,
        headers: { cookie: stranger.cookie },
        // Spread rather than `payload: cond ? undefined : {}`. `exactOptionalPropertyTypes`
        // is on (packages/tsconfig/base.json), so an optional property cannot be
        // handed an explicit `undefined` -- omitting the key and passing it as
        // undefined are different types, and only the first one compiles.
        ...(ownRoute.method === "GET" ? {} : { payload: {} }),
      });
      expect(response.statusCode).toBe(403);
    });
  }
});
