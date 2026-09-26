import { randomUUID } from "node:crypto";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { createPdpClient } from "@yourtal/authz/pdp-client";
import { beforeAll, describe, expect, it } from "vitest";
import { PdpGuard } from "../../shared/authz/pdp.guard";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { PrincipalService } from "../../shared/authz/principal.service";
import { alwaysValidSessionValidator } from "../../shared/testing/fake-session-validator";
import type { AppConfig } from "../../config/app-config";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { DrizzlePrincipalSecurityStateRepository } from "../identity/persistence/drizzle-principal-security-state.repository";
import { DrizzleUserProfileRepository } from "../identity/persistence/drizzle-user-profile.repository";
import { DrizzleBusinessMembershipReader } from "../identity/persistence/drizzle-business-membership-reader";
import { DrizzleStaffRoleReader } from "../identity/persistence/drizzle-staff-role-reader";
import { DrizzleCampaignRepository } from "./persistence/drizzle-campaign.repository";
import { DrizzleCampaignAuthzAttributesReader } from "./persistence/drizzle-campaign-authz-attributes";
import { DrizzleWatchSessionRepository } from "../watch/persistence/drizzle-watch-session.repository";
import { CampaignViewAttributeLoader } from "../watch/campaign-view-attribute-loader";
import { CampaignController } from "./campaign.controller";
import { seedUserProfile } from "../../shared/testing/seed-user-profile";

/**
 * 1.5.d's "one guard-to-real-Cerbos integration test per module".
 *
 * `GET /api/campaigns/:campaignId` uses the same `campaign_view` kind as
 * `watch.controller.ts` (see that module's own `.e2e.test.ts`) and was
 * exactly as broken by EW-03 before this ticket: the id came from the URL,
 * not a session, so `CampaignViewAttributeLoader`'s `params.campaignId`
 * branch is what fixes it here. `GET /api/campaigns` (the list, no id at
 * all) is deliberately not exercised here — see the loader's own class
 * comment for why a collection route falls through instead.
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
const campaignRepository = new DrizzleCampaignRepository(db);
const loader = new CampaignViewAttributeLoader(
  new DrizzleCampaignAuthzAttributesReader(db),
  new DrizzleWatchSessionRepository(db),
);

function guard(): PdpGuard {
  return new PdpGuard(new Reflector(), pdp, principals, [loader]);
}

function contextFor(
  handler: (...args: never[]) => unknown,
  params: Record<string, string>,
  userId: string,
): ExecutionContext {
  const request = {
    params,
    headers: { cookie: `yt_session=${userId}` },
  } as unknown as FastifyRequest;
  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

let liveCampaignId = "";

beforeAll(async () => {
  const visible = await campaignRepository.listVisible(50);
  expect(visible.length, "the seeded catalogue should be non-empty").toBeGreaterThan(0);
  liveCampaignId = visible[0]?.id ?? "";
});

// Read once, here, for its `@Authorize` metadata only — never called, so the
// implicit `this: CampaignController` unbound-method carries doesn't matter.
// eslint-disable-next-line @typescript-eslint/unbound-method
const get = CampaignController.prototype.get;

describe("CampaignController.get against real Cerbos", () => {
  it("ALLOWS a signed-in viewer reading a live campaign by id", async () => {
    const userId = randomUUID();
    // 2.5/F31: a signed-in principal with no profile row is refused before
    // Cerbos is ever asked — a real one always has one, so this fixture
    // gives one too. `region: "ID"` because the seeded live catalogue
    // (packages/db/src/seed/watch.ts) is region ID throughout — an AU
    // principal here would trip the F2 region wall for a reason this test
    // is not about.
    await seedUserProfile(db, { userId, region: "ID" });
    const context = contextFor(get, { campaignId: liveCampaignId }, userId);
    await expect(guard().canActivate(context)).resolves.toBe(true);
  });
});
