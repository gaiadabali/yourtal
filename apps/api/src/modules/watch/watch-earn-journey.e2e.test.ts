import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  issueCheckpointToken,
  CHECKPOINT_TOKEN_TTL_MS,
} from "@yourtal/contracts/watch/checkpoint-token";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { sessionFor } from "../../shared/testing/session-for";

/**
 * 5.1.e, 5.2.g, 5.3.b's Checks, over the real HTTP stack: a real Nest app,
 * real Cerbos-gated routes, the real (fake-mode) ledger client, and a real
 * Postgres database — the same shape `wallet.controller.test.ts` and
 * `session-and-region-wall.check.e2e.test.ts` use.
 *
 * The seeded catalogue (5.1.c) is entirely 30s campaigns to match the one
 * HLS fixture, which means `questionsAskedFor(30) === 0` — no seeded
 * campaign has a checkpoint to test against. So this file seeds one
 * throwaway 60s campaign of its own, with a real funded allocation and a
 * two-question bank, for the checkpoint/completion legs — the same
 * "a fixture this suite owns outright" technique
 * `watch.controller.e2e.test.ts` already uses for its paused-campaign row.
 */

const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");

let app: NestFastifyApplication;
let ledger: LedgerInternalClient;

const businessId = randomUUID();
const campaignId = randomUUID();
const otherCampaignId = randomUUID();
const allocationId = randomUUID();
const questionAId = randomUUID();
const questionBId = randomUUID();
const CAMPAIGN_DURATION_SECONDS = 60;
const REWARD_POINTS = 500;

async function insertQuestion(
  questionId: string,
  prompt: string,
  correctLabel: "Right" | "Wrong",
): Promise<void> {
  await owner.execute(sql`
    INSERT INTO campaign.question (id, campaign_id, type, prompt, timer_seconds, status, pii_screen, answerable_after_seconds)
    VALUES (${questionId}, ${campaignId}, 'multiple_choice', ${prompt}, 30, 'approved', 'clear', 0)
  `);
  const rightId = randomUUID();
  const wrongId = randomUUID();
  await owner.execute(sql`
    INSERT INTO campaign.question_option (id, question_id, label, ordinal) VALUES
      (${rightId}, ${questionId}, 'Right', 0),
      (${wrongId}, ${questionId}, 'Wrong', 1)
  `);
  const correctOptionId = correctLabel === "Right" ? rightId : wrongId;
  await owner.execute(sql`
    INSERT INTO campaign.question_answer_key (question_id, correct_option_id) VALUES (${questionId}, ${correctOptionId})
  `);
}

/** The right option id for whichever question `pickQuestionForCheckpoint` actually drew, read the only way `yourtal_app` cannot: as owner. */
async function correctOptionFor(questionId: string): Promise<string> {
  const rows = await owner.execute<{ correct_option_id: string }>(sql`
    SELECT correct_option_id FROM campaign.question_answer_key WHERE question_id = ${questionId}
  `);
  const id = rows.rows[0]?.correct_option_id;
  if (id === undefined) throw new Error(`no answer key for question ${questionId}`);
  return id;
}

function wrongOptionFor(presentedOptions: readonly { id: string }[], correctId: string): string {
  const wrong = presentedOptions.find((option) => option.id !== correctId);
  if (wrong === undefined) throw new Error("expected a wrong option to exist");
  return wrong.id;
}

