import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { seedBusinessMembership } from "../../shared/testing/seed-business-membership";
import { grantStaffRole, ownerPool } from "../staff/staff.test-helper";
import { businessAccounts } from "../business/persistence/schema/business-account.table";
import { campaigns } from "../campaign/persistence/schema/campaign.table";

/**
 * TASKS.md 9.2.a/9.2.b: the campaign-creative half of the staff moderation
 * queue, over the real HTTP stack -- funds a real allocation, authors a
 * question bank, submits to `in_review` (7.3's own real path), then a
 * moderator approves (live, appears in `GET /api/feed`) or rejects (Studio
 * shows the reason).
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

async function ownerAt() {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  const businessId = await seedBusinessMembership(db, { userId: session.userId, role: "owner" });
  return { cookie: session.cookie, businessId };
}

async function markKybVerified(businessId: string) {
  await db
    .update(businessAccounts)
    .set({ isVerified: true })
    .where(eq(businessAccounts.id, businessId));
}

async function fillMedia(campaignId: string) {
  await db
    .update(campaigns)
    .set({
      posterUrl: "https://media.example/poster.jpg",
      teaserUrl: "https://media.example/teaser.mp4",
      hlsUrl: "https://media.example/stream.m3u8",
      aspect: "9:16",
      estimatedBytes: 50_000_000,
      estimatedDataMb: "50",
    })
    .where(eq(campaigns.id, campaignId));
  // The viewer-facing repository's own `campaignSchema` requires a
  // `videoSource` row (packages/contracts/src/campaign/campaign.ts) --
  // 7.2's real media pipeline writes this; this test stands in the same
  // way `fillMedia` above stands in for the rest of that pipeline.
  await db.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${campaignId}, 'hls', 'https://media.example/stream.m3u8')
    ON CONFLICT DO NOTHING
  `);
}

async function fundedAllocationId(cookie: string, businessId: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/billing/purchases`,
    headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
    payload: { points: 10_000, currency: "AUD" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ allocation: { allocationId: string } }>().allocation.allocationId;
}

async function createSubmittedCampaign(
  cookie: string,
  businessId: string,
  overrides?: { contentCategory?: string; audience?: string },
): Promise<string> {
  const now = Date.now();
  const created = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/campaigns`,
    headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
    payload: {
      kind: "long_form",
      title: "9.2.a Check campaign",
      synopsis: "Exercises the staff campaign moderation queue end to end.",
      durationSeconds: 20 * 60,
      contentCategory: overrides?.contentCategory ?? "food-and-drink",
      audience: overrides?.audience ?? "all_ages",
      startsAt: new Date(now).toISOString(),
      endsAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
      openViewing: false,
      teaserStartSeconds: 0,
      declaredInterests: [],
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const campaignId = created.json<{ id: string }>().id;

  // `long_form` requires at least one chapter (campaign.ts's own refine).
  const chapters = await app.inject({
    method: "PATCH",
    url: `/api/${businessId}/studio/campaigns/${campaignId}`,
    headers: { cookie },
    payload: { chapters: [{ title: "Intro", startSeconds: 0, rewardWeight: 1 }] },
  });
  expect(chapters.statusCode, chapters.body).toBe(200);

  const correctOptionId = randomUUID();
  const question = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/campaigns/${campaignId}/questions`,
    headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
    payload: {
      id: randomUUID(),
      campaignId,
      type: "multiple_choice",
      prompt: "Which discount did the video mention?",
      options: [
        { id: correctOptionId, label: "10% off" },
        { id: randomUUID(), label: "20% off" },
      ],
      correctOptionId,
      answerableAfterSeconds: 10,
      timerSeconds: 15,
    },
  });
  expect(question.statusCode, question.body).toBe(201);

  const allocationId = await fundedAllocationId(cookie, businessId);
  const reward = await app.inject({
    method: "PUT",
    url: `/api/${businessId}/studio/campaigns/${campaignId}/reward`,
    headers: { cookie },
    payload: {
      allocationId,
      rewardPointsPerCompletion: 50,
      accuracyBonusPoints: 10,
      maxPointsForCampaign: 60,
    },
  });
  expect(reward.statusCode, reward.body).toBe(200);

  await fillMedia(campaignId);

  const submit = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/campaigns/${campaignId}/submit`,
    headers: { cookie },
  });
  expect(submit.statusCode, submit.body).toBe(201);
  expect(submit.json<{ lifecycleState: string }>().lifecycleState).toBe("in_review");
  return campaignId;
}

async function moderatorStaff() {
  const staff = await sessionFor(app, { jurisdiction: "AU" });
  await grantStaffRole(ownerPool(), staff.userId, "moderator");
  return staff;
}

describe("9.2.a/9.2.b: staff campaign moderation", () => {
  it("a moderator approves an in-review campaign: it goes live and appears in GET /api/feed", async () => {
    const { cookie, businessId } = await ownerAt();
    await markKybVerified(businessId);
    const campaignId = await createSubmittedCampaign(cookie, businessId);
    const staff = await moderatorStaff();

    const listBefore = await app.inject({
      method: "GET",
      url: "/api/staff/moderation/campaigns",
      headers: { cookie: staff.cookie },
    });
    expect(listBefore.statusCode, listBefore.body).toBe(200);
    const before = listBefore.json<{ items: Array<{ campaign: { id: string } }> }>().items;
    expect(before.map((item) => item.campaign.id)).toContain(campaignId);

    const approved = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/campaigns/${campaignId}/approve`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "creative and question bank both look clean" },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    expect(approved.json<{ lifecycleState: string }>().lifecycleState).toBe("live");

    const viewer = await sessionFor(app, { jurisdiction: "AU" });
    const feed = await app.inject({
      method: "GET",
      url: "/api/feed",
      headers: { cookie: viewer.cookie },
    });
    expect(feed.statusCode, feed.body).toBe(200);
    const feedIds = feed
      .json<{ items: Array<{ campaignId: string }> }>()
      .items.map((item) => item.campaignId);
    expect(feedIds).toContain(campaignId);

    const audit = await ownerPool().query(
      `SELECT outcome, reason FROM staff.audit_event WHERE action = $1 AND target_id = $2`,
      ["campaign_moderation.approve", campaignId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      outcome: "succeeded",
      reason: "creative and question bank both look clean",
    });
  });

  it("a moderator rejects an in-review campaign: Studio shows the reason", async () => {
    const { cookie, businessId } = await ownerAt();
    await markKybVerified(businessId);
    const campaignId = await createSubmittedCampaign(cookie, businessId);
    const staff = await moderatorStaff();

    const rejected = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/campaigns/${campaignId}/reject`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "the teaser does not match the platform's disclosure requirements" },
    });
    expect(rejected.statusCode, rejected.body).toBe(201);
    expect(
      rejected.json<{ lifecycleState: string; rejectionReason: string | null }>(),
    ).toMatchObject({
      lifecycleState: "rejected",
      rejectionReason: "the teaser does not match the platform's disclosure requirements",
    });

    // The business's OWN draft read (Studio) shows the exact reason.
    const draft = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/campaigns/${campaignId}`,
      headers: { cookie },
    });
    expect(draft.statusCode, draft.body).toBe(200);
    expect(draft.json<{ rejectionReason: string | null }>().rejectionReason).toBe(
      "the teaser does not match the platform's disclosure requirements",
    );
  });

  it("a moderator confirms or changes the declared audience/category before approving", async () => {
    const { cookie, businessId } = await ownerAt();
    await markKybVerified(businessId);
    const campaignId = await createSubmittedCampaign(cookie, businessId, {
      contentCategory: "alcohol",
      audience: "adult",
    });
    const staff = await moderatorStaff();

    const approved = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/campaigns/${campaignId}/approve`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: {
        reason: "confirmed: alcohol, adult-only, correctly declared",
        contentCategory: "alcohol",
      },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    expect(approved.json<{ audience: string; contentCategory: string }>()).toMatchObject({
      audience: "adult",
      contentCategory: "alcohol",
    });
  });

  it("a moderator's override refuses an adult_only category without audience=adult", async () => {
    const { cookie, businessId } = await ownerAt();
    await markKybVerified(businessId);
    const campaignId = await createSubmittedCampaign(cookie, businessId);
    const staff = await moderatorStaff();

    const approved = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/campaigns/${campaignId}/approve`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "trying an inconsistent override", contentCategory: "alcohol" },
    });
    expect(approved.statusCode, approved.body).toBe(400);
    expect(approved.json<{ code: string }>().code).toBe("audience_must_be_adult");
  });

  it("a business (not staff) cannot reach the moderation queue", async () => {
    const { cookie, businessId } = await ownerAt();
    await markKybVerified(businessId);
    const campaignId = await createSubmittedCampaign(cookie, businessId);

    const approved = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/campaigns/${campaignId}/approve`,
      headers: { cookie, "idempotency-key": randomUUID() },
      payload: { reason: "trying anyway" },
    });
    expect(approved.statusCode).toBe(403);
  });

  it("an already-decided campaign cannot be approved again", async () => {
    const { cookie, businessId } = await ownerAt();
    await markKybVerified(businessId);
    const campaignId = await createSubmittedCampaign(cookie, businessId);
    const staff = await moderatorStaff();

    const first = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/campaigns/${campaignId}/approve`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "looks fine" },
    });
    expect(first.statusCode, first.body).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/api/staff/moderation/campaigns/${campaignId}/approve`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "looks fine" },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json<{ code: string }>().code).toBe("campaign_not_pending_review");
  });
});
