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
import { BusinessController } from "./business.controller";

/**
 * 1.5.d's "one guard-to-real-Cerbos integration test per module": proof this
 * module's existing (synchronous, tenant-only) attribute wiring already
 * produces a correct answer from a REAL Cerbos, not the mocked
 * `pdp.guard.test.ts`. `business.yaml`'s `view` rule needs a real
 * `x-yt-business-roles` header to resolve `business_report_viewer_of` — see
 * `principal.service.ts` for that header's shape, current pending 1.5.a.
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
const principals = new AsyncPrincipalResolver(new PrincipalService(CONFIG), securityState);
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
// implicit `this: BusinessController` unbound-method carries doesn't matter.
// eslint-disable-next-line @typescript-eslint/unbound-method
const getProfile = BusinessController.prototype.getProfile;

describe("BusinessController.getProfile against real Cerbos", () => {
  it("ALLOWS an owner of the tenant named in the URL", async () => {
    const tenantId = `biz-e2e-${randomUUID()}`;
    const context = contextFor(getProfile, tenantId, {
      "x-yt-business-roles": JSON.stringify({ [tenantId]: "owner" }),
    });
    await expect(guard().canActivate(context)).resolves.toBe(true);
  });

  it("DENIES someone with no role at that tenant at all", async () => {
    const tenantId = `biz-e2e-${randomUUID()}`;
    const context = contextFor(getProfile, tenantId, {});
    await expect(guard().canActivate(context)).rejects.toBeTruthy();
  });

  it("DENIES a role held at a DIFFERENT tenant (F2-shaped: no cross-tenant leak)", async () => {
    const tenantId = `biz-e2e-${randomUUID()}`;
    const otherTenantId = `biz-e2e-${randomUUID()}`;
    const context = contextFor(getProfile, tenantId, {
      "x-yt-business-roles": JSON.stringify({ [otherTenantId]: "owner" }),
    });
    await expect(guard().canActivate(context)).rejects.toBeTruthy();
  });
});