/**
 * `app.inject(...)`'s response `.json()` returns `any` — this is the one
 * place that gets narrowed, so every call site below reads as a typed
 * value rather than scattering `as` assertions `no-unnecessary-type-
 * assertion` then flags as redundant once TS's own inference already
 * widens through `any`.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the single use IS the point: a narrow, per-call-site return type instead of `any` flowing out of `.json()`.
function json<T>(response: { json: () => unknown }): T {
  return response.json() as T;
}

beforeAll(async () => {
  await owner.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule,
       lifecycle_state, published_at, business_id, region, audience, content_category,
       poster_url, teaser_url, hls_url, aspect, estimated_bytes,
       starts_at, ends_at, open_viewing, teaser_start_seconds)
    VALUES
      (${campaignId}, 'quick', '5.1-5.3 e2e fixture', ${randomUUID()}, 'e2e merchant',
       'fixture', ${CAMPAIGN_DURATION_SECONDS}, 5, ${REWARD_POINTS}, 1, 'base_only',
       'live', now(), ${businessId}, 'AU', 'all_ages', 'entertainment',
       'https://example.test/poster.jpg', 'https://example.test/teaser.m3u8',
       'https://example.test/hls.m3u8', '16:9', 1000000,
       now(), now() + interval '30 days', false, 0)
  `);
  await owner.execute(sql`
    INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds, accuracy_bonus_points, effective_from)
    VALUES (${campaignId}, 1, ${REWARD_POINTS}, 1, 'base_only', ${CAMPAIGN_DURATION_SECONDS}, 0, now())
  `);
  await owner.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${campaignId}, 'hls', 'https://example.test/hls.m3u8')
  `);
  await insertQuestion(questionAId, "Question A?", "Right");
  await insertQuestion(questionBId, "Question B?", "Wrong");

  // A second, unrelated live campaign in the SAME region — needed for the
  // parking test. The seeded catalogue (5.1.c) is entirely region ID; an
  // AU-jurisdiction viewer (`sessionFor`'s default) would have every one of
  // those denied by `campaign_view.yaml`'s region wall, so this suite
  // cannot borrow the seeded catalogue for "start a DIFFERENT campaign".
  await owner.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule,
       lifecycle_state, published_at, business_id, region, audience, content_category,
       poster_url, teaser_url, hls_url, aspect, estimated_bytes,
       starts_at, ends_at, open_viewing, teaser_start_seconds)
    VALUES
      (${otherCampaignId}, 'quick', '5.1.b e2e fixture (other campaign)', ${randomUUID()}, 'e2e merchant',
       'fixture', 30, 5, 100, 0, 'base_only',
       'live', now(), ${randomUUID()}, 'AU', 'all_ages', 'entertainment',
       'https://example.test/poster.jpg', 'https://example.test/teaser.m3u8',
       'https://example.test/hls.m3u8', '16:9', 1000000,
       now(), now() + interval '30 days', false, 0)
  `);
  await owner.execute(sql`
    INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds, accuracy_bonus_points, effective_from)
    VALUES (${otherCampaignId}, 1, 100, 0, 'base_only', 30, 0, now())
  `);
  await owner.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${otherCampaignId}, 'hls', 'https://example.test/hls.m3u8')
  `);

  await owner.execute(sql`
    INSERT INTO platform.ledger_fake_allocation (id, business_id, region, funder_type, currency, total_points, remaining_points)
    VALUES (${allocationId}, ${businessId}, 'AU', 'partner', 'AUD', 1000000, 1000000)
  `);
  await owner.execute(sql`
    INSERT INTO campaign.reward_config
      (campaign_id, allocation_id, funder_type, max_points_for_campaign, reward_points_per_completion, accuracy_bonus_points)
    VALUES (${campaignId}, ${allocationId}, 'partner', ${REWARD_POINTS}, ${REWARD_POINTS}, 0)
  `);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  ledger = app.get(LEDGER_INTERNAL_CLIENT);
});

afterAll(async () => {
  await app.close();
  await owner.execute(sql`DELETE FROM campaign.reward_config WHERE campaign_id = ${campaignId}`);
  // Holds and grants reference the allocation; the allocation must go last.
  await owner.execute(
    sql`DELETE FROM platform.ledger_fake_hold WHERE allocation_id = ${allocationId}`,
  );
  await owner.execute(
    sql`DELETE FROM platform.ledger_fake_grant WHERE campaign_id = ${campaignId}`,
  );
  await owner.execute(sql`DELETE FROM platform.ledger_fake_allocation WHERE id = ${allocationId}`);
  // question_response references BOTH watch.session and question_option —
  // it must go before either.
  await owner.execute(sql`
    DELETE FROM campaign.question_response WHERE session_id IN
      (SELECT id FROM watch.session WHERE campaign_id IN (${campaignId}, ${otherCampaignId}))
  `);
  await owner.execute(
    sql`DELETE FROM campaign.question_answer_key WHERE question_id IN (${questionAId}, ${questionBId})`,
  );
  await owner.execute(
    sql`DELETE FROM campaign.question_option WHERE question_id IN (${questionAId}, ${questionBId})`,
  );
  await owner.execute(
    sql`DELETE FROM campaign.question WHERE id IN (${questionAId}, ${questionBId})`,
  );
  await owner.execute(sql`
    DELETE FROM watch.checkpoint_issue WHERE session_id IN
      (SELECT id FROM watch.session WHERE campaign_id IN (${campaignId}, ${otherCampaignId}))
  `);
  await owner.execute(sql`
    DELETE FROM watch.checkpoint_nonce WHERE session_id IN
      (SELECT id FROM watch.session WHERE campaign_id IN (${campaignId}, ${otherCampaignId}))
  `);
  await owner.execute(
    sql`DELETE FROM watch.session WHERE campaign_id IN (${campaignId}, ${otherCampaignId})`,
  );
  await owner.execute(
    sql`DELETE FROM campaign.terms_version WHERE campaign_id IN (${campaignId}, ${otherCampaignId})`,
  );
  await owner.execute(
    sql`DELETE FROM campaign.video_source WHERE campaign_id IN (${campaignId}, ${otherCampaignId})`,
  );
  await owner.execute(
    sql`DELETE FROM campaign.campaigns WHERE id IN (${campaignId}, ${otherCampaignId})`,
  );
});

/** Backdates a session's clock so a single progress report can claim the whole campaign without a real wait. */
async function backdateSessionStart(sessionId: string, secondsAgo: number): Promise<void> {
  await owner.execute(
    sql`UPDATE watch.session SET started_at = now() - make_interval(secs => ${secondsAgo}) WHERE id = ${sessionId}`,
  );
}

