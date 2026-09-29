import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
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
import { createLedgerClient } from "../../shared/ledger-client/create-ledger-client";
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

type FixtureAudience = "all_ages" | "teen" | "adult" | "parents";
type FixtureRegion = "AU" | "ID";

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
 *
 * 11.2.a added the anonymous cases below: `campaign_view.yaml`'s
 * `open-viewing-is-opt-in-and-funded` rule also requires
 * `R.attr.openViewingBudgetRemaining`, which `CampaignViewAttributeLoader`
 * never supplied — every anonymous Open Viewing read 401'd regardless of
 * funding, and nothing caught it because this suite (and
 * `watch.controller.e2e.test.ts`) only ever exercised the signed-in path.
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
  objectStorage: {
    endpoint: "http://127.0.0.1:26900",
    accessKeyId: "yourtal",
    secretAccessKey: "yourtal_local_only",
    bucket: "yourtal-media",
  },
  webOrigin: "http://localhost:3000",
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
const ledger = createLedgerClient(CONFIG, db);
const loader = new CampaignViewAttributeLoader(
  new DrizzleCampaignAuthzAttributesReader(db),
  new DrizzleWatchSessionRepository(db),
  campaignRepository,
  ledger,
);

function guard(): PdpGuard {
  return new PdpGuard(new Reflector(), pdp, principals, [loader]);
}

