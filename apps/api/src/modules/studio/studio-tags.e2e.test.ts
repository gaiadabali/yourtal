import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { seedBusinessMembership } from "../../shared/testing/seed-business-membership";
import { businessAccounts } from "../business/persistence/schema/business-account.table";
import { campaigns } from "../campaign/persistence/schema/campaign.table";
import { listings, merchantLocations } from "../store/persistence/schema/listing.table";

/**
 * 13.11.d Check: a Studio-made campaign and listing, each saved with tags
 * over HTTP, carry those tags in their rows; a viewer whose declared
 * interests match the tags sees the campaign ranked higher.
 */
let app: NestFastifyApplication;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
const owner = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  // main.ts's own global pipe, so the DTOs' tag rules run here as in production.
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

async function verifiedOwner() {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  const businessId = await seedBusinessMembership(db, { userId: session.userId, role: "owner" });
  await db
    .update(businessAccounts)
    .set({ isVerified: true })
    .where(eq(businessAccounts.id, businessId));
  return { cookie: session.cookie, businessId };
}

const key = () => ({ "idempotency-key": `test-${randomUUID()}` });

async function createTaggedCampaign(cookie: string, businessId: string, tags: string[]) {
  const now = Date.now();
  return app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/campaigns`,
    headers: { cookie, ...key() },
    payload: {
      kind: "long_form",
      title: `13.11.d ${randomUUID()}`,
      synopsis: "A tagged campaign.",
      durationSeconds: 20 * 60,
      contentCategory: "travel",
      audience: "all_ages",
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
      openViewing: false,
      teaserStartSeconds: 0,
      declaredInterests: tags,
    },
  });
}

/** Funds, questions, media and submit over HTTP; the moderator's approval is the one SQL stand-in. */
async function takeLive(cookie: string, businessId: string, campaignId: string) {
  const purchase = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/billing/purchases`,
    headers: { cookie, ...key() },
    payload: { points: 10_000, currency: "AUD" },
  });
  expect(purchase.statusCode).toBe(201);
  const { allocationId } = purchase.json<{ allocation: { allocationId: string } }>().allocation;
  const chapters = await app.inject({
    method: "PATCH",
    url: `/api/${businessId}/studio/campaigns/${campaignId}`,
    headers: { cookie },
    payload: { chapters: [{ title: "Intro", startSeconds: 0, rewardWeight: 1 }] },
  });
  expect(chapters.statusCode).toBe(200);
  const correct = randomUUID();
  const question = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/campaigns/${campaignId}/questions`,
    headers: { cookie, ...key() },
    payload: {
      id: randomUUID(),
      campaignId,
      type: "multiple_choice",
      prompt: "Which city did the video start in?",
      options: [
        { id: correct, label: "Hobart" },
        { id: randomUUID(), label: "Darwin" },
      ],
      correctOptionId: correct,
      answerableAfterSeconds: 10,
      timerSeconds: 15,
    },
  });
  expect(question.statusCode).toBe(201);
  const reward = await app.inject({
    method: "PUT",
    url: `/api/${businessId}/studio/campaigns/${campaignId}/reward`,
    headers: { cookie },
    payload: {
      allocationId,
      rewardPointsPerCompletion: 100,
      accuracyBonusPoints: 0,
      maxPointsForCampaign: 5_000,
    },
  });
  expect(reward.statusCode).toBe(200);
  await db
    .update(campaigns)
    .set({
      posterUrl: "https://media.example/poster.jpg",
      teaserUrl: "https://media.example/teaser.mp4",
      hlsUrl: "https://media.example/stream.m3u8",
      aspect: "16:9",
      estimatedBytes: 50_000_000,
      estimatedDataMb: "50",
    })
    .where(eq(campaigns.id, campaignId));
  // The media pipeline writes this row too; SQL stands in for it, as in studio-campaign-authoring.
  await db.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${campaignId}, 'hls', 'https://media.example/stream.m3u8')
  `);
  const submit = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/campaigns/${campaignId}/submit`,
    headers: { cookie },
  });
  expect(submit.statusCode).toBe(201);
  await owner.execute(
    sql`UPDATE campaign.campaigns SET lifecycle_state = 'live' WHERE id = ${campaignId}`,
  );
}

describe("13.11.d: tags on Studio-made campaigns and listings", () => {
  it("saves a campaign's tags over HTTP into declared_interests, and refuses free text or too many", async () => {
    const { cookie, businessId } = await verifiedOwner();
    const created = await createTaggedCampaign(cookie, businessId, ["books", "cinema"]);
    expect(created.statusCode).toBe(201);
    const campaignId = created.json<{ id: string }>().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/${businessId}/studio/campaigns/${campaignId}`,
      headers: { cookie },
      payload: { declaredInterests: ["books", "coffee-specialty"] },
    });
    expect(patched.statusCode).toBe(200);
    const [row] = await db
      .select({ tags: campaigns.declaredInterests })
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    expect(row?.tags).toEqual(["books", "coffee-specialty"]);

    const freeText = await createTaggedCampaign(cookie, businessId, ["my own words"]);
    expect(freeText.statusCode).toBe(400);
    const nine = ["books", "games", "cinema", "streaming", "toys", "pets", "gym", "fuel", "audio"];
    expect((await createTaggedCampaign(cookie, businessId, nine)).statusCode).toBe(400);
  });

  it("saves a listing's tags over HTTP, and the public store filters on them", async () => {
    const { cookie, businessId } = await verifiedOwner();
    const [location] = await db
      .insert(merchantLocations)
      .values({
        id: randomUUID(),
        merchantId: businessId,
        name: "Tags Outlet",
        address: "1 Tag St",
        district: "Sydney",
      })
      .returning();
    const created = await app.inject({
      method: "POST",
      url: `/api/${businessId}/store/listings`,
      headers: { cookie, ...key() },
      payload: {
        merchantName: "Tags Test Cafe",
        title: `13.11.d listing ${randomUUID()}`,
        description: "A tagged voucher.",
        category: "food_beverage",
        locationIds: [location?.id],
        faceValueMinor: 1_000,
        settlementValueMinor: 600,
        stockTotal: 5,
        transferable: false,
        partialRedemptionPolicy: "single_use_forfeit",
        expiresAt: "2027-06-01T00:00:00.000Z",
        status: "available",
        audience: "all_ages",
        contentCategory: "food-and-drink",
        tags: ["coffee"],
        imageUrl: "https://cdn.example.com/listing.jpg",
        channel: "in_store",
        partialRedemption: "single_use",
      },
    });
    expect(created.statusCode).toBe(201);
    const listingId = created.json<{ id: string; tags: string[] }>().id;
    expect(created.json<{ tags: string[] }>().tags).toEqual(["coffee"]);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/${businessId}/store/listings/${listingId}`,
      headers: { cookie },
      payload: { tags: ["coffee", "bakery"] },
    });
    expect(patched.statusCode).toBe(200);
    const [row] = await db
      .select({ tags: listings.tags })
      .from(listings)
      .where(eq(listings.id, listingId));
    expect(row?.tags).toEqual(["coffee", "bakery"]);

    const browse = async (query: string) =>
      (await app.inject({ method: "GET", url: `/api/store/listings?region=AU&limit=100&${query}` }))
        .json<{ data: { id: string }[] }>()
        .data.map((listing) => listing.id);
    expect(await browse(`tags=bakery&brand=${businessId}`)).toEqual([listingId]);
    expect(await browse(`tags=games&brand=${businessId}`)).toEqual([]);
  });

  it("ranks a tagged campaign higher for a consenting viewer who declared a matching interest", async () => {
    const { cookie, businessId } = await verifiedOwner();
    const created = await createTaggedCampaign(cookie, businessId, ["coffee-specialty"]);
    const taggedId = created.json<{ id: string }>().id;
    await takeLive(cookie, businessId, taggedId);

    const other = await verifiedOwner();
    const control = await createTaggedCampaign(other.cookie, other.businessId, []);
    const controlId = control.json<{ id: string }>().id;
    await takeLive(other.cookie, other.businessId, controlId);

    const viewer = await sessionFor(app, { jurisdiction: "AU" });
    // A parent node: the viewer declared "coffee", the campaign is tagged with its child.
    await db.execute(sql`
      INSERT INTO me.interest (user_id, node_id)
      SELECT 'tags-e2e-segment-' || gs, 'coffee' FROM generate_series(1, 1000) AS gs
      ON CONFLICT DO NOTHING
    `);
    await db.execute(
      sql`INSERT INTO me.interest (user_id, node_id) VALUES (${viewer.userId}, 'coffee')`,
    );
    await db.execute(sql`
      INSERT INTO identity.consent_record
        (user_id, purpose, jurisdiction, policy_version_id, state, source)
      VALUES (${viewer.userId}, 'declared_interest_targeting', 'AU', 'au-2026-09-01', 'granted', 'settings_toggle')
    `);

    const feed = await app.inject({
      method: "GET",
      url: "/api/feed?kind=long_form",
      headers: { cookie: viewer.cookie },
    });
    expect(feed.statusCode).toBe(200);
    const items = feed.json<{
      items: { campaignId: string; whyReason: string; tags: string[] }[];
    }>().items;
    const ids = items.map((item) => item.campaignId);
    expect(ids).toContain(taggedId);
    expect(ids).toContain(controlId);
    expect(ids.indexOf(taggedId)).toBeLessThan(ids.indexOf(controlId));
    const tagged = items.find((item) => item.campaignId === taggedId);
    expect(tagged?.whyReason).toBe("interest");
    expect(tagged?.tags).toEqual(["coffee-specialty"]);
  });
});