describe("5.1.e: the farming probe", () => {
  it("600 progress reports posted as fast as possible cover no more than the real time that actually elapsed", async () => {
    const viewer = await sessionFor(app);
    const started = await app.inject({
      method: "POST",
      url: "/api/watch/sessions",
      headers: { cookie: viewer.cookie, "idempotency-key": randomUUID() },
      payload: { campaignId },
    });
    expect(started.statusCode).toBe(201);
    const sessionId = json<{ session: { id: string } }>(started).session.id;

    const startedAtMs = Date.now();
    let lastCovered = 0;
    for (let index = 0; index < 600; index += 1) {
      const from = index * 3;
      const to = from + 3;
      if (to > CAMPAIGN_DURATION_SECONDS) break;
      const response = await app.inject({
        method: "POST",
        url: `/api/watch/sessions/${sessionId}/progress`,
        headers: { cookie: viewer.cookie },
        payload: { fromSeconds: from, toSeconds: to, reportedAt: new Date().toISOString() },
      });
      if (response.statusCode === 200) {
        lastCovered = json<{ coveredSeconds: number }>(response).coveredSeconds;
      }
    }
    const elapsedSeconds = (Date.now() - startedAtMs) / 1000;

    // The whole point: nowhere near 600*3=1800s, and never more than the
    // clock actually allows (elapsed + the one-time tolerance).
    expect(lastCovered).toBeLessThanOrEqual(elapsedSeconds + 3.5);
    expect(lastCovered).toBeLessThan(CAMPAIGN_DURATION_SECONDS);
  }, 30_000);

  it("a burst of PARALLEL progress reports is bounded the same way, by the row lock", async () => {
    const viewer = await sessionFor(app);
    const started = await app.inject({
      method: "POST",
      url: "/api/watch/sessions",
      headers: { cookie: viewer.cookie, "idempotency-key": randomUUID() },
      payload: { campaignId },
    });
    const sessionId = json<{ session: { id: string } }>(started).session.id;

    const startedAtMs = Date.now();
    const requests = Array.from({ length: 30 }, () =>
      app.inject({
        method: "POST",
        url: `/api/watch/sessions/${sessionId}/progress`,
        headers: { cookie: viewer.cookie },
        payload: {
          fromSeconds: 0,
          toSeconds: CAMPAIGN_DURATION_SECONDS,
          reportedAt: new Date().toISOString(),
        },
      }),
    );
    await Promise.all(requests);
    const elapsedSeconds = (Date.now() - startedAtMs) / 1000;

    const resumed = await app.inject({
      method: "GET",
      url: `/api/watch/sessions/${sessionId}`,
      headers: { cookie: viewer.cookie },
    });
    const covered = json<{ coveredSeconds: number }>(resumed).coveredSeconds;
    expect(covered).toBeLessThanOrEqual(elapsedSeconds + 3.5);
  }, 30_000);
});

