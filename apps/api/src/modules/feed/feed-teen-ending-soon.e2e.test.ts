import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";

/**
 * 12.4.d/#7, over the real HTTP stack: `ranking.test.ts` proves
 * `signalsFor` never flags a teen's item ending soon at the unit level;
 * this is the one end-to-end proof that a REAL teen session sees no
 * ending-soon signal for a campaign a REAL adult session, over the same
 * `GET /api/feed`, sees flagged. `TEEN_ACCOUNTS` forced on for this
 * file's OWN moduleRef only — same isolated-container reasoning
 * `store-catalogue.controller.e2e.test.ts` and `guardian-consent.e2e.test.ts`
 * document, restored in `afterAll`.
 */
let app: NestFastifyApplication;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
const originalTeenAccounts = process.env["TEEN_ACCOUNTS"];
const seededCampaignIds: string[] = [];

beforeAll(async () => {
  process.env["TEEN_ACCOUNTS"] = "true";
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  if (originalTeenAccounts === undefined) {
    delete process.env["TEEN_ACCOUNTS"];
  } else {
    process.env["TEEN_ACCOUNTS"] = originalTeenAccounts;
  }
  if (seededCampaignIds.length > 0) {
    await owner.execute(
      sql`DELETE FROM campaign.reward_config WHERE campaign_id IN ${seededCampaignIds}`,
    );
    await owner.execute(
      sql`DELETE FROM campaign.terms_version WHERE campaign_id IN ${seededCampaignIds}`,
    );
    await owner.execute(
      sql`DELETE FROM campaign.video_source WHERE campaign_id IN ${seededCampaignIds}`,
    );
    await owner.execute(sql`DELETE FROM campaign.campaigns WHERE id IN ${seededCampaignIds}`);
  }
});

/** ISO date for someone who turned 15 within the last year — 1.4.b's teen band (same helper `store-catalogue.controller.e2e.test.ts` uses). */
function fifteenYearsAgo(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 15);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** One all_ages campaign whose allocation is 5% remaining — `isEndingSoon`'s allocation-fraction branch (ranking.ts), visible to both an adult and a teen. */
async function seedEndingSoonCampaign(): Promise<{ campaignId: string }> {
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
      (${campaignId}, 'quick', ${`Feed teen e2e ${campaignId}`}, ${businessId}, 'Feed Teen e2e Merchant',
       'Exercises 12.4.d #7 end to end.', 30, 10, 100, 0, 'base_only', 'live',
       now(), ${businessId}, 'AU', 'all_ages', 'food-and-drink',
       'https://cdn.example.com/poster.jpg', 'https://cdn.example.com/teaser.mp4',
       'https://cdn.example.com/manifest.m3u8', '9:16', 1000000, now() - interval '1 day',
       now() + interval '30 days', false, 0)
  `);
  await db.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${campaignId}, 'hls', 'https://cdn.example.com/manifest.m3u8')
  `);
  await db.execute(sql`
    INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule,
       duration_seconds, accuracy_bonus_points, effective_from)
    VALUES (${campaignId}, 1, 100, 0, 'base_only', 30, 0, now())
  `);
  const allocationId = randomUUID();
  await db.execute(sql`
    INSERT INTO platform.ledger_fake_allocation
      (id, business_id, region, funder_type, currency, total_points, remaining_points)
    VALUES (${allocationId}, ${businessId}, 'AU', 'marketing', 'AUD', 10000, 500)
  `);
  await db.execute(sql`
    INSERT INTO campaign.reward_config
      (campaign_id, allocation_id, funder_type, max_points_for_campaign,
       reward_points_per_completion, accuracy_bonus_points)
    VALUES (${campaignId}, ${allocationId}, 'marketing', 10000, 100, 0)
  `);
  seededCampaignIds.push(campaignId);
  return { campaignId };
}

function itemFor(
  body: unknown,
  campaignId: string,
): { endingSoon: boolean; whyReason: string } | undefined {
  return (
    body as { items: { campaignId: string; endingSoon: boolean; whyReason: string }[] }
  ).items.find((item) => item.campaignId === campaignId);
}

describe("GET /api/feed — 12.4.d/#7 no ending-soon nudge for a teen", () => {
  it("an adult sees the campaign flagged ending soon; a teen sees the same campaign with no ending-soon signal at all", async () => {
    const { campaignId } = await seedEndingSoonCampaign();

    const adult = await sessionFor(app, { jurisdiction: "AU" });
    const teen = await sessionFor(app, {
      jurisdiction: "AU",
      dateOfBirth: fifteenYearsAgo(),
      guardianEmail: `guardian+${randomUUID()}@example.test`,
    });

    const adultResponse = await app.inject({
      method: "GET",
      url: "/api/feed?surface=home",
      headers: { cookie: adult.cookie },
    });
    const teenResponse = await app.inject({
      method: "GET",
      url: "/api/feed?surface=home",
      headers: { cookie: teen.cookie },
    });

    expect(adultResponse.statusCode).toBe(200);
    expect(teenResponse.statusCode).toBe(200);

    const adultItem = itemFor(adultResponse.json(), campaignId);
    const teenItem = itemFor(teenResponse.json(), campaignId);

    expect(adultItem?.endingSoon).toBe(true);
    expect(adultItem?.whyReason).toBe("ending_soon");
    expect(teenItem?.endingSoon).toBe(false);
    expect(teenItem?.whyReason).not.toBe("ending_soon");
  });
});
