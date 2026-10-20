import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { seedBusinessMembership } from "../../shared/testing/seed-business-membership";

/**
 * 14.2.a's Check over HTTP: the campaign API takes a total budget, a daily
 * cap and target districts, stores them, and returns them when the campaign
 * is read again; a budget that could never pay out is refused, not clamped.
 */
let app: NestFastifyApplication;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  // main.ts's own pipe: the DTOs' normalising and limits are under test here.
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

interface SavedDraft {
  id: string;
  targetDistricts: string[];
  rewardConfig: {
    allocationId: string;
    rewardPointsPerCompletion: number;
    accuracyBonusPoints: number;
    maxPointsForCampaign: number;
    dailyCapPoints: number | null;
  } | null;
}

async function draftWithAllocation() {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  const businessId = await seedBusinessMembership(db, { userId: session.userId, role: "owner" });
  const cookie = session.cookie;
  const purchase = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/billing/purchases`,
    headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
    payload: { points: 10_000, currency: "AUD" },
  });
  expect(purchase.statusCode).toBe(201);
  const allocationId = purchase.json<{ allocation: { allocationId: string } }>().allocation
    .allocationId;
  const now = Date.now();
  const created = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/campaigns`,
    headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
    payload: {
      kind: "long_form",
      title: "14.2 budget campaign",
      synopsis: "A campaign with a budget, a daily cap and districts.",
      durationSeconds: 20 * 60,
      contentCategory: "food-and-drink",
      audience: "all_ages",
      startsAt: new Date(now).toISOString(),
      endsAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  expect(created.statusCode).toBe(201);
  const draft = created.json<SavedDraft>();
  expect(draft.targetDistricts).toEqual([]);
  expect(draft.rewardConfig).toBeNull();
  return { cookie, businessId, allocationId, campaignId: draft.id };
}

function putReward(
  ctx: { cookie: string; businessId: string; campaignId: string; allocationId: string },
  budget: { maxPointsForCampaign: number; dailyCapPoints?: number | null },
) {
  return app.inject({
    method: "PUT",
    url: `/api/${ctx.businessId}/studio/campaigns/${ctx.campaignId}/reward`,
    headers: { cookie: ctx.cookie },
    payload: {
      allocationId: ctx.allocationId,
      rewardPointsPerCompletion: 100,
      accuracyBonusPoints: 20,
      ...budget,
    },
  });
}

describe("14.2.a: budget, daily cap and districts are saved", () => {
  it("stores all three and returns them when the campaign is reopened", async () => {
    const ctx = await draftWithAllocation();
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/${ctx.businessId}/studio/campaigns/${ctx.campaignId}`,
      headers: { cookie: ctx.cookie },
      payload: { targetDistricts: ["  Bondi ", "bondi", "Surry   Hills"] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<SavedDraft>().targetDistricts).toEqual(["Bondi", "Surry Hills"]);

    const saved = await putReward(ctx, { maxPointsForCampaign: 5_000, dailyCapPoints: 600 });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<SavedDraft>().rewardConfig).toEqual({
      allocationId: ctx.allocationId,
      rewardPointsPerCompletion: 100,
      accuracyBonusPoints: 20,
      maxPointsForCampaign: 5_000,
      dailyCapPoints: 600,
    });

    const reopened = await app.inject({
      method: "GET",
      url: `/api/${ctx.businessId}/studio/campaigns/${ctx.campaignId}`,
      headers: { cookie: ctx.cookie },
    });
    expect(reopened.statusCode).toBe(200);
    const body = reopened.json<SavedDraft>();
    expect(body.targetDistricts).toEqual(["Bondi", "Surry Hills"]);
    expect(body.rewardConfig).toMatchObject({ maxPointsForCampaign: 5_000, dailyCapPoints: 600 });

    const rows = await db.execute<{ daily_cap_points: string; target_districts: string[] }>(sql`
      SELECT r.daily_cap_points, c.target_districts
        FROM campaign.reward_config r JOIN campaign.campaigns c ON c.id = r.campaign_id
       WHERE r.campaign_id = ${ctx.campaignId}
    `);
    expect(Number(rows.rows[0]?.daily_cap_points)).toBe(600);
    expect(rows.rows[0]?.target_districts).toEqual(["Bondi", "Surry Hills"]);
  });

  it("clears the daily cap when it is sent as null or left out", async () => {
    const ctx = await draftWithAllocation();
    expect(
      (await putReward(ctx, { maxPointsForCampaign: 5_000, dailyCapPoints: 600 })).statusCode,
    ).toBe(200);
    const cleared = await putReward(ctx, { maxPointsForCampaign: 5_000 });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json<SavedDraft>().rewardConfig?.dailyCapPoints).toBeNull();
  });

  it.each([
    [{ maxPointsForCampaign: 119 }, "budget_below_one_completion"],
    [{ maxPointsForCampaign: 5_000, dailyCapPoints: 119 }, "daily_cap_below_one_completion"],
    [{ maxPointsForCampaign: 5_000, dailyCapPoints: 5_001 }, "daily_cap_above_budget"],
  ])("refuses %o with %s and saves nothing", async (budget, code) => {
    const ctx = await draftWithAllocation();
    const refused = await putReward(ctx, budget);
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ code: string }>().code).toBe(code);
    const rows = await db.execute(
      sql`SELECT 1 FROM campaign.reward_config WHERE campaign_id = ${ctx.campaignId}`,
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("refuses more than 20 districts, or one longer than 60 characters", async () => {
    const ctx = await draftWithAllocation();
    for (const targetDistricts of [
      Array.from({ length: 21 }, (_, index) => `District ${String(index)}`),
      ["x".repeat(61)],
    ]) {
      const refused = await app.inject({
        method: "PATCH",
        url: `/api/${ctx.businessId}/studio/campaigns/${ctx.campaignId}`,
        headers: { cookie: ctx.cookie },
        payload: { targetDistricts },
      });
      expect(refused.statusCode).toBe(400);
    }
  });
});