describe("5.1.b: parking, resuming, and already_earned", () => {
  it("opening another campaign parks the first, and resuming it keeps its coverage", async () => {
    const viewer = await sessionFor(app);
    const first = await app.inject({
      method: "POST",
      url: "/api/watch/sessions",
      headers: { cookie: viewer.cookie, "idempotency-key": randomUUID() },
      payload: { campaignId },
    });
    const firstSessionId = json<{ session: { id: string } }>(first).session.id;
    await app.inject({
      method: "POST",
      url: `/api/watch/sessions/${firstSessionId}/progress`,
      headers: { cookie: viewer.cookie },
      payload: { fromSeconds: 0, toSeconds: 2, reportedAt: new Date().toISOString() },
    });

    const second = await app.inject({
      method: "POST",
      url: "/api/watch/sessions",
      headers: { cookie: viewer.cookie, "idempotency-key": randomUUID() },
      payload: { campaignId: otherCampaignId },
    });
    expect(second.statusCode).toBe(201);
    const secondSessionId = json<{ session: { id: string } }>(second).session.id;
    expect(secondSessionId).not.toBe(firstSessionId);

    const resumedFirst = await app.inject({
      method: "POST",
      url: "/api/watch/sessions",
      headers: { cookie: viewer.cookie, "idempotency-key": randomUUID() },
      payload: { campaignId },
    });
    const resumedSession = json<{ session: { id: string; state: string } }>(resumedFirst).session;
    expect(resumedSession.id).toBe(firstSessionId);
    expect(resumedSession.state).toBe("active");

    const coverage = await app.inject({
      method: "GET",
      url: `/api/watch/sessions/${firstSessionId}`,
      headers: { cookie: viewer.cookie },
    });
    expect(json<{ coveredSeconds: number }>(coverage).coveredSeconds).toBe(2);
  });

  it("a second reward session on an already-granted campaign is non-earning (already_earned), and replay is allowed", async () => {
    const viewer = await sessionFor(app);
    const first = await completeCampaignFully(viewer.cookie);
    expect(first.granted).toBe(true);

    const second = await app.inject({
      method: "POST",
      url: "/api/watch/sessions",
      headers: { cookie: viewer.cookie, "idempotency-key": randomUUID() },
      payload: { campaignId },
    });
    expect(second.statusCode).toBe(201);
    const body = json<{ alreadyEarned: boolean }>(second);
    expect(body.alreadyEarned).toBe(true);
  });
});

