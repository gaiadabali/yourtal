import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";

/**
 * 7.7.d's Check, over the real HTTP stack: real sessions (`session-for.ts`),
 * real Postgres, real Cerbos (untouched -- these routes are `@PublicRoute`).
 * Writes directly to `campaign.campaigns`/`campaign.video_source`/
 * `campaign.reward_config` and `platform.ledger_fake_allocation` rather than
 * going through an authoring endpoint or the wallet's funding endpoint --
 * the same "Reports only ever READS this table" reasoning
 * `reports.controller.e2e.test.ts` already used, extended to the ledger's
 * OWN fake tables since this suite needs exact control over
 * `remaining_points` (zero, for the "no funding" case) that funding through
 * HTTP would not let it assert as directly.
 */
let app: NestFastifyApplication;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

interface SeedCampaignOptions {
  readonly region: "AU" | "ID";
  readonly audience?: "all_ages" | "teen" | "adult" | "parents";
  readonly openViewing?: boolean;
  readonly contentCategory?: string;
  readonly businessId?: string;
}

async function seedCampaign(options: SeedCampaignOptions): Promise<{ campaignId: string; businessId: string }> {
  const campaignId = randomUUID();
  const businessId = options.businessId ?? randomUUID();
  await db.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule, lifecycle_state,
       published_at, business_id, region, audience, content_category, poster_url,
       teaser_url, hls_url, aspect, estimated_bytes, starts_at, ends_at, open_viewing,
       teaser_start_seconds)
    VALUES
      (${campaignId}, 'quick', ${`Feed e2e ${campaignId}`}, ${businessId}, 'Feed e2e Merchant',
       'Exercises 7.7.d end to end.', 30, 10, 100, 0, 'base_only', 'live',
       now(), ${businessId}, ${options.region}, ${options.audience ?? "all_ages"},
       ${options.contentCategory ?? "food-and-drink"},
       'https://cdn.example.com/poster.jpg', 'https://cdn.example.com/teaser.mp4',
       'https://cdn.example.com/manifest.m3u8', '9:16', 1000000, now() - interval '1 day',
       now() + interval '30 days', ${options.openViewing ?? false}, 0)
  `);
  await db.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${campaignId}, 'hls', 'https://cdn.example.com/manifest.m3u8')
  `);
  return { campaignId, businessId };
}

/** Funds a campaign with a real `platform.ledger_fake_allocation` row `getAllocation` can read. */
async function fundCampaign(
  campaignId: string,
  businessId: string,
  region: "AU" | "ID",
  remainingPoints = 10_000,
): Promise<void> {
  const allocationId = randomUUID();
  await db.execute(sql`
    INSERT INTO platform.ledger_fake_allocation
      (id, business_id, region, funder_type, currency, total_points, remaining_points)
    VALUES (${allocationId}, ${businessId}, ${region}, 'marketing', ${region === "AU" ? "AUD" : "IDR"},
            10000, ${remainingPoints})
  `);
  await db.execute(sql`
    INSERT INTO campaign.reward_config
      (campaign_id, allocation_id, funder_type, max_points_for_campaign,
       reward_points_per_completion, accuracy_bonus_points)
    VALUES (${campaignId}, ${allocationId}, 'marketing', 10000, 100, 0)
  `);
}

function itemIds(body: unknown): string[] {
  return (body as { items: { campaignId: string }[] }).items.map((item) => item.campaignId);
}

