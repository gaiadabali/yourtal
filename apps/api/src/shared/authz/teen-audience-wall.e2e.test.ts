import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { createPdpClient } from "@yourtal/authz/pdp-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../../config/app-config";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { createLedgerClient } from "../ledger-client/create-ledger-client";
import { PdpGuard } from "./pdp.guard";
import { AsyncPrincipalResolver } from "./async-principal-resolver";
import { PrincipalService } from "./principal.service";
import { alwaysValidSessionValidator } from "../testing/fake-session-validator";
import { seedUserProfile } from "../testing/seed-user-profile";
import { DrizzlePrincipalSecurityStateRepository } from "../../modules/identity/persistence/drizzle-principal-security-state.repository";
import { DrizzleUserProfileRepository } from "../../modules/identity/persistence/drizzle-user-profile.repository";
import { DrizzleBusinessMembershipReader } from "../../modules/identity/persistence/drizzle-business-membership-reader";
import { DrizzleStaffRoleReader } from "../../modules/identity/persistence/drizzle-staff-role-reader";
import { DrizzleCampaignRepository } from "../../modules/campaign/persistence/drizzle-campaign.repository";
import { DrizzleCampaignAuthzAttributesReader } from "../../modules/campaign/persistence/drizzle-campaign-authz-attributes";
import { DrizzleWatchSessionRepository } from "../../modules/watch/persistence/drizzle-watch-session.repository";
import { CampaignViewAttributeLoader } from "../../modules/watch/campaign-view-attribute-loader";
import { CampaignController } from "../../modules/campaign/campaign.controller";
import { ChannelController } from "../../modules/campaign/channel.controller";
import { DrizzleChannelLookupRepository } from "../../modules/campaign/persistence/drizzle-channel-lookup.repository";
import { WatchController } from "../../modules/watch/watch.controller";
import { StoreCatalogueController } from "../../modules/store/store-catalogue.controller";
import { DrizzleListingRepository } from "../../modules/store/persistence/drizzle-listing.repository";

/**
 * 12.1.a/12.1.b/12.1.c end to end, against real Cerbos and real Postgres:
 * a teen (pending or granted guardian consent) reading/earning across
 * campaign, watch and store surfaces this worktree's own `policies/` now
 * gate on `audience`/`guardianConsent`.
 *
 * Mirrors `campaign.controller.e2e.test.ts`'s own "construct `PdpGuard`
 * directly, drive it with a fabricated `ExecutionContext`" shape rather
 * than a full HTTP app -- the same reason that file gives: this is a
 * guard-to-real-Cerbos integration proof, not a route contract test.
 * `WatchController.prototype.start` is read for its `@Authorize` metadata
 * only, exactly as `CampaignController.prototype.get` is in that file --
 * `watch.controller.ts` itself is never edited or executed here (slot 4
 * owns it; PdpGuard denies BEFORE the handler body ever runs).
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
  port: 3001,
  pdp: { baseUrl: process.env["PDP_BASE_URL"] ?? "http://127.0.0.1:26615", timeoutMs: 500 },
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
const principals = new AsyncPrincipalResolver(
  new PrincipalService(alwaysValidSessionValidator()),
  new DrizzlePrincipalSecurityStateRepository(db),
  new DrizzleUserProfileRepository(db),
  new DrizzleBusinessMembershipReader(db),
  new DrizzleStaffRoleReader(db),
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
const listings = new DrizzleListingRepository(db, ledger);
const catalogueController = new StoreCatalogueController(listings, principals, pdp);
const channelController = new ChannelController(
  new DrizzleChannelLookupRepository(db),
  campaignRepository,
  listings,
  principals,
);

function guard(): PdpGuard {
  return new PdpGuard(new Reflector(), pdp, principals, [loader]);
}

function contextFor(
  handler: (...args: never[]) => unknown,
  params: Record<string, string>,
  userId: string,
  body?: unknown,
): ExecutionContext {
  const request = {
    params,
    body: body ?? {},
    headers: { cookie: `yt_session=${userId}` },
  } as unknown as FastifyRequest;
  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

// Read once for their `@Authorize` metadata only -- never called directly.
// eslint-disable-next-line @typescript-eslint/unbound-method
const getCampaign = CampaignController.prototype.get;
// eslint-disable-next-line @typescript-eslint/unbound-method
const startSession = WatchController.prototype.start;

let teenCampaignId = "";
let adultCampaignId = "";
let teenListingId = "";
let adultListingId = "";
const channelBusinessId = randomUUID();
const channelHandle = `e2e-channel-${channelBusinessId.slice(0, 8)}`;
let channelTeenCampaignId = "";
let channelAdultCampaignId = "";

const teenPendingUserId = randomUUID();
const teenGrantedUserId = randomUUID();
const adultUserId = randomUUID();

/** A recent-enough date of birth to land in the teen band (13-17). */
function teenDateOfBirth(): string {
  const now = new Date();
  const dob = new Date(Date.UTC(now.getUTCFullYear() - 15, now.getUTCMonth(), now.getUTCDate()));
  return dob.toISOString().split("T")[0] ?? "2011-01-01";
}

