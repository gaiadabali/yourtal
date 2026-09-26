import { randomUUID } from "node:crypto";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { createPdpClient } from "@yourtal/authz/pdp-client";
import { describe, expect, it } from "vitest";
import { PdpGuard } from "../../shared/authz/pdp.guard";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { PrincipalService } from "../../shared/authz/principal.service";
import { alwaysValidSessionValidator } from "../../shared/testing/fake-session-validator";
import { seedBusinessMembership } from "../../shared/testing/seed-business-membership";
import { seedUserProfile } from "../../shared/testing/seed-user-profile";
import type { AppConfig } from "../../config/app-config";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { DrizzlePrincipalSecurityStateRepository } from "../identity/persistence/drizzle-principal-security-state.repository";
import { DrizzleUserProfileRepository } from "../identity/persistence/drizzle-user-profile.repository";
import { DrizzleBusinessMembershipReader } from "../identity/persistence/drizzle-business-membership-reader";
import { DrizzleStaffRoleReader } from "../identity/persistence/drizzle-staff-role-reader";
import { BusinessController } from "./business.controller";

/**
 * 1.5.d's "one guard-to-real-Cerbos integration test per module": proof this
 * module's existing (synchronous, tenant-only) attribute wiring already
 * produces a correct answer from a REAL Cerbos, not the mocked
 * `pdp.guard.test.ts`. `business.yaml`'s `view` rule needs
 * `business_report_viewer_of`, which as of 1.5.b comes from a REAL
 * `business.business_members` row (via `AsyncPrincipalResolver`'s overlay,
 * which only engages once a principal has a real `identity.user_profile`
 * row) — the `x-yt-business-roles` header this used to be faked through no
 * longer exists as of 1.5.a.
 */
const CONFIG: AppConfig = {
  nodeEnv: "test",
  teenAccounts: false,
  appEnv: "dev",
  session: {
    consumerIdleTtlMs: 30 * 24 * 60 * 60 * 1000,
    consumerAbsoluteTtlMs: 90 * 24 * 60 * 60 * 1000,
    staffAbsoluteTtlMs: 12 * 60 * 60 * 1000,
  },
  port: 3001,
  pdp: { baseUrl: process.env["PDP_BASE_URL"] ?? "http://127.0.0.1:26592", timeoutMs: 500 },
  databaseUrl: process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!,
  redisUrl: "redis://127.0.0.1:26379",
  ledger: {
    mode: "fake" as const,
    baseUrl: "http://127.0.0.1:26312",
    voucherBaseUrl: "http://127.0.0.1:26313",
    voucherServiceSecret: "local-only-voucher-service-secret-not-real",
  },
};

const db: AppDb = createAppDb(CONFIG.databaseUrl);
const securityState = new DrizzlePrincipalSecurityStateRepository(db);
const profiles = new DrizzleUserProfileRepository(db);
const businessMemberships = new DrizzleBusinessMembershipReader(db);
const staffRoles = new DrizzleStaffRoleReader(db);
const principals = new AsyncPrincipalResolver(
  new PrincipalService(alwaysValidSessionValidator()),
  securityState,
  profiles,
  businessMemberships,
  staffRoles,
);
const pdp = createPdpClient({ baseUrl: CONFIG.pdp.baseUrl });

function guard(): PdpGuard {
  return new PdpGuard(new Reflector(), pdp, principals, []);
}

/** `alwaysValidSessionValidator` treats the cookie's token as the user id directly. */
function contextFor(
  handler: (...args: never[]) => unknown,
  tenantId: string,
  userId: string,
): ExecutionContext {
  const request = {
    params: { tenantId },
    headers: { cookie: `yt_session=${userId}` },
  } as unknown as FastifyRequest;
  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

// Read once, here, for its `@Authorize` metadata only — never called, so the
// implicit `this: BusinessController` unbound-method carries doesn't matter.
// eslint-disable-next-line @typescript-eslint/unbound-method
const getProfile = BusinessController.prototype.getProfile;

describe("BusinessController.getProfile against real Cerbos", () => {
  it("ALLOWS an owner of the tenant named in the URL", async () => {
    const userId = `user-e2e-${randomUUID()}`;
    await seedUserProfile(db, { userId });
    const businessId = await seedBusinessMembership(db, { userId, role: "owner" });

    const context = contextFor(getProfile, businessId, userId);
    await expect(guard().canActivate(context)).resolves.toBe(true);
  });

  it("DENIES someone with no role at that tenant at all", async () => {
    const userId = `user-e2e-${randomUUID()}`;
    const context = contextFor(getProfile, randomUUID(), userId);
    await expect(guard().canActivate(context)).rejects.toBeTruthy();
  });

  it("DENIES a role held at a DIFFERENT tenant (F2-shaped: no cross-tenant leak)", async () => {
    const userId = `user-e2e-${randomUUID()}`;
    await seedUserProfile(db, { userId });
    await seedBusinessMembership(db, { userId, role: "owner" }); // membership at a business OTHER than the one below

    const context = contextFor(getProfile, randomUUID(), userId);
    await expect(guard().canActivate(context)).rejects.toBeTruthy();
  });
});
