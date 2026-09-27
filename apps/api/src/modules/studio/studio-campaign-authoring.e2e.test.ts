import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { seedBusinessMembership } from "../../shared/testing/seed-business-membership";
import { businessAccounts } from "../business/persistence/schema/business-account.table";
import { campaigns } from "../campaign/persistence/schema/campaign.table";

/**
 * TASKS.md 7.3.e Check: an HTTP round trip creates a funded campaign at the
 * F12 ceiling, with a question bank, and submits it to `in_review` for a
 * business verified by the test fixture, while an unverified one is
 * refused; one point per minute above the ceiling is refused.
 *
 * `poster_url`/`teaser_url`/`hls_url`/`aspect`/`estimated_bytes`/
 * `estimated_data_mb` are 7.2's media pipeline's to fill (not this phase
 * session's own scope, and not yet merged) -- this test fills them
 * directly by SQL, the same way `campaign.controller.test.ts` (B's fixture)
 * seeds rows straight against the table rather than through a route that
 * does not exist yet. `campaigns_media_required_past_draft` is a real CHECK
 * either way; this only stands in for the endpoint that will one day
 * satisfy it.
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

/** Stands in for 7.2's not-yet-built media pipeline -- see file header. */
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
}

async function fundedAllocationId(cookie: string, businessId: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/billing/purchases`,
    headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
    payload: { points: 10_000, currency: "AUD" },
  });
  expect(response.statusCode).toBe(201);
  // purchase-points.use-case.ts's PurchaseResult carries `allocation`, whose
  // `allocationId` is the ledger-assigned id set-reward-config.use-case.ts
  // validates ownership of via listAllocations.
  return response.json<{ allocation: { allocationId: string } }>().allocation.allocationId;
}

async function createDraftCampaign(cookie: string, businessId: string): Promise<string> {
  const now = Date.now();
  const response = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/campaigns`,
    headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
    payload: {
      // "quick" is capped at 60s by campaigns_quick_is_short -- this test
      // needs a 20-minute campaign to exercise F14's per-minute ceiling
      // realistically, so "long_form" it is (no chapters required at the
      // database level; the reward/media CHECKs are the only gate here).
      kind: "long_form",
      title: "7.3.e Check campaign",
      synopsis: "A funded campaign at the F12 ceiling, with a question bank.",
      durationSeconds: 20 * 60,
      contentCategory: "food-and-drink",
      audience: "all_ages",
      startsAt: new Date(now).toISOString(),
      endsAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
      openViewing: false,
      teaserStartSeconds: 0,
      declaredInterests: [],
    },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{ id: string; lifecycleState: string }>();
  expect(body.lifecycleState).toBe("draft");
  return body.id;
}

describe("7.3.e Check: studio campaign authoring, end to end", () => {
  it("funds a campaign at the F14/AU ceiling (8 pts/min), authors a question, and submits a KYB-verified business to in_review", async () => {
    const { cookie, businessId } = await ownerAt();
    await markKybVerified(businessId);
    const allocationId = await fundedAllocationId(cookie, businessId);
    const campaignId = await createDraftCampaign(cookie, businessId);

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
    expect(question.statusCode).toBe(201);

    const questionsList = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/campaigns/${campaignId}/questions`,
      headers: { cookie },
    });
    expect(questionsList.statusCode).toBe(200);
    expect(questionsList.json<unknown[]>()).toHaveLength(1);

    // 20 minutes at AU's 8 pts/min ceiling (platform_region_setting.sql) = 160
    // points. Base 115 + a 45-point bonus (<= 40% of 115 = 46) lands exactly
    // at the ceiling, not above it -- exceedsRewardCeiling refuses only a
    // STRICT excess.
    const atCeiling = await app.inject({
      method: "PUT",
      url: `/api/${businessId}/studio/campaigns/${campaignId}/reward`,
      headers: { cookie },
      payload: {
        allocationId,
        rewardPointsPerCompletion: 115,
        accuracyBonusPoints: 45,
        maxPointsForCampaign: 160,
      },
    });
    expect(atCeiling.statusCode).toBe(200);
    const atCeilingBody = atCeiling.json<{ rewardValueMinor: number; currency: string }>();
    // 7.3.h: the reward's cash value in the business's own currency, priced
    // via quotePurchase (P_issue) -- never the backing rate B.
    expect(atCeilingBody.currency).toBe("AUD");
    expect(atCeilingBody.rewardValueMinor).toBeGreaterThan(0);
    expect(JSON.stringify(atCeilingBody)).not.toMatch(/backingRate/i);

    // One point per minute above the ceiling (136 + 45 = 181 > 160) is refused.
    const aboveCeiling = await app.inject({
      method: "PUT",
      url: `/api/${businessId}/studio/campaigns/${campaignId}/reward`,
      headers: { cookie },
      payload: {
        allocationId,
        rewardPointsPerCompletion: 136,
        accuracyBonusPoints: 45,
        maxPointsForCampaign: 181,
      },
    });
    expect(aboveCeiling.statusCode).toBe(400);
    expect(aboveCeiling.json<{ code: string }>().code).toBe("reward_exceeds_ceiling");

    await fillMedia(campaignId);

    const submit = await app.inject({
      method: "POST",
      url: `/api/${businessId}/studio/campaigns/${campaignId}/submit`,
      headers: { cookie },
    });
    // Nest's default POST status (submit.controller has no @HttpCode override).
    expect(submit.statusCode).toBe(201);
    expect(submit.json<{ lifecycleState: string }>().lifecycleState).toBe("in_review");
  });

  it("refuses submission for a business that is not yet KYB-verified", async () => {
    const { cookie, businessId } = await ownerAt();
    // Deliberately NOT markKybVerified -- seedBusinessMembership's row
    // defaults is_verified to false (business-account.table.ts).
    const campaignId = await createDraftCampaign(cookie, businessId);

    const submit = await app.inject({
      method: "POST",
      url: `/api/${businessId}/studio/campaigns/${campaignId}/submit`,
      headers: { cookie },
    });
    expect(submit.statusCode).toBe(403);
    expect(submit.json<{ code: string }>().code).toBe("not_kyb_verified");
  });
});
