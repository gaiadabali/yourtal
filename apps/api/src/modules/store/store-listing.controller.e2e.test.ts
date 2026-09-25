import { randomUUID } from "node:crypto";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { createPdpClient } from "@yourtal/authz/pdp-client";
import { describe, expect, it } from "vitest";
import { PdpGuard } from "../../shared/authz/pdp.guard";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { AppConfig } from "../../config/app-config";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { DrizzlePrincipalSecurityStateRepository } from "../identity/persistence/drizzle-principal-security-state.repository";
import { DrizzleUserProfileRepository } from "../identity/persistence/drizzle-user-profile.repository";
import { DrizzleBusinessMembershipReader } from "../identity/persistence/drizzle-business-membership-reader";
import { DrizzleStaffRoleReader } from "../identity/persistence/drizzle-staff-role-reader";
import { StoreListingController } from "./store-listing.controller";

/**
 * 1.5.d's "one guard-to-real-Cerbos integration test per module":
 * `listing.yaml`'s `view` rule needs `business_inventory_viewer_of`
 * (owner/admin/merchandiser/analyst), the same `x-yt-business-roles` shape
 * `business.controller.e2e.test.ts` exercises.
 */
const CONFIG: AppConfig = {
  nodeEnv: "test",
  teenAccounts: false,
  port: 3001,
  pdp: { baseUrl: "http://127.0.0.1:26335", timeoutMs: 500 },
  databaseUrl: process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!,
  redisUrl: "redis://127.0.0.1:26379",
  ledger: {
    mode: "fake" as const,
    baseUrl: "http://127.0.0.1:26312",
    voucherBaseUrl: "http://127.0.0.1:26313",
  },
};

const db: AppDb = createAppDb(CONFIG.databaseUrl);
const securityState = new DrizzlePrincipalSecurityStateRepository(db);
const profiles = new DrizzleUserProfileRepository(db);
const businessMemberships = new DrizzleBusinessMembershipReader(db);
const staffRoles = new DrizzleStaffRoleReader(db);
const principals = new AsyncPrincipalResolver(
  new PrincipalService(CONFIG),
  securityState,
  profiles,
  businessMemberships,
  staffRoles,
);
const pdp = createPdpClient({ baseUrl: CONFIG.pdp.baseUrl });

function guard(): PdpGuard {
  return new PdpGuard(new Reflector(), pdp, principals, []);
}

function contextFor(
  handler: (...args: never[]) => unknown,
  tenantId: string,
  headers: Record<string, string>,
): ExecutionContext {
  const request = {
    params: { tenantId },
    headers: { "x-yt-user-id": randomUUID(), ...headers },
  } as unknown as FastifyRequest;
  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

// Read once, here, for its `@Authorize` metadata only — never called, so the
// implicit `this: StoreListingController` unbound-method carries doesn't matter.
// eslint-disable-next-line @typescript-eslint/unbound-method
const list = StoreListingController.prototype.list;

describe("StoreListingController.list against real Cerbos", () => {
  it("ALLOWS a merchandiser at the tenant named in the URL", async () => {
    const tenantId = `biz-e2e-${randomUUID()}`;
    const context = contextFor(list, tenantId, {
      "x-yt-business-roles": JSON.stringify({ [tenantId]: "merchandiser" }),
    });
    await expect(guard().canActivate(context)).resolves.toBe(true);
  });

  it("DENIES a caller with no role at that tenant", async () => {
    const tenantId = `biz-e2e-${randomUUID()}`;
    const context = contextFor(list, tenantId, {});
    await expect(guard().canActivate(context)).rejects.toBeTruthy();
  });
});