describe("GET /api/feed", () => {
  it("never shows a campaign with no funded allocation", async () => {
    const user = await sessionFor(app, { jurisdiction: "AU" });
    const { campaignId: fundedId, businessId } = await seedCampaign({ region: "AU" });
    await fundCampaign(fundedId, businessId, "AU");
    const { campaignId: unfundedId } = await seedCampaign({ region: "AU" });
    // No reward_config row at all -- rewardConfigFor returns null, so this
    // one is filtered out before an allocation is ever asked about.

    const response = await app.inject({
      method: "GET",
      url: "/api/feed",
      headers: { cookie: user.cookie },
    });
    expect(response.statusCode).toBe(200);
    const ids = itemIds(response.json());
    expect(ids).toContain(fundedId);
    expect(ids).not.toContain(unfundedId);
  });

  it("never shows a campaign whose allocation is fully spent (remainingPoints = 0)", async () => {
    const user = await sessionFor(app, { jurisdiction: "AU" });
    const { campaignId, businessId } = await seedCampaign({ region: "AU" });
    await fundCampaign(campaignId, businessId, "AU", 0);

    const response = await app.inject({
      method: "GET",
      url: "/api/feed",
      headers: { cookie: user.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(itemIds(response.json())).not.toContain(campaignId);
  });

  it("an ID viewer never sees an AU campaign", async () => {
    const idUser = await sessionFor(app, { jurisdiction: "ID" });
    const { campaignId: auCampaignId, businessId: auBusinessId } = await seedCampaign({ region: "AU" });
    await fundCampaign(auCampaignId, auBusinessId, "AU");
    const { campaignId: idCampaignId, businessId: idBusinessId } = await seedCampaign({ region: "ID" });
    await fundCampaign(idCampaignId, idBusinessId, "ID");

    const response = await app.inject({
      method: "GET",
      url: "/api/feed",
      headers: { cookie: idUser.cookie },
    });
    expect(response.statusCode).toBe(200);
    const ids = itemIds(response.json());
    expect(ids).not.toContain(auCampaignId);
    expect(ids).toContain(idCampaignId);
  });

  it("a signed-in caller's own region wins even if a disagreeing region query param is sent", async () => {
    const auUser = await sessionFor(app, { jurisdiction: "AU" });
    const { campaignId: idCampaignId, businessId } = await seedCampaign({ region: "ID" });
    await fundCampaign(idCampaignId, businessId, "ID");

    const response = await app.inject({
      method: "GET",
      url: "/api/feed?region=ID",
      headers: { cookie: auUser.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(itemIds(response.json())).toEqual([]);
  });

  it("ranks a followed channel's campaign above an equally-funded stranger's", async () => {
    const user = await sessionFor(app, { jurisdiction: "AU" });
    const { campaignId: followedCampaignId, businessId: followedBusinessId } = await seedCampaign({
      region: "AU",
    });
    await fundCampaign(followedCampaignId, followedBusinessId, "AU");
    const { campaignId: strangerCampaignId, businessId: strangerBusinessId } = await seedCampaign({
      region: "AU",
    });
    await fundCampaign(strangerCampaignId, strangerBusinessId, "AU");

    await db.execute(sql`
      INSERT INTO me.follow (user_id, business_id, region) VALUES (${user.userId}, ${followedBusinessId}, 'AU')
    `);

    const response = await app.inject({
      method: "GET",
      url: "/api/feed",
      headers: { cookie: user.cookie },
    });
    expect(response.statusCode).toBe(200);
    const ids = itemIds(response.json());
    expect(ids.indexOf(followedCampaignId)).toBeLessThan(ids.indexOf(strangerCampaignId));
  });

  it("does not let a declared interest change the order without ad-targeting consent", async () => {
    const user = await sessionFor(app, { jurisdiction: "AU" });
    const { campaignId: matchingCampaignId } = await seedCampaign({
      region: "AU",
      contentCategory: "food-and-drink",
    });
    await fundCampaign(matchingCampaignId, randomUUID(), "AU");
    const { campaignId: otherCampaignId } = await seedCampaign({ region: "AU", contentCategory: "travel" });
    await fundCampaign(otherCampaignId, randomUUID(), "AU");

    // Honestly over the F12 segment floor: 1000 distinct declared users,
    // this test's own user among them, not a lowered threshold.
    await db.execute(sql`
      INSERT INTO me.interest (user_id, node_id)
      SELECT 'feed-e2e-segment-user-' || gs, 'food-and-drink' FROM generate_series(1, 1000) AS gs
    `);
    await db.execute(sql`
      INSERT INTO me.interest (user_id, node_id) VALUES (${user.userId}, 'food-and-drink')
    `);

    const withoutConsent = await app.inject({
      method: "GET",
      url: "/api/feed",
      headers: { cookie: user.cookie },
    });
    expect(withoutConsent.statusCode).toBe(200);
    const withoutConsentBody = withoutConsent.json<{ items: { campaignId: string; why: string }[] }>();
    expect(
      withoutConsentBody.items.find((item) => item.campaignId === matchingCampaignId)?.why,
    ).not.toBe("Matches an interest you declared");

    await db.execute(sql`
      INSERT INTO identity.consent_record
        (user_id, purpose, jurisdiction, policy_version_id, state, source)
      VALUES (${user.userId}, 'declared_interest_targeting', 'AU', 'au-2026-09-01', 'granted', 'settings_toggle')
    `);

    const withConsent = await app.inject({
      method: "GET",
      url: "/api/feed",
      headers: { cookie: user.cookie },
    });
    expect(withConsent.statusCode).toBe(200);
    const withConsentIds = itemIds(withConsent.json());
    expect(withConsentIds.indexOf(matchingCampaignId)).toBeLessThan(withConsentIds.indexOf(otherCampaignId));
  });

  it("Open Viewing anonymous: only openViewing + all_ages, in the path region, unpersonalised", async () => {
    const { campaignId: openAllAgesAu, businessId: b1 } = await seedCampaign({
      region: "AU",
      audience: "all_ages",
      openViewing: true,
    });
    await fundCampaign(openAllAgesAu, b1, "AU");

    const { campaignId: closedAllAgesAu, businessId: b2 } = await seedCampaign({
      region: "AU",
      audience: "all_ages",
      openViewing: false,
    });
    await fundCampaign(closedAllAgesAu, b2, "AU");

    const { campaignId: openAdultAu, businessId: b3 } = await seedCampaign({
      region: "AU",
      audience: "adult",
      openViewing: true,
    });
    await fundCampaign(openAdultAu, b3, "AU");

    const { campaignId: openAllAgesId, businessId: b4 } = await seedCampaign({
      region: "ID",
      audience: "all_ages",
      openViewing: true,
    });
    await fundCampaign(openAllAgesId, b4, "ID");

    const response = await app.inject({ method: "GET", url: "/api/feed?region=AU" });
    expect(response.statusCode).toBe(200);
    const ids = itemIds(response.json());
    expect(ids).toContain(openAllAgesAu);
    expect(ids).not.toContain(closedAllAgesAu);
    expect(ids).not.toContain(openAdultAu);
    expect(ids).not.toContain(openAllAgesId);
  });

  it("an anonymous request with no region at all is a 400, not a silent default", async () => {
    const response = await app.inject({ method: "GET", url: "/api/feed" });
    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/search", () => {
  it("finds a funded, in-region, in-audience campaign by title substring", async () => {
    const user = await sessionFor(app, { jurisdiction: "AU" });
    const unique = randomUUID().slice(0, 8);
    const campaignId = randomUUID();
    const businessId = randomUUID();
    await db.execute(sql`
      INSERT INTO campaign.campaigns
        (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
         estimated_data_mb, reward_points, question_count, scoring_rule, lifecycle_state,
         published_at, business_id, region, audience, content_category, poster_url,
         teaser_url, hls_url, aspect, estimated_bytes, starts_at, ends_at, open_viewing,
         teaser_start_seconds)
      VALUES
        (${campaignId}, 'quick', ${`Searchable Widget ${unique}`}, ${businessId}, 'Feed e2e Merchant',
         'Exercises 7.7.c end to end.', 30, 10, 100, 0, 'base_only', 'live',
         now(), ${businessId}, 'AU', 'all_ages', 'food-and-drink',
         'https://cdn.example.com/poster.jpg', 'https://cdn.example.com/teaser.mp4',
         'https://cdn.example.com/manifest.m3u8', '9:16', 1000000, now() - interval '1 day',
         now() + interval '30 days', false, 0)
    `);
    await db.execute(sql`
      INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
      VALUES (${campaignId}, 'hls', 'https://cdn.example.com/manifest.m3u8')
    `);
    await fundCampaign(campaignId, businessId, "AU");

    const response = await app.inject({
      method: "GET",
      url: `/api/search?q=${encodeURIComponent(`Searchable Widget ${unique}`)}`,
      headers: { cookie: user.cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ campaigns: { campaignId: string }[] }>();
    expect(body.campaigns.map((item) => item.campaignId)).toContain(campaignId);
  });
});

describe("POST /api/feed/:campaignId/not-interested", () => {
  it("demotes a campaign for a signed-in caller without removing it from the feed", async () => {
    const user = await sessionFor(app, { jurisdiction: "AU" });
    const { campaignId, businessId } = await seedCampaign({ region: "AU" });
    await fundCampaign(campaignId, businessId, "AU");
    const { campaignId: otherCampaignId, businessId: otherBusinessId } = await seedCampaign({
      region: "AU",
    });
    await fundCampaign(otherCampaignId, otherBusinessId, "AU");

    const demote = await app.inject({
      method: "POST",
      url: `/api/feed/${campaignId}/not-interested`,
      headers: { cookie: user.cookie },
    });
    expect(demote.statusCode).toBe(201);

    const response = await app.inject({
      method: "GET",
      url: "/api/feed",
      headers: { cookie: user.cookie },
    });
    const ids = itemIds(response.json());
    // Still present -- demotion only re-ranks, never removes (ranking.test.ts
    // already covers the pure rule; this just proves the write reaches it).
    expect(ids).toContain(campaignId);
    expect(ids.indexOf(campaignId)).toBeGreaterThan(ids.indexOf(otherCampaignId));
  });

  it("is a no-op, not an error, for an anonymous caller", async () => {
    const { campaignId } = await seedCampaign({ region: "AU", openViewing: true });
    const response = await app.inject({
      method: "POST",
      url: `/api/feed/${campaignId}/not-interested`,
    });
    expect(response.statusCode).toBe(201);
  });
});
