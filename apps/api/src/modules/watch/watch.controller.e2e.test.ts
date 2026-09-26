import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { NotFoundException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { createPdpClient } from "@yourtal/authz/pdp-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { DrizzleCampaignRepository } from "../campaign/persistence/drizzle-campaign.repository";
import { DrizzleCampaignAuthzAttributesReader } from "../campaign/persistence/drizzle-campaign-authz-attributes";
import { DrizzleWatchSessionRepository } from "./persistence/drizzle-watch-session.repository";
import { CampaignViewAttributeLoader } from "./campaign-view-attribute-loader";
import { WatchController } from "./watch.controller";
import { seedUserProfile } from "../../shared/testing/seed-user-profile";

/**
 * 1.5.d (EW-03), proved end to end.
 *
 * `campaign_view.yaml`'s ALLOW rules all key on `R.attr.state == "live"`,
 * and every route below shipped with `@Authorize({ kind: "campaign_view",
 * ... })` and no attribute loader — the guard sent Cerbos an empty `attr`
 * object, no rule ever matched, and a real Cerbos silently denied every one
 * of these routes. This suite drives the REAL `PdpGuard`, the REAL
 * `WatchController.prototype.start`'s own `@Authorize` metadata (not a
 * stand-in), and a REAL Cerbos sidecar — the same shape
 * `principal-freeze.e2e.test.ts` uses, at `PDP_BASE_URL` (default: the shared
 * 26592). To test unmerged policy changes, point `PDP_BASE_URL` at your slot's
 * own Cerbos, which mounts your worktree's `./policies`, and restart it
 * immediately before this suite: a long-running sidecar can serve a cached schema and
 * hand back a false pass.
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
const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"]!);
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
const campaignAttrs = new DrizzleCampaignAuthzAttributesReader(db);
const sessions = new DrizzleWatchSessionRepository(db);
const loader = new CampaignViewAttributeLoader(campaignAttrs, sessions);

function guard(): PdpGuard {
  return new PdpGuard(new Reflector(), pdp, principals, [loader]);
}

function contextFor(
  handler: (...args: never[]) => unknown,
  params: Record<string, string>,
  body: unknown,
  userId: string,
): ExecutionContext {
  const request = {
    headers: { cookie: `yt_session=${userId}` },
    params,
    body,
  } as unknown as FastifyRequest;
  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

let liveCampaignId = "";
let pausedCampaignId = "";

beforeAll(async () => {
  const visible = await campaignRepository.listVisible(50);
  const longForm = visible.find((campaign) => campaign.kind === "long_form");
  expect(longForm, "the seeded catalogue should contain a live long-form campaign").toBeDefined();
  liveCampaignId = longForm?.id ?? "";

  // A throwaway campaign this suite owns outright, paused from the moment it
  // exists — so `state: "paused"` reaches Cerbos honestly rather than
  // borrowing and mutating a row other suites read concurrently.
  pausedCampaignId = randomUUID();
  await owner.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule,
       lifecycle_state, published_at, business_id, region, audience, content_category,
       poster_url, teaser_url, hls_url, aspect, estimated_bytes,
       starts_at, ends_at, open_viewing, teaser_start_seconds)
    VALUES
      (${pausedCampaignId}, 'quick', 'EW-03 e2e fixture (paused)', ${randomUUID()}, 'e2e merchant',
       'fixture', 60, 5, 100, 0, 'base_only',
       'paused', now(), ${randomUUID()}, 'AU', 'all_ages', 'entertainment',
       'https://example.test/poster.jpg', 'https://example.test/teaser.m3u8',
       'https://example.test/hls.m3u8', '16:9', 1000000,
       now(), now() + interval '30 days', false, 0)
  `);
});

afterAll(async () => {
  await owner.execute(sql`DELETE FROM campaign.campaigns WHERE id = ${pausedCampaignId}`);
});

describe("starting a watch session against a live campaign (1.5.d, EW-03)", () => {
  it('ALLOWS: the loader supplies state:"live" from a real DB read', async () => {
    const userId = randomUUID();
    // 2.5/F31: a signed-in principal with no profile row is refused before
    // the loader ever runs — a real one always has one, so this fixture
    // gives one too. `region: "ID"` because the seeded live/long-form
    // catalogue (packages/db/src/seed/watch.ts) is region ID throughout —
    // an AU principal here would trip the F2 region wall for a reason this
    // suite is not testing.
    await seedUserProfile(db, { userId, region: "ID" });
    const context = contextFor(
      // eslint-disable-next-line @typescript-eslint/unbound-method -- read for its @Authorize metadata only, never called.
      WatchController.prototype.start,
      {},
      { campaignId: liveCampaignId },
      userId,
    );
    await expect(guard().canActivate(context)).resolves.toBe(true);
  });

  it("DENIES a campaign that is not live, on the real Cerbos policy", async () => {
    const userId = randomUUID();
    await seedUserProfile(db, { userId, region: "ID" });
    const context = contextFor(
      // eslint-disable-next-line @typescript-eslint/unbound-method -- read for its @Authorize metadata only, never called.
      WatchController.prototype.start,
      {},
      { campaignId: pausedCampaignId },
      userId,
    );
    await expect(guard().canActivate(context)).rejects.toBeTruthy();
  });

  it("404s a campaign that does not exist at all, same as the route's own check", async () => {
    const userId = randomUUID();
    await seedUserProfile(db, { userId, region: "ID" });
    const context = contextFor(
      // eslint-disable-next-line @typescript-eslint/unbound-method -- read for its @Authorize metadata only, never called.
      WatchController.prototype.start,
      {},
      { campaignId: randomUUID() },
      userId,
    );
    await expect(guard().canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("session-scoped routes resolve their campaign through the session (1.5.d)", () => {
  it("ALLOWS resume/progress/complete once the loader hops sessionId -> campaignId -> state", async () => {
    const userId = randomUUID();
    await seedUserProfile(db, { userId, region: "ID" });
    const termsVersion = await campaignRepository.currentTermsVersion(liveCampaignId);
    expect(termsVersion, "the seeded live campaign should carry published terms").not.toBeNull();

    const { session } = await sessions.startOrResume({
      userId,
      campaignId: liveCampaignId,
      termsVersion: termsVersion ?? 1,
    });

    /* eslint-disable @typescript-eslint/unbound-method -- each is read for its @Authorize metadata only, never called. */
    for (const handler of [
      WatchController.prototype.resume,
      WatchController.prototype.progress,
      WatchController.prototype.complete,
    ]) {
      /* eslint-enable @typescript-eslint/unbound-method */
      const context = contextFor(handler, { sessionId: session.id }, {}, userId);
      await expect(guard().canActivate(context)).resolves.toBe(true);
    }
  });
});