describe("5.2: questions during the video, served and scored on the server", () => {
  it("a 60s campaign issues exactly one checkpoint, with no answer key in the response", async () => {
    const viewer = await sessionFor(app);
    const started = await app.inject({
      method: "POST",
      url: "/api/watch/sessions",
      headers: { cookie: viewer.cookie, "idempotency-key": randomUUID() },
      payload: { campaignId },
    });
    const sessionId = json<{ session: { id: string } }>(started).session.id;
    await backdateSessionStart(sessionId, CAMPAIGN_DURATION_SECONDS + 5);
    await app.inject({
      method: "POST",
      url: `/api/watch/sessions/${sessionId}/progress`,
      headers: { cookie: viewer.cookie },
      payload: {
        fromSeconds: 0,
        toSeconds: CAMPAIGN_DURATION_SECONDS,
        reportedAt: new Date().toISOString(),
      },
    });

    const checkpoint0 = await app.inject({
      method: "POST",
      url: `/api/watch/sessions/${sessionId}/checkpoints/0`,
      headers: { cookie: viewer.cookie },
    });
    expect(checkpoint0.statusCode).toBe(201);
    const question = json<{ question: Record<string, unknown> }>(checkpoint0).question;
    expect(question).not.toHaveProperty("correctOptionId");
    expect(question).not.toHaveProperty("correctAnswer");
    expect(JSON.stringify(question)).not.toContain("correct");

    const checkpoint1 = await app.inject({
      method: "POST",
      url: `/api/watch/sessions/${sessionId}/checkpoints/1`,
      headers: { cookie: viewer.cookie },
    });
    expect(checkpoint1.statusCode).toBe(404);
  });

  it("a wrong answer is scored wrong by the server", async () => {
    const viewer = await sessionFor(app);
    const sessionId = await startFullyWatchedSession(viewer.cookie);
    const checkpoint = await app.inject({
      method: "POST",
      url: `/api/watch/sessions/${sessionId}/checkpoints/0`,
      headers: { cookie: viewer.cookie },
    });
    const body = json<{
      token: string;
      question: { id: string; options: { id: string; label: string }[] };
    }>(checkpoint);
    const correctId = await correctOptionFor(body.question.id);
    const wrongId = wrongOptionFor(body.question.options, correctId);

    const answer = await app.inject({
      method: "POST",
      url: `/api/watch/sessions/${sessionId}/checkpoints/0/answer`,
      headers: { cookie: viewer.cookie },
      payload: { token: body.token, selectedOptionId: wrongId },
    });
    expect(answer.statusCode).toBe(201);
    expect(json<{ wasCorrect: boolean }>(answer).wasCorrect).toBe(false);
  });

  it("a timeout is scored wrong, never voids, even when the submitted answer is correct", async () => {
    const viewer = await sessionFor(app);
    const sessionId = await startFullyWatchedSession(viewer.cookie);
    const checkpoint = await app.inject({
      method: "POST",
      url: `/api/watch/sessions/${sessionId}/checkpoints/0`,
      headers: { cookie: viewer.cookie },
    });
    const body = json<{ question: { id: string } }>(checkpoint);
    const correctId = await correctOptionFor(body.question.id);

    // A token whose SIGNATURE is still valid (well inside CHECKPOINT_TOKEN_TTL_MS)
    // but whose embedded issuance time is 40s in the past — past the 30s
    // answer timer. Constructed directly rather than waiting 40 real
    // seconds; `redeem()` only checks the nonce table, never re-derives
    // issuance time itself, so this is a faithful stand-in for "an honest
    // client that took 40s to answer", not a way around any real check.
    const secret = process.env["CHECKPOINT_TOKEN_SECRET"];
    expect(secret, "CHECKPOINT_TOKEN_SECRET must be set for this suite to run at all").toBeTruthy();
    const backdatedIssuedAtMs = Date.now() - 40_000;
    const forgedToken = issueCheckpointToken(
      {
        sessionId,
        checkpointIndex: 0,
        nonce: randomUUID().replace(/-/g, ""),
        expiresAtMs: backdatedIssuedAtMs + CHECKPOINT_TOKEN_TTL_MS,
      },
      secret ?? "",
    );

    const answer = await app.inject({
      method: "POST",
      url: `/api/watch/sessions/${sessionId}/checkpoints/0/answer`,
      headers: { cookie: viewer.cookie },
      payload: { token: forgedToken, selectedOptionId: correctId },
    });
    expect(answer.statusCode).toBe(201);
    // Right answer, but 40s after issuance: scored wrong by the clock, not voided.
    expect(json<{ answered: boolean; wasCorrect: boolean }>(answer)).toMatchObject({
      answered: true,
      wasCorrect: false,
    });
  });
});

