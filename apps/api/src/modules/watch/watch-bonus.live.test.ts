import { randomUUID } from "node:crypto";
import path from "node:path";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { AppModule } from "../../app.module";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { createAppDb, type AppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { startLiveServices, type LiveServices } from "../devices/testing/live-services";

/**
 * 13.3.f (F96), against the live Go ledger: a partial score on a bonus campaign
 * earns the base and no bonus, granted, never refused or a 500 (the ledger used
 * to prorate the bonus while the api paid all-or-nothing, so the two disagreed).
 * Coverage is seeded as the owner: real-time watching of a 10-minute video is
 * 5.1's own test; this one is about the grant.
 *   node packages/db/scripts/with-test-db.mjs -- env CHECKOUT_LIVE=1 \
 *     pnpm --filter @yourtal/api exec vitest run src/modules/watch/watch-bonus.live.test.ts
 */
const live = process.env["CHECKOUT_LIVE"] === "1";
const BASE = 100;
const BONUS = 30;
const DURATION = 600; // two questions asked (one per 5 minutes)

let app: NestFastifyApplication;
let ledger: LedgerInternalClient;
let owner: AppDb;
let services: LiveServices | undefined;

beforeAll(async () => {
  if (!live) return;
  services = await startLiveServices(path.resolve(process.cwd(), "..", ".."));
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  ledger = app.get<LedgerInternalClient>(LEDGER_INTERNAL_CLIENT);
  owner = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
}, 180_000);

afterAll(async () => {
  if (!live) return;
  await app.close();
  await services?.stop();
});

async function bonusCampaign(): Promise<string> {
  const businessId = randomUUID();
  const campaignId = randomUUID();
  await owner.execute(sql`
    INSERT INTO business.business_accounts
      (id, legal_name, display_name, roles, is_verified, region, currency, handle,
       tax_id_kind, tax_id_value, address_state, address_postcode)
    VALUES (${businessId}, 'Bonus Check', 'Bonus Check', '["advertiser"]'::jsonb, true, 'AU', 'AUD',
            ${`bonus-check-${campaignId.slice(0, 8)}`}, 'ABN', '51824753556', 'NSW', '2000')`);
  await owner.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds, estimated_data_mb,
       reward_points, question_count, scoring_rule, lifecycle_state, published_at, business_id,
       region, audience, content_category, poster_url, teaser_url, hls_url, aspect,
       estimated_bytes, starts_at, ends_at, open_viewing, teaser_start_seconds)
    VALUES (${campaignId}, 'long_form', 'Bonus check', ${businessId}, 'Bonus Check', 'fixture',
            ${DURATION}, 5, ${BASE}, 2, 'base_plus_accuracy_bonus', 'live', now(), ${businessId},
            'AU', 'all_ages', 'entertainment', 'https://example.test/p.jpg',
            'https://example.test/t.mp4', 'https://example.test/h.m3u8', '16:9', 1000000,
            now(), now() + interval '30 days', false, 0)`);
  await owner.execute(sql`
    INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds,
       accuracy_bonus_points, effective_from)
    VALUES (${campaignId}, 1, ${BASE}, 2, 'base_plus_accuracy_bonus', ${DURATION}, ${BONUS}, now())`);
  await owner.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${campaignId}, 'hls', 'https://example.test/h.m3u8')`);
  await owner.execute(sql`
    INSERT INTO campaign.chapter (campaign_id, ordinal, title, start_seconds, reward_weight)
    VALUES (${campaignId}, 0, 'All', 0, 1)`);
  // A bank three times the two asked.
  for (let i = 0; i < 6; i += 1) {
    const questionId = randomUUID();
    const right = randomUUID();
    const wrong = randomUUID();
    await owner.execute(sql`
      INSERT INTO campaign.question
        (id, campaign_id, type, prompt, timer_seconds, status, pii_screen, answerable_after_seconds)
      VALUES (${questionId}, ${campaignId}, 'multiple_choice', ${`Question ${String(i)}`}, 30,
              'approved', 'clear', 0)`);
    await owner.execute(sql`
      INSERT INTO campaign.question_option (id, question_id, label, ordinal)
      VALUES (${right}, ${questionId}, 'Right', 0), (${wrong}, ${questionId}, 'Wrong', 1)`);
    await owner.execute(sql`
      INSERT INTO campaign.question_answer_key (question_id, correct_option_id)
      VALUES (${questionId}, ${right})`);
  }
  const allocation = await ledger.purchasePoints({
    businessId,
    region: "AU",
    currency: "AUD",
    points: toPoints(10_000),
    paidMinor: toMinorUnits(45_000),
    idempotencyKey: `bonus-check:${campaignId}`,
  });
  const allocationId = allocation._unsafeUnwrap().allocationId;
  await owner.execute(sql`
    INSERT INTO campaign.reward_config
      (campaign_id, allocation_id, funder_type, max_points_for_campaign,
       reward_points_per_completion, accuracy_bonus_points)
    VALUES (${campaignId}, ${allocationId}, 'partner', 10000, ${BASE}, ${BONUS})`);
  return campaignId;
}

describe.skipIf(!live)("a partial score on a bonus campaign (F96)", () => {
  it("earns the base and no bonus, and is granted", async () => {
    const campaignId = await bonusCampaign();
    const viewer = await sessionFor(app, { jurisdiction: "AU" });
    const headers = { cookie: viewer.cookie };
    const post = (url: string, payload: unknown = {}) =>
      app.inject({
        method: "POST",
        url,
        headers: { ...headers, "idempotency-key": randomUUID() },
        payload: payload as Record<string, unknown>,
      });

    const started = await post("/api/watch/sessions", { campaignId });
    expect(started.statusCode, started.body).toBe(201);
    const sessionId = started.json<{ session: { id: string } }>().session.id;
    await owner.execute(sql`
      INSERT INTO watch.coverage (session_id, from_second, to_second, recorded_at)
      VALUES (${sessionId}, 0, ${DURATION}, now())`);

    // The first checkpoint answered right, the second wrong: one of two.
    for (const [index, answerRight] of [
      [0, true],
      [1, false],
    ] as const) {
      const presented = await post(`/api/watch/sessions/${sessionId}/checkpoints/${String(index)}`);
      expect(presented.statusCode, presented.body).toBeLessThan(300);
      const body = presented.json<{
        token: string;
        question: { id: string; options: { id: string }[] };
      }>();
      const key = await owner.execute<{ correct_option_id: string }>(
        sql`SELECT correct_option_id FROM campaign.question_answer_key WHERE question_id = ${body.question.id}`,
      );
      const right = key.rows[0]?.correct_option_id;
      const pick = answerRight ? right : body.question.options.find((o) => o.id !== right)?.id;
      const answered = await post(
        `/api/watch/sessions/${sessionId}/checkpoints/${String(index)}/answer`,
        { token: body.token, selectedOptionId: pick },
      );
      expect(answered.statusCode, answered.body).toBeLessThan(300);
    }

    const done = await post(`/api/watch/sessions/${sessionId}/complete`);
    expect(done.statusCode, done.body).toBeLessThan(300);
    expect(done.json()).toMatchObject({ completed: true, granted: true, pendingPoints: BASE });

    const grant = await owner.execute<{ points: string }>(
      sql`SELECT points::text FROM ledger.grant WHERE user_id = ${viewer.userId} AND campaign_id = ${campaignId}`,
    );
    expect(grant.rows).toEqual([{ points: String(BASE) }]);
  }, 120_000);
});
