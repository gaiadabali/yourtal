import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { seedBusinessMembership } from "../../shared/testing/seed-business-membership";

/**
 * 7.6.b's Check, over the real HTTP stack: the numbers match the database
 * for one seeded campaign, and a group below the floor shows as suppressed.
 * Real Cerbos (the pre-existing `report` policy), real Postgres, real
 * session. 7.3 (campaign authoring) is a separate, concurrently-built
 * stream and this suite does not need it: it writes a campaign row
 * directly, the same way `drizzle-campaign-report.repository.test.ts` does,
 * because Reports only ever READS this table.
 */
let app: NestFastifyApplication;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
const TERMS_VERSION = 1;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

async function seedCampaign(businessId: string): Promise<string> {
  const campaignId = randomUUID();
  await db.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule, lifecycle_state,
       published_at, business_id, region, audience, content_category, poster_url,
       teaser_url, hls_url, aspect, estimated_bytes, starts_at, ends_at, open_viewing,
       teaser_start_seconds)
    VALUES
      (${campaignId}, 'long_form', 'Reports e2e Campaign', ${businessId}, 'Reports e2e Merchant',
       'Exercises 7.6.b end to end.', 30, 10, 100, 1, 'base_only', 'active',
       now(), ${businessId}, 'AU', 'all_ages', 'food-and-drink',
       'https://cdn.example.com/poster.jpg', 'https://cdn.example.com/teaser.mp4',
       'https://cdn.example.com/manifest.m3u8', '9:16', 1000000, now(), now() + interval '30 days',
       false, 0)
  `);
  await db.execute(sql`
    INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds,
       accuracy_bonus_points, effective_from)
    VALUES (${campaignId}, ${TERMS_VERSION}, 100, 1, 'base_only', 30, 0, now())
  `);
  return campaignId;
}

async function insertSessions(
  campaignId: string,
  count: number,
  completedCount: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const completed = index < completedCount;
    await db.execute(sql`
      INSERT INTO watch.session
        (id, user_id, campaign_id, terms_version, state, started_at, last_progress_at,
         completed_at, non_earning, non_earning_reason, hold_id, questions_asked,
         questions_correct, granted)
      VALUES
        (${randomUUID()}, ${randomUUID()}, ${campaignId}, ${TERMS_VERSION},
         ${completed ? "completed" : "active"}, now() - interval '30 seconds', now(),
         ${completed ? sql`now()` : null}, false, null, null, 1, 1, ${completed})
    `);
  }
}

describe("GET /api/:tenantId/studio/reports/campaigns/:campaignId", () => {
  it("matches the database for a seeded campaign with enough views", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await seedBusinessMembership(db, { userId: session.userId, role: "owner" });
    const campaignId = await seedCampaign(businessId);
    await insertSessions(campaignId, 12, 8);

    const response = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/reports/campaigns/${campaignId}`,
      headers: { cookie: session.cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      suppressed: boolean;
      rewardedViews: number;
      completions: number;
      completionRate: number;
    }>();
    expect(body.suppressed).toBe(false);
    expect(body.rewardedViews).toBe(12);
    expect(body.completions).toBe(8);
    expect(body.completionRate).toBeCloseTo(8 / 12);
  });

  it("shows a group below the F12 cohort floor as suppressed", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await seedBusinessMembership(db, { userId: session.userId, role: "owner" });
    const campaignId = await seedCampaign(businessId);
    await insertSessions(campaignId, 3, 1);

    const response = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/reports/campaigns/${campaignId}`,
      headers: { cookie: session.cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ suppressed: boolean; floor?: number }>();
    expect(body.suppressed).toBe(true);
    expect(body.floor).toBe(10);
  });

  it("404s for a campaign belonging to another business", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const ownerBusinessId = await seedBusinessMembership(db, {
      userId: owner.userId,
      role: "owner",
    });
    const otherCampaignId = await seedCampaign(randomUUID());

    const response = await app.inject({
      method: "GET",
      url: `/api/${ownerBusinessId}/studio/reports/campaigns/${otherCampaignId}`,
      headers: { cookie: owner.cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});
