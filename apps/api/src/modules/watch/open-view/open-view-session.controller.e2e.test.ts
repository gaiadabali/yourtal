import { randomUUID } from "node:crypto";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../app.module";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import type { AppDb } from "../../../shared/persistence/drizzle-client";

/**
 * TASKS.md 11.2.b, over the real HTTP stack (same shape as
 * `feed.controller.e2e.test.ts`): real Postgres, real Cerbos (`@Authorize`,
 * anonymous role), no session cookie anywhere — every call here IS the
 * anonymous visitor. This suite exercises this session's OWN
 * `campaign_view.yaml` edit (the `audience == "all_ages"` defence-in-depth
 * condition), so — same note as `watch.controller.e2e.test.ts` — point
 * `PDP_BASE_URL` at this worktree's own Cerbos (mounting THIS worktree's
 * `./policies`) and restart it immediately before running this file, or it
 * silently exercises whatever Cerbos `AppModule`'s own default resolves to
 * instead.
 */
let app: NestFastifyApplication;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");

const seededCampaignIds: string[] = [];

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  if (seededCampaignIds.length > 0) {
    await owner.execute(
      sql`DELETE FROM watch.open_view_session WHERE campaign_id IN ${seededCampaignIds}`,
    );
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

/** A distinct address per call — never the same IP twice, or these tests contend on each other's F12 buckets. */
function randomIp(): string {
  return `open-view-e2e-${randomBytes(6).toString("hex")}`;
}

interface SeedOptions {
  readonly openViewing?: boolean;
  readonly audience?: "all_ages" | "teen" | "adult" | "parents";
  readonly status?: "live" | "paused";
}

async function seedCampaign(options: SeedOptions = {}): Promise<string> {
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
      (${campaignId}, 'quick', ${`Open view e2e ${campaignId}`}, ${businessId}, 'Open View e2e Merchant',
       'Exercises 11.2.b end to end.', 30, 10, 100, 0, 'base_only',
       ${options.status ?? "live"}, now(), ${businessId}, 'AU', ${options.audience ?? "all_ages"},
       'entertainment', 'https://cdn.example.com/poster.jpg', 'https://cdn.example.com/teaser.mp4',
       'https://cdn.example.com/hls/manifest.m3u8', '9:16', 1000000, now() - interval '1 day',
       now() + interval '30 days', ${options.openViewing ?? false}, 0)
  `);
  await db.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${campaignId}, 'hls', 'https://cdn.example.com/hls/manifest.m3u8')
  `);
  await db.execute(sql`
    INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule,
       duration_seconds, accuracy_bonus_points, effective_from)
    VALUES (${campaignId}, 1, 100, 0, 'base_only', 30, 0, now())
  `);
  seededCampaignIds.push(campaignId);
  return campaignId;
}

/** Funds a campaign with a real `platform.ledger_fake_allocation` row `getAllocation` can read (same as `feed.controller.e2e.test.ts`). */
async function fundCampaign(campaignId: string, remainingPoints = 10_000): Promise<void> {
  const allocationId = randomUUID();
  await db.execute(sql`
    INSERT INTO platform.ledger_fake_allocation
      (id, business_id, region, funder_type, currency, total_points, remaining_points)
    VALUES (${allocationId}, ${randomUUID()}, 'AU', 'marketing', 'AUD', 10000, ${remainingPoints})
  `);
  await db.execute(sql`
    INSERT INTO campaign.reward_config
      (campaign_id, allocation_id, funder_type, max_points_for_campaign,
       reward_points_per_completion, accuracy_bonus_points)
    VALUES (${campaignId}, ${allocationId}, 'marketing', 10000, 100, 0)
  `);
}