/** `userId: null` sends no `yt_session` cookie at all — an anonymous caller (see `principal.service.ts`). */
function contextFor(
  handler: (...args: never[]) => unknown,
  params: Record<string, string>,
  userId: string | null,
): ExecutionContext {
  const request = {
    params,
    headers: userId === null ? {} : { cookie: `yt_session=${userId}` },
  } as unknown as FastifyRequest;
  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

let liveCampaignId = "";
let openViewingFundedId = "";
let openViewingExhaustedId = "";

/** A throwaway `campaign.campaigns` row this suite owns outright, funded to the given remaining points (11.2.a). */
async function insertOpenViewingCampaign(remainingPoints: number): Promise<string> {
  const campaignId = randomUUID();
  const businessId = randomUUID();
  const allocationId = randomUUID();
  await owner.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule,
       lifecycle_state, published_at, business_id, region, audience, content_category,
       poster_url, teaser_url, hls_url, aspect, estimated_bytes,
       starts_at, ends_at, open_viewing, teaser_start_seconds)
    VALUES
      (${campaignId}, 'quick', '11.2.a e2e fixture (open viewing)', ${randomUUID()}, 'e2e merchant',
       'fixture', 30, 5, 10, 0, 'base_only',
       'live', now(), ${businessId}, 'AU', 'all_ages', 'entertainment',
       'https://example.test/poster.jpg', 'https://example.test/teaser.mp4',
       'https://example.test/hls.m3u8', '16:9', 1000000,
       now(), now() + interval '30 days', true, 0)
  `);
  await owner.execute(sql`
    INSERT INTO platform.ledger_fake_allocation
      (id, business_id, region, funder_type, currency, total_points, remaining_points)
    VALUES (${allocationId}, ${businessId}, 'AU', 'partner', 'AUD', 1000, ${remainingPoints})
  `);
  await owner.execute(sql`
    INSERT INTO campaign.reward_config
      (campaign_id, allocation_id, funder_type, max_points_for_campaign,
       reward_points_per_completion, accuracy_bonus_points)
    VALUES (${campaignId}, ${allocationId}, 'partner', 10, 10, 0)
  `);
  return campaignId;
}

/**
 * 12.1.f: a throwaway, minimal `live` campaign in a given region/audience,
 * for the region+audience scoping suite below. Mirrors
 * `teen-audience-wall.e2e.test.ts`'s own `insertCampaign` (down to the
 * video_source row -- `campaignSchema.videoSource` is REQUIRED, and without
 * one `DrizzleCampaignRepository.assemble()` silently drops the row from
 * every list, which is exactly the kind of false negative this suite must
 * not produce), generalised to a region param since that file's fixtures
 * are AU-only.
 */
async function insertCampaignFixture(
  region: FixtureRegion,
  audience: FixtureAudience,
): Promise<string> {
  const campaignId = randomUUID();
  await owner.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule,
       lifecycle_state, published_at, business_id, region, audience, content_category,
       poster_url, teaser_url, hls_url, aspect, estimated_bytes,
       starts_at, ends_at, open_viewing, teaser_start_seconds)
    VALUES
      (${campaignId}, 'quick', ${`12.1.f e2e fixture (${region}/${audience})`}, ${randomUUID()},
       'e2e merchant', 'fixture', 30, 5, 10, 0, 'base_only',
       'live', now(), ${randomUUID()}, ${region}, ${audience}, 'entertainment',
       'https://example.test/poster.jpg', 'https://example.test/teaser.mp4',
       'https://example.test/hls.m3u8', '16:9', 1000000,
       now(), now() + interval '30 days', false, 0)
  `);
  await owner.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${campaignId}, 'hls', 'https://example.test/hls.m3u8')
  `);
  return campaignId;
}

let auAdultCampaignId = "";
let auAllAgesCampaignId = "";
let auTeenCampaignId = "";
let idAdultCampaignId = "";
const auAdultUserId = randomUUID();
const idAdultUserId = randomUUID();
const auTeenGrantedUserId = randomUUID();

/** A recent-enough date of birth to land in the teen band (13-17). */
function teenDateOfBirth(): string {
  const now = new Date();
  const dob = new Date(Date.UTC(now.getUTCFullYear() - 15, now.getUTCMonth(), now.getUTCDate()));
  return dob.toISOString().split("T")[0] ?? "2011-01-01";
}

beforeAll(async () => {
  const visible = await campaignRepository.listVisible(50);
  expect(visible.length, "the seeded catalogue should be non-empty").toBeGreaterThan(0);
  liveCampaignId = visible[0]?.id ?? "";

  openViewingFundedId = await insertOpenViewingCampaign(500);
  openViewingExhaustedId = await insertOpenViewingCampaign(0);

  auAdultCampaignId = await insertCampaignFixture("AU", "adult");
  auAllAgesCampaignId = await insertCampaignFixture("AU", "all_ages");
  auTeenCampaignId = await insertCampaignFixture("AU", "teen");
  idAdultCampaignId = await insertCampaignFixture("ID", "adult");

  await seedUserProfile(db, { userId: auAdultUserId, region: "AU" });
  await seedUserProfile(db, { userId: idAdultUserId, region: "ID" });
  await seedUserProfile(db, {
    userId: auTeenGrantedUserId,
    region: "AU",
    dateOfBirth: teenDateOfBirth(),
    parentConsentStatus: "granted",
  });
});

afterAll(async () => {
  for (const id of [openViewingFundedId, openViewingExhaustedId]) {
    await owner.execute(sql`DELETE FROM campaign.reward_config WHERE campaign_id = ${id}`);
    await owner.execute(sql`DELETE FROM campaign.campaigns WHERE id = ${id}`);
  }
  for (const id of [auAdultCampaignId, auAllAgesCampaignId, auTeenCampaignId, idAdultCampaignId]) {
    await owner.execute(sql`DELETE FROM campaign.video_source WHERE campaign_id = ${id}`);
    await owner.execute(sql`DELETE FROM campaign.campaigns WHERE id = ${id}`);
  }
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

  it("ALLOWS an anonymous caller reading a live, open-viewing, funded campaign (11.2.a)", async () => {
    const context = contextFor(get, { campaignId: openViewingFundedId }, null);
    await expect(guard().canActivate(context)).resolves.toBe(true);
  });

  it("DENIES an anonymous caller once the campaign's funding is exhausted (11.2.a, docs/17 §4.2)", async () => {
    const context = contextFor(get, { campaignId: openViewingExhaustedId }, null);
    await expect(guard().canActivate(context)).rejects.toMatchObject({ status: 401 });
  });

  it("DENIES an anonymous caller reading a campaign that has not opted into Open Viewing", async () => {
    const context = contextFor(get, { campaignId: liveCampaignId }, null);
    await expect(guard().canActivate(context)).rejects.toMatchObject({ status: 401 });
  });
});

// eslint-disable-next-line @typescript-eslint/unbound-method
const list = CampaignController.prototype.list;
const controller = new CampaignController(campaignRepository, principals);

/**
 * Called directly (not through Nest's HTTP layer), so the `region` query
 * param is passed to `controller.list` as its own argument below, exactly
 * as `teen-audience-wall.e2e.test.ts`'s own direct calls already do for
 * `limit` -- this only carries the session cookie a real request would.
 */
function requestFor(userId: string | null): FastifyRequest {
  return { headers: userId === null ? {} : { cookie: `yt_session=${userId}` } } as FastifyRequest;
}

describe("CampaignController.list against real Cerbos (12.1.f, defect #1)", () => {
  it("ALLOWS a signed-in viewer, unconditionally -- browse carries no per-campaign attribute", async () => {
    const context = contextFor(list, {}, auAdultUserId);
    await expect(guard().canActivate(context)).resolves.toBe(true);
  });

  it("ALLOWS an anonymous caller too -- the list is public browse, same as the store catalogue", async () => {
    const context = contextFor(list, {}, null);
    await expect(guard().canActivate(context)).resolves.toBe(true);
  });
});

describe("GET /api/campaigns -- region and audience scoping (12.1.f, defect #2)", () => {
  it("an AU adult sees the AU adult and AU all_ages campaigns, never the ID one or the AU teen one", async () => {
    const { campaigns } = await controller.list(undefined, undefined, requestFor(auAdultUserId));
    const ids = campaigns.map((campaign) => campaign.id);
    expect(ids).toContain(auAdultCampaignId);
    expect(ids).toContain(auAllAgesCampaignId);
    expect(ids).not.toContain(idAdultCampaignId);
    expect(ids).not.toContain(auTeenCampaignId);
  });

  it("an ID adult sees only the ID campaign, never any AU one (F2)", async () => {
    const { campaigns } = await controller.list(undefined, undefined, requestFor(idAdultUserId));
    const ids = campaigns.map((campaign) => campaign.id);
    expect(ids).toContain(idAdultCampaignId);
    expect(ids).not.toContain(auAdultCampaignId);
    expect(ids).not.toContain(auAllAgesCampaignId);
    expect(ids).not.toContain(auTeenCampaignId);
  });

  it("an AU teen sees the AU teen and all_ages campaigns, but never the AU adult one", async () => {
    const { campaigns } = await controller.list(
      undefined,
      undefined,
      requestFor(auTeenGrantedUserId),
    );
    const ids = campaigns.map((campaign) => campaign.id);
    expect(ids).toContain(auTeenCampaignId);
    expect(ids).toContain(auAllAgesCampaignId);
    expect(ids).not.toContain(auAdultCampaignId);
  });

  it("anonymous, given a region, sees only that region's all_ages campaigns", async () => {
    const { campaigns } = await controller.list(undefined, "AU", requestFor(null));
    const ids = campaigns.map((campaign) => campaign.id);
    expect(ids).toContain(auAllAgesCampaignId);
    expect(ids).not.toContain(auAdultCampaignId);
    expect(ids).not.toContain(auTeenCampaignId);
    expect(ids).not.toContain(idAdultCampaignId);
  });

  it("anonymous with no region query param is a 400, not a silent default (there is no session to read one from)", async () => {
    await expect(controller.list(undefined, undefined, requestFor(null))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("a signed-in caller whose `?region=` query disagrees with their own jurisdiction gets an empty list, not the other region's data", async () => {
    const { campaigns } = await controller.list(undefined, "ID", requestFor(auAdultUserId));
    expect(campaigns).toEqual([]);
  });
});