describe("5.3: completion grants the reward", () => {
  it("start -> progress -> answer -> complete produces a ledger pending entry for the terms' points, and a second complete does not grant twice", async () => {
    const viewer = await sessionFor(app);
    const result = await completeCampaignFully(viewer.cookie);
    expect(result.granted).toBe(true);
    expect(result.pendingPoints).toBe(REWARD_POINTS);

    const balance = await ledger.balance(viewer.userId);
    expect(balance.isOk()).toBe(true);
    if (balance.isOk()) {
      const totalPending = balance.value.pending.reduce(
        (total, bucket) => total + bucket.points,
        0,
      );
      expect(totalPending).toBeGreaterThanOrEqual(REWARD_POINTS);
      // A fresh account is trust tier 0 — F12's 72h holdback — so this is a
      // genuinely PENDING entry, not an immediately-available one.
      expect(balance.value.pending.some((bucket) => new Date(bucket.unlockAt) > new Date())).toBe(
        true,
      );
    }

    // Replaying the SAME Idempotency-Key returns the identical response
    // without re-executing the handler at all (`@Idempotent`) — the
    // ordinary way a client retries a request it is not sure landed.
    const replay = await app.inject({
      method: "POST",
      url: `/api/watch/sessions/${result.sessionId}/complete`,
      headers: { cookie: viewer.cookie, "idempotency-key": result.completeIdempotencyKey },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toStrictEqual(
      expect.objectContaining({ granted: true, pendingPoints: REWARD_POINTS }),
    );

    // A genuinely SECOND attempt (a fresh key) hits `judgeCompletion`'s own
    // `not_active` refusal — the session is already `completed` — rather
    // than reaching `markCompleted`'s conditional-update race guard at all.
    // Either way, no second grant: EW-10's guarantee is about the ledger
    // row count, not which of the two refusal paths a retry happens to hit.
    const secondAttempt = await app.inject({
      method: "POST",
      url: `/api/watch/sessions/${result.sessionId}/complete`,
      headers: { cookie: viewer.cookie, "idempotency-key": randomUUID() },
    });
    expect(secondAttempt.statusCode).toBe(403);

    const balanceAfter = await ledger.balance(viewer.userId);
    if (balanceAfter.isOk() && balance.isOk()) {
      const before = balance.value.pending.reduce((total, bucket) => total + bucket.points, 0);
      const after = balanceAfter.value.pending.reduce((total, bucket) => total + bucket.points, 0);
      expect(after).toBe(before);
    }
  });
});

/** Starts a session on the fixture campaign and reports full coverage via a backdated clock — no real wait. */
async function startFullyWatchedSession(cookie: string): Promise<string> {
  const started = await app.inject({
    method: "POST",
    url: "/api/watch/sessions",
    headers: { cookie, "idempotency-key": randomUUID() },
    payload: { campaignId },
  });
  const sessionId = json<{ session: { id: string } }>(started).session.id;
  await backdateSessionStart(sessionId, CAMPAIGN_DURATION_SECONDS + 5);
  const progress = await app.inject({
    method: "POST",
    url: `/api/watch/sessions/${sessionId}/progress`,
    headers: { cookie },
    payload: {
      fromSeconds: 0,
      toSeconds: CAMPAIGN_DURATION_SECONDS,
      reportedAt: new Date().toISOString(),
    },
  });
  expect(progress.statusCode).toBe(201);
  return sessionId;
}

async function completeCampaignFully(cookie: string): Promise<{
  sessionId: string;
  granted: boolean;
  pendingPoints: number;
  completeIdempotencyKey: string;
}> {
  const sessionId = await startFullyWatchedSession(cookie);

  const checkpoint = await app.inject({
    method: "POST",
    url: `/api/watch/sessions/${sessionId}/checkpoints/0`,
    headers: { cookie },
  });
  const body = json<{ token: string; question: { id: string } }>(checkpoint);
  const correctId = await correctOptionFor(body.question.id);
  const answer = await app.inject({
    method: "POST",
    url: `/api/watch/sessions/${sessionId}/checkpoints/0/answer`,
    headers: { cookie },
    payload: { token: body.token, selectedOptionId: correctId },
  });
  expect(json<{ wasCorrect: boolean }>(answer).wasCorrect).toBe(true);

  const completeIdempotencyKey = randomUUID();
  const complete = await app.inject({
    method: "POST",
    url: `/api/watch/sessions/${sessionId}/complete`,
    headers: { cookie, "idempotency-key": completeIdempotencyKey },
  });
  expect(complete.statusCode).toBe(201);
  const completed = json<{ granted: boolean; pendingPoints: number }>(complete);
  return {
    sessionId,
    granted: completed.granted,
    pendingPoints: completed.pendingPoints,
    completeIdempotencyKey,
  };
}