async function insertCampaign(
  audience: "teen" | "adult",
  businessId: string = randomUUID(),
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
      (${campaignId}, 'quick', ${`12.1.b e2e fixture (${audience})`}, ${randomUUID()}, 'e2e merchant',
       'fixture', 30, 5, 10, 0, 'base_only',
       'live', now(), ${businessId}, 'AU', ${audience}, 'entertainment',
       'https://example.test/poster.jpg', 'https://example.test/teaser.mp4',
       'https://example.test/hls.m3u8', '16:9', 1000000,
       now(), now() + interval '30 days', false, 0)
  `);
  await owner.execute(sql`
    INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds, accuracy_bonus_points, effective_from)
    VALUES (${campaignId}, 1, 10, 0, 'base_only', 30, 0, now())
  `);
  // `campaignSchema.videoSource` is REQUIRED (packages/contracts/src/campaign/campaign.ts)
  // -- with no row here, `DrizzleCampaignRepository.assemble()` fails to
  // parse and DROPS the row from every list silently (`campaign that fails
  // to parse is dropped`, that file's own comment), which is exactly why
  // this campaign never showed up in `listVisible` before this fixed it.
  await owner.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${campaignId}, 'hls', 'https://example.test/hls.m3u8')
  `);
  return campaignId;
}

/**
 * A fresh, throwaway AU listing row this suite owns outright -- copies one
 * seeded ID row's shape (same reasoning `checkout.controller.test.ts`'s own
 * `buyableListing` gives: the seed is ID-only), but targets the ONE row it
 * just inserted by id rather than picking any random AU row afterwards --
 * two calls in the same suite must never race each other onto the same row.
 */
async function listingWithAudience(audience: "teen" | "adult"): Promise<string> {
  const newId = randomUUID();
  const sourceRows = await owner.execute<{ id: string }>(sql`
    SELECT id::text FROM store.listings WHERE region = 'ID' LIMIT 1`);
  const sourceId = sourceRows.rows[0]?.id;
  if (sourceId === undefined) throw new Error("no seeded ID listing to copy for the fixture");

  await owner.execute(sql`
    INSERT INTO store.listings
    SELECT (jsonb_populate_record(NULL::store.listings, to_jsonb(l)
              || jsonb_build_object('id', ${newId}::uuid, 'region', 'AU', 'currency', 'AUD'))).*
      FROM store.listings l
     WHERE l.id = ${sourceId}::uuid`);
  await owner.execute(sql`
    UPDATE store.listings SET lifecycle_state = 'active', status = 'available', stock_remaining = stock_total,
           expires_at = now() + interval '30 days', audience = ${audience}
     WHERE id = ${newId}::uuid`);
  // `listingSchema` requires >=1 location -- copied separately because
  // `store.listing_location` is its own join table, not a column on
  // `store.listings` itself (see `listing.table.ts`).
  await owner.execute(sql`
    INSERT INTO store.listing_location (listing_id, location_id)
    SELECT ${newId}::uuid, location_id FROM store.listing_location WHERE listing_id = ${sourceId}::uuid`);
  return newId;
}

beforeAll(async () => {
  await seedUserProfile(db, {
    userId: teenPendingUserId,
    region: "AU",
    dateOfBirth: teenDateOfBirth(),
    parentConsentStatus: "pending",
  });
  await seedUserProfile(db, {
    userId: teenGrantedUserId,
    region: "AU",
    dateOfBirth: teenDateOfBirth(),
    parentConsentStatus: "granted",
  });
  await seedUserProfile(db, { userId: adultUserId, region: "AU" });

  teenCampaignId = await insertCampaign("teen");
  adultCampaignId = await insertCampaign("adult");
  teenListingId = await listingWithAudience("teen");
  adultListingId = await listingWithAudience("adult");

  // A channel: one business, one teen-audience and one adult-audience
  // campaign, so the channel page's own campaign grid has something to
  // over-disclose if `ChannelController` ever stopped filtering it.
  await owner.execute(sql`
    INSERT INTO business.business_accounts
      (id, legal_name, display_name, district, roles, is_verified, region, currency, handle)
    VALUES
      (${channelBusinessId}, '12.1.b e2e channel business', '12.1.b e2e channel business',
       'Testville', '["advertiser"]'::jsonb, true, 'AU', 'AUD', ${channelHandle})
  `);
  channelTeenCampaignId = await insertCampaign("teen", channelBusinessId);
  channelAdultCampaignId = await insertCampaign("adult", channelBusinessId);
});

afterAll(async () => {
  for (const id of [teenCampaignId, adultCampaignId, channelTeenCampaignId, channelAdultCampaignId]) {
    await owner.execute(sql`DELETE FROM campaign.terms_version WHERE campaign_id = ${id}`);
    await owner.execute(sql`DELETE FROM campaign.video_source WHERE campaign_id = ${id}`);
    await owner.execute(sql`DELETE FROM campaign.campaigns WHERE id = ${id}`);
  }
  await owner.execute(sql`DELETE FROM business.business_accounts WHERE id = ${channelBusinessId}`);
  for (const id of [teenListingId, adultListingId]) {
    await owner.execute(sql`DELETE FROM store.listing_location WHERE listing_id = ${id}::uuid`);
    await owner.execute(sql`DELETE FROM store.listings WHERE id = ${id}::uuid`);
  }
});

describe("GET /api/campaigns/:campaignId -- the audience wall", () => {
  it("a pending teen reads a teen-audience campaign (browsing needs no guardian consent)", async () => {
    const context = contextFor(getCampaign, { campaignId: teenCampaignId }, teenPendingUserId);
    await expect(guard().canActivate(context)).resolves.toBe(true);
  });

  it("an adult is denied the same teen-audience campaign", async () => {
    const context = contextFor(getCampaign, { campaignId: teenCampaignId }, adultUserId);
    await expect(guard().canActivate(context)).rejects.toMatchObject({ status: 403 });
  });

  it("a teen is denied an adult-audience campaign", async () => {
    const context = contextFor(getCampaign, { campaignId: adultCampaignId }, teenPendingUserId);
    await expect(guard().canActivate(context)).rejects.toMatchObject({ status: 403 });
  });
});

describe("POST /api/watch/sessions -- earning needs a GRANTED guardian consent, browsing does not", () => {
  it("denies a PENDING teen starting a reward session on a teen campaign", async () => {
    const context = contextFor(startSession, {}, teenPendingUserId, { campaignId: teenCampaignId });
    await expect(guard().canActivate(context)).rejects.toMatchObject({ status: 403 });
  });

  it("allows a GRANTED teen to start the same reward session", async () => {
    const context = contextFor(startSession, {}, teenGrantedUserId, { campaignId: teenCampaignId });
    await expect(guard().canActivate(context)).resolves.toBe(true);
  });
});

describe("the store catalogue's offer detail -- the same audience wall on `listing`", () => {
  it("a teen reads a teen-audience listing", async () => {
    const request = { headers: { cookie: `yt_session=${teenPendingUserId}` } } as FastifyRequest;
    const result = await catalogueController.get(teenListingId, "AU", request);
    expect(result.id).toBe(teenListingId);
  });

  it("a teen is denied (404, not 403) an adult-audience listing", async () => {
    const request = { headers: { cookie: `yt_session=${teenPendingUserId}` } } as FastifyRequest;
    await expect(catalogueController.get(adultListingId, "AU", request)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("GET /api/campaigns -- the list agrees with the single-item wall", () => {
  it("a teen's list contains the teen campaign but not the adult one", async () => {
    const request = { headers: { cookie: `yt_session=${teenPendingUserId}` } } as FastifyRequest;
    const { campaigns } = await new CampaignController(campaignRepository, principals).list(
      "200",
      request,
    );
    const ids = campaigns.map((campaign) => campaign.id);
    expect(ids).toContain(teenCampaignId);
    expect(ids).not.toContain(adultCampaignId);
  });

  it("an adult's list contains the adult campaign but not the teen one", async () => {
    const request = { headers: { cookie: `yt_session=${adultUserId}` } } as FastifyRequest;
    const { campaigns } = await new CampaignController(campaignRepository, principals).list(
      "200",
      request,
    );
    const ids = campaigns.map((campaign) => campaign.id);
    expect(ids).toContain(adultCampaignId);
    expect(ids).not.toContain(teenCampaignId);
  });
});

describe("GET /api/channels/:handle -- the channel page's campaign grid agrees with the wall too", () => {
  it("a teen sees the channel's teen campaign but not its adult one", async () => {
    const request = { headers: { cookie: `yt_session=${teenPendingUserId}` } } as FastifyRequest;
    const result = await channelController.byHandle(channelHandle, request);
    const ids = result.campaigns.map((campaign) => campaign.id);
    expect(ids).toContain(channelTeenCampaignId);
    expect(ids).not.toContain(channelAdultCampaignId);
  });

  it("an anonymous visitor sees neither -- an anonymous ageBand reaches only all_ages", async () => {
    const request = { headers: {} } as FastifyRequest;
    const result = await channelController.byHandle(channelHandle, request);
    const ids = result.campaigns.map((campaign) => campaign.id);
    expect(ids).not.toContain(channelTeenCampaignId);
    expect(ids).not.toContain(channelAdultCampaignId);
  });

  it("an adult sees the channel's adult campaign but not its teen one", async () => {
    const request = { headers: { cookie: `yt_session=${adultUserId}` } } as FastifyRequest;
    const result = await channelController.byHandle(channelHandle, request);
    const ids = result.campaigns.map((campaign) => campaign.id);
    expect(ids).toContain(channelAdultCampaignId);
    expect(ids).not.toContain(channelTeenCampaignId);
  });
});
