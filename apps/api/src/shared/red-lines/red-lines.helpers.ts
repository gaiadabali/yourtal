import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { AppDb } from "../persistence/drizzle-client";
import { sessionFor } from "../testing/session-for";
import { seedBusinessMembership } from "../testing/seed-business-membership";
import { businessAccounts } from "../../modules/business/persistence/schema/business-account.table";
import { campaigns } from "../../modules/campaign/persistence/schema/campaign.table";

/**
 * TASKS.md 13.5.b: fixture builders shared by `red-lines.e2e.test.ts`.
 * Deliberately NOT imported from `question-bank.controller.e2e.test.ts` /
 * `studio-campaign-authoring.e2e.test.ts` (their `ownerAt`/`createDraftCampaign`
 * aren't exported, and this suite may only add files under this folder) --
 * these are small, independent re-implementations of the same fixture shape.
 */

/** A fresh AU owner with a fresh, NOT-KYB-verified business (seedBusinessMembership's own default). */
export async function ownerAt(
  app: NestFastifyApplication,
  db: AppDb,
): Promise<{ cookie: string; businessId: string; userId: string }> {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  const businessId = await seedBusinessMembership(db, { userId: session.userId, role: "owner" });
  return { cookie: session.cookie, businessId, userId: session.userId };
}

export async function markKybVerified(db: AppDb, businessId: string): Promise<void> {
  await db
    .update(businessAccounts)
    .set({ isVerified: true })
    .where(eq(businessAccounts.id, businessId));
}

export async function createDraftCampaign(
  app: NestFastifyApplication,
  businessId: string,
  cookie: string,
  audience: "all_ages" | "teen" | "adult" | "parents" = "all_ages",
): Promise<string> {
  const now = Date.now();
  const response = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/campaigns`,
    headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
    payload: {
      kind: "long_form",
      title: "13.5.b red-line check campaign",
      synopsis: "Exercises a red-line guard end to end.",
      durationSeconds: 20 * 60,
      contentCategory: "food-and-drink",
      audience,
      startsAt: new Date(now).toISOString(),
      endsAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
      openViewing: false,
      teaserStartSeconds: 0,
      declaredInterests: [],
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(
      `createDraftCampaign failed (${String(response.statusCode)}): ${response.body}`,
    );
  }
  return response.json<{ id: string }>().id;
}

/** Satisfies the media/reward CHECKs that gate any state past `draft` -- see 7.3.i's own note on this shape. */
export async function makeSubmittable(db: AppDb, campaignId: string): Promise<void> {
  await db
    .update(campaigns)
    .set({
      posterUrl: "https://media.example/poster.jpg",
      teaserUrl: "https://media.example/teaser.mp4",
      hlsUrl: "https://media.example/stream.m3u8",
      aspect: "9:16",
      estimatedBytes: 50_000_000,
      estimatedDataMb: "50",
      rewardPoints: 100,
      questionCount: 1,
      scoringRule: "base_only",
    })
    .where(eq(campaigns.id, campaignId));
}

export function multipleChoicePayload(prompt: string) {
  const correctOptionId = randomUUID();
  return {
    id: randomUUID(),
    campaignId: randomUUID(),
    type: "multiple_choice" as const,
    prompt,
    options: [
      { id: correctOptionId, label: "10% off" },
      { id: randomUUID(), label: "20% off" },
    ],
    correctOptionId,
    answerableAfterSeconds: 10,
    timerSeconds: 15,
  };
}

export function postQuestion(
  app: NestFastifyApplication,
  businessId: string,
  campaignId: string,
  cookie: string,
  prompt: string,
) {
  return app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/campaigns/${campaignId}/questions`,
    headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
    payload: multipleChoicePayload(prompt),
  });
}

export async function createQuestion(
  app: NestFastifyApplication,
  businessId: string,
  campaignId: string,
  cookie: string,
): Promise<string> {
  const response = await postQuestion(
    app,
    businessId,
    campaignId,
    cookie,
    "Which discount did the video mention?",
  );
  if (response.statusCode !== 201) {
    throw new Error(`createQuestion failed (${String(response.statusCode)}): ${response.body}`);
  }
  return response.json<{ question: { id: string } }>().question.id;
}

export function patchQuestion(
  app: NestFastifyApplication,
  businessId: string,
  campaignId: string,
  questionId: string,
  cookie: string,
  prompt: string,
) {
  return app.inject({
    method: "PATCH",
    url: `/api/${businessId}/studio/campaigns/${campaignId}/questions/${questionId}`,
    headers: { cookie },
    payload: multipleChoicePayload(prompt),
  });
}

const TERMS_VERSION = 1;

/**
 * A `live` campaign with N watch sessions, `completedCount` of them
 * `completed` -- the minimum a reports test needs, written straight into
 * `campaign.campaigns`/`watch.session` the same way
 * `reports.controller.e2e.test.ts` does (Reports only ever reads this table).
 */
export async function seedReportCampaign(
  db: AppDb,
  businessId: string,
  sessionCount: number,
  completedCount: number,
): Promise<string> {
  const campaignId = randomUUID();
  await db.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule, lifecycle_state,
       published_at, business_id, region, audience, content_category, poster_url,
       teaser_url, hls_url, aspect, estimated_bytes, starts_at, ends_at, open_viewing,
       teaser_start_seconds)
    VALUES
      (${campaignId}, 'long_form', '13.5.b Reports red-line campaign', ${businessId}, 'Red-line Merchant',
       'Exercises red line 10 end to end.', 30, 10, 100, 1, 'base_only', 'live',
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
  for (let index = 0; index < sessionCount; index += 1) {
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
  return campaignId;
}
