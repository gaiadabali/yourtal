import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "./app.module";

/**
 * YT-0527 — the class of bug `policies/_schemas/resource/business.json`
 * documents by hand: requiring `businessId` on the `business` resource
 * schema made every `business:create` fail Cerbos's own schema enforcement
 * before evaluating a single rule in `business.yaml` — a 403 that had
 * nothing to do with any policy. Every other test of this guard
 * (`pdp.guard.test.ts`, `packages/authz/src/pdp-client.test.ts`) mocks
 * `fetch`, so none of them can see a real Cerbos reject a real request —
 * the mock always answers with whatever effect the test wrote.
 *
 * This boots the actual `AppModule` — the same wiring `main.ts` uses — and
 * calls it over a real HTTP round trip, against a real Cerbos loaded with
 * the real `policies/` directory: `pnpm dev:up` locally, the Cerbos service
 * container `integration.yml` adds for this ticket in CI. No `fetchImpl`
 * override anywhere below. If a policy schema regresses this way again,
 * this fails while every mocked-fetch suite keeps passing — which is
 * exactly what happened the first time, caught only by hand.
 *
 * No `DATABASE_URL` override here: this suite inherits whatever the
 * environment already sets (unset in local `pnpm test`, the migrated
 * database in `integration.yml`), so it exercises whichever repositories
 * `BusinessModule` actually wires in that environment — the point is the
 * PDP round trip, not the persistence layer, and the assertions below never
 * depend on which one answered.
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

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const STRANGER_ID = "22222222-2222-4222-8222-222222222222";

function principalHeaders(userId: string, businessRoles: Record<string, string>) {
  return {
    "x-yt-user-id": userId,
    "x-yt-business-roles": JSON.stringify(businessRoles),
  };
}

describe("business:view against a live PDP", () => {
  const tenantId = "biz-boot-check";

  it("an owner of the tenant is not refused by Cerbos", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/${tenantId}/business`,
      headers: principalHeaders(OWNER_ID, { [tenantId]: "owner" }),
    });
    // Whether the business exists in whichever store answered is not this
    // test's concern — a 404 from the use-case is fine. Only authorization
    // itself is under test.
    expect(response.statusCode).not.toBe(403);
  });

  it("a signed-in caller with no role at THIS tenant is refused", async () => {
    // Cross-tenant denies structurally: the caller holds a role at a
    // DIFFERENT business, so no derived role in derived_roles/business.yaml
    // matches this resource, and Cerbos is deny-by-default.
    const response = await app.inject({
      method: "GET",
      url: `/api/${tenantId}/business`,
      headers: principalHeaders(STRANGER_ID, { "biz-someone-else": "owner" }),
    });
    expect(response.statusCode).toBe(403);
  });

  it("an anonymous caller is refused", async () => {
    const response = await app.inject({ method: "GET", url: `/api/${tenantId}/business` });
    expect(response.statusCode).toBe(403);
  });
});

describe("business:create against a live PDP — the regression this ticket is for", () => {
  it("a signed-in caller is not refused before any rule runs", async () => {
    // The resource here carries NO businessId (create has no tenant yet —
    // see PdpGuard.tenantOf and business.yaml's own comment on this exact
    // rule). If the schema ever requires it again, this is what catches it:
    // Cerbos would reject on schema enforcement and this becomes a 403,
    // indistinguishable from `EFFECT_DENY` to anyone not reading the audit
    // log.
    const response = await app.inject({
      method: "POST",
      url: "/api/businesses",
      headers: principalHeaders(OWNER_ID, { "irrelevant-for-create": "owner" }),
      payload: {},
    });
    // No Idempotency-Key on this request, so a signed-in, authorized caller
    // still lands on 400 (idempotency_key_required) or a body-validation
    // 400 — never 403. That is the assertion: the PDP round trip let the
    // request through to the next layer.
    expect(response.statusCode).not.toBe(403);
  });

  it("an anonymous caller is refused", async () => {
    const response = await app.inject({ method: "POST", url: "/api/businesses", payload: {} });
    expect(response.statusCode).toBe(403);
  });
});
