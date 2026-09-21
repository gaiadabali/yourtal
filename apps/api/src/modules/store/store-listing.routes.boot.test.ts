import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";

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
 * pass. Only a 403 is a failure, which is why no row is seeded. Same
 * reasoning as `app.boot.test.ts`, whose harness this copies.
 */
let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

const TENANT = "biz-listing-boot-check";
const MERCHANDISER_ID = "33333333-3333-4333-8333-333333333333";
const STRANGER_ID = "44444444-4444-4444-8444-444444444444";

/**
 * `merchandiser` rather than `owner` on purpose. `business_inventory_editor_of`
 * admits `owner`, `admin` and `merchandiser` alike
 * (`derived_roles/business.yaml:72`), and testing the least-privileged role
 * that should pass is what catches a rule narrowing to owners only — an
 * owner-only test goes green through exactly that regression.
 */
function headers(userId: string, roleHere: string) {
  return {
    "x-yt-user-id": userId,
    "x-yt-business-roles": JSON.stringify({ [TENANT]: roleHere }),
  };
}

const listingId = randomUUID();

/** Each row is one `@Authorize({ kind: "listing", action })` on the controller. */
const ROUTES = [
  { action: "create", method: "POST" as const, url: `/api/${TENANT}/store/listings` },
  { action: "view (list)", method: "GET" as const, url: `/api/${TENANT}/store/listings` },
  {
    action: "view (one)",
    method: "GET" as const,
    url: `/api/${TENANT}/store/listings/${listingId}`,
  },
  {
    action: "view (price revisions)",
    method: "GET" as const,
    url: `/api/${TENANT}/store/listings/${listingId}/price-revisions`,
  },
  { action: "edit", method: "PATCH" as const, url: `/api/${TENANT}/store/listings/${listingId}` },
  {
    action: "edit (pause)",
    method: "POST" as const,
    url: `/api/${TENANT}/store/listings/${listingId}/pause`,
  },
  {
    action: "edit (resume)",
    method: "POST" as const,
    url: `/api/${TENANT}/store/listings/${listingId}/resume`,
  },
  {
    action: "archive (retire)",
    method: "POST" as const,
    url: `/api/${TENANT}/store/listings/${listingId}/retire`,
  },
];

describe("listing routes reach a live PDP and are not refused for a merchandiser", () => {
  for (const route of ROUTES) {
    it(`${route.action} is not 403`, async () => {
      const response = await app.inject({
        method: route.method,
        url: route.url,
        headers: headers(MERCHANDISER_ID, "merchandiser"),
        // Spread rather than `payload: cond ? undefined : {}`. `exactOptionalPropertyTypes`
        // is on (packages/tsconfig/base.json), so an optional property cannot be
        // handed an explicit `undefined` -- omitting the key and passing it as
        // undefined are different types, and only the first one compiles.
        ...(route.method === "GET" ? {} : { payload: {} }),
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
  for (const route of ROUTES) {
    it(`${route.action} is 403 for a stranger`, async () => {
      const response = await app.inject({
        method: route.method,
        url: route.url,
        headers: {
          "x-yt-user-id": STRANGER_ID,
          "x-yt-business-roles": JSON.stringify({ "biz-somewhere-else": "owner" }),
        },
        // Spread rather than `payload: cond ? undefined : {}`. `exactOptionalPropertyTypes`
        // is on (packages/tsconfig/base.json), so an optional property cannot be
        // handed an explicit `undefined` -- omitting the key and passing it as
        // undefined are different types, and only the first one compiles.
        ...(route.method === "GET" ? {} : { payload: {} }),
      });
      expect(response.statusCode).toBe(403);
    });
  }
});