describe("POST /api/watch/open-view-sessions", () => {
  it("mints a signed manifest URL for an eligible campaign, and writes a real DB row — never watch.session", async () => {
    const campaignId = await seedCampaign({ openViewing: true, audience: "all_ages" });
    await fundCampaign(campaignId);

    const response = await app.inject({
      method: "POST",
      url: "/api/watch/open-view-sessions",
      remoteAddress: randomIp(),
      payload: { campaignId },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.durationSeconds).toBe(30);
    // The signed scheme, never a raw /media/hls/ path — hls-token.ts's own shape.
    expect(body.manifestUrl).toMatch(
      /^\/media\/hls\/\d+\/[A-Za-z0-9_-]{43}\/[A-Za-z0-9-]+\/manifest\.m3u8$/,
    );

    const [row] = (
      await db.execute(
        sql`SELECT campaign_id, watched_seconds FROM watch.open_view_session WHERE id = ${body.sessionId}`,
      )
    ).rows;
    expect(row).toMatchObject({ campaign_id: campaignId, watched_seconds: 0 });

    const [inRewardedTable] = (
      await db.execute(sql`SELECT 1 FROM watch.session WHERE id = ${body.sessionId}`)
    ).rows;
    expect(inRewardedTable).toBeUndefined();
  });

  it("refuses a campaign that has not opted into Open Viewing", async () => {
    const campaignId = await seedCampaign({ openViewing: false, audience: "all_ages" });
    await fundCampaign(campaignId);

    const response = await app.inject({
      method: "POST",
      url: "/api/watch/open-view-sessions",
      remoteAddress: randomIp(),
      payload: { campaignId },
    });

    // F30: an anonymous caller Cerbos denies gets 401 ("sign in to
    // continue"), never 403 — pdp.guard.ts's own doc comment. This is a
    // Cerbos-level denial (openViewingEnabled is false), not one of this
    // controller's own domain throws.
    expect(response.statusCode).toBe(401);
  });

  it("refuses an adult-rated campaign even if open_viewing were somehow set (defence in depth)", async () => {
    // Studio's category-policy.ts refuses this combination at authoring
    // time — this row can only exist by a bypass (a bug, a direct SQL
    // edit), which is exactly why the Cerbos rule checks it independently.
    // Denied at the Cerbos layer (F30: 401 for anonymous), same as the
    // other campaign_view.yaml conditions — this never reaches this
    // controller's OWN redundant audience check.
    const campaignId = await seedCampaign({ openViewing: true, audience: "adult" });
    await fundCampaign(campaignId);

    const response = await app.inject({
      method: "POST",
      url: "/api/watch/open-view-sessions",
      remoteAddress: randomIp(),
      payload: { campaignId },
    });

    expect(response.statusCode).toBe(401);
  });

  it("refuses a campaign with no funding (openViewingBudgetRemaining is 0)", async () => {
    const campaignId = await seedCampaign({ openViewing: true, audience: "all_ages" });
    // Deliberately unfunded — no fundCampaign() call.

    const response = await app.inject({
      method: "POST",
      url: "/api/watch/open-view-sessions",
      remoteAddress: randomIp(),
      payload: { campaignId },
    });

    expect(response.statusCode).toBe(401);
  });

  it("404s a campaign that does not exist", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/watch/open-view-sessions",
      remoteAddress: randomIp(),
      payload: { campaignId: randomUUID() },
    });

    expect(response.statusCode).toBe(404);
  });

  it("resumes the SAME session for a repeat call from the same IP + campaign, rather than creating a second row", async () => {
    const campaignId = await seedCampaign({ openViewing: true, audience: "all_ages" });
    await fundCampaign(campaignId);
    const ip = randomIp();

    const first = await app.inject({
      method: "POST",
      url: "/api/watch/open-view-sessions",
      remoteAddress: ip,
      payload: { campaignId },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/watch/open-view-sessions",
      remoteAddress: ip,
      payload: { campaignId },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().sessionId).toBe(first.json().sessionId);
  });

  it("refuses a second campaign from the same IP while one anonymous session is still active (F12: one concurrent session)", async () => {
    const campaignA = await seedCampaign({ openViewing: true, audience: "all_ages" });
    const campaignB = await seedCampaign({ openViewing: true, audience: "all_ages" });
    await fundCampaign(campaignA);
    await fundCampaign(campaignB);
    const ip = randomIp();

    const first = await app.inject({
      method: "POST",
      url: "/api/watch/open-view-sessions",
      remoteAddress: ip,
      payload: { campaignId: campaignA },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/watch/open-view-sessions",
      remoteAddress: ip,
      payload: { campaignId: campaignB },
    });
    expect(second.statusCode).toBe(403);
  });

  it("refuses a new session once this IP has spent today's F12 daily minute cap", async () => {
    const priorCampaignId = await seedCampaign({ openViewing: true, audience: "all_ages" });
    const newCampaignId = await seedCampaign({ openViewing: true, audience: "all_ages" });
    await fundCampaign(priorCampaignId);
    await fundCampaign(newCampaignId);
    const ip = randomIp();

    // A prior, already-idle (outside the concurrency window) session that
    // alone exhausts AU's seeded 60-minute daily cap (platform.region_setting,
    // migration 20260925193000) — real DB row, not a stubbed reader.
    await owner.execute(sql`
      INSERT INTO watch.open_view_session
        (id, campaign_id, region, ip_hash, started_at, last_progress_at, watched_seconds)
      VALUES (
        ${randomUUID()}, ${priorCampaignId}, 'AU',
        encode(sha256(${ip}::bytea), 'hex'),
        now() - interval '2 hours', now() - interval '2 hours', 3600
      )
    `);

    const response = await app.inject({
      method: "POST",
      url: "/api/watch/open-view-sessions",
      remoteAddress: ip,
      payload: { campaignId: newCampaignId },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("POST /api/watch/open-view-sessions/:openViewSessionId/progress", () => {
  it("accepts a report and adds it to the session's real running total", async () => {
    const campaignId = await seedCampaign({ openViewing: true, audience: "all_ages" });
    await fundCampaign(campaignId);
    const ip = randomIp();

    const started = await app.inject({
      method: "POST",
      url: "/api/watch/open-view-sessions",
      remoteAddress: ip,
      payload: { campaignId },
    });
    const { sessionId } = started.json();

    const progressed = await app.inject({
      method: "POST",
      url: `/api/watch/open-view-sessions/${sessionId}/progress`,
      remoteAddress: ip,
      payload: { campaignId, fromSeconds: 0, toSeconds: 12 },
    });

    expect(progressed.statusCode).toBe(201);
    expect(progressed.json()).toMatchObject({ accepted: true, watchedSeconds: 12 });

    const [row] = (
      await db.execute(
        sql`SELECT watched_seconds FROM watch.open_view_session WHERE id = ${sessionId}`,
      )
    ).rows;
    expect(row).toMatchObject({ watched_seconds: 12 });
  });

  it("404s a session reported from a DIFFERENT IP than started it", async () => {
    const campaignId = await seedCampaign({ openViewing: true, audience: "all_ages" });
    await fundCampaign(campaignId);

    const started = await app.inject({
      method: "POST",
      url: "/api/watch/open-view-sessions",
      remoteAddress: randomIp(),
      payload: { campaignId },
    });
    const { sessionId } = started.json();

    const progressed = await app.inject({
      method: "POST",
      url: `/api/watch/open-view-sessions/${sessionId}/progress`,
      remoteAddress: randomIp(),
      payload: { campaignId, fromSeconds: 0, toSeconds: 5 },
    });

    expect(progressed.statusCode).toBe(404);
  });
});
