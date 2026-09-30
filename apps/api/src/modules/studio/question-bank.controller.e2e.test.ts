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
import { campaigns } from "../campaign/persistence/schema/campaign.table";

/**
 * TASKS.md 7.3.i's own e2e list, over a real HTTP round trip: edit a
 * question and see it change in GET; delete (soft-retire) one; refuse a PII
 * or prediction edit; refuse either PATCH or DELETE once the campaign has
 * left draft. Real Postgres, real Cerbos (`edit_questions`, the same action
 * `create`/`list` already use), real session.
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

/**
 * Stands in for 7.2's media pipeline and 7.3.c's reward endpoint, same move
 * `studio-campaign-authoring.e2e.test.ts` makes: `campaigns_media_required_
 * past_draft` and `campaigns_reward_required_past_draft` both refuse any
 * state past `draft` with these left null. This test only needs a
 * transition its own `assert_lifecycle_transition()` trigger will actually
 * allow to go through -- not a real, fully-funded submission.
 */
async function makeSubmittable(campaignId: string): Promise<void> {
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

async function createDraftCampaign(
  cookie: string,
  businessId: string,
  audience: "all_ages" | "teen" | "adult" | "parents" = "all_ages",
): Promise<string> {
  const now = Date.now();
  const response = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/campaigns`,
    headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
    payload: {
      kind: "long_form",
      title: "7.3.i Check campaign",
      synopsis: "Exercises question edit/retire end to end.",
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
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>().id;
}

function multipleChoicePayload(prompt: string) {
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

async function createQuestion(cookie: string, businessId: string, campaignId: string) {
  const response = await app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/campaigns/${campaignId}/questions`,
    headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
    payload: multipleChoicePayload("Which discount did the video mention?"),
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ question: { id: string } }>().question.id;
}

/** Same POST, but with an arbitrary prompt and the raw response left to the caller -- 12.3.a's teen-personal-question tests need to assert on a refusal, not a 201. */
function postQuestion(cookie: string, businessId: string, campaignId: string, prompt: string) {
  return app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/campaigns/${campaignId}/questions`,
    headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
    payload: multipleChoicePayload(prompt),
  });
}

interface BankQuestionRecordBody {
  readonly question: { readonly id: string; readonly prompt: string; readonly type: string };
  readonly status: string;
  readonly retiredReason: string | null;
}

describe("PATCH /api/:tenantId/studio/campaigns/:campaignId/questions/:questionId", () => {
  it("edits a question's prompt and re-screens it back to draft, visible through GET", async () => {
    const { cookie, businessId } = await ownerAt();
    const campaignId = await createDraftCampaign(cookie, businessId);
    const questionId = await createQuestion(cookie, businessId, campaignId);

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/${businessId}/studio/campaigns/${campaignId}/questions/${questionId}`,
      headers: { cookie },
      payload: multipleChoicePayload("Which discount did the EDITED video mention?"),
    });
    expect(patch.statusCode).toBe(200);
    const patched = patch.json<BankQuestionRecordBody>();
    expect(patched.question.prompt).toBe("Which discount did the EDITED video mention?");
    expect(patched.status).toBe("draft");

    const list = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/campaigns/${campaignId}/questions`,
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const listed = list.json<BankQuestionRecordBody[]>();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.question.prompt).toBe("Which discount did the EDITED video mention?");
  });

  it("refuses an edit that reads as a PII request", async () => {
    const { cookie, businessId } = await ownerAt();
    const campaignId = await createDraftCampaign(cookie, businessId);
    const questionId = await createQuestion(cookie, businessId, campaignId);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/${businessId}/studio/campaigns/${campaignId}/questions/${questionId}`,
      headers: { cookie },
      payload: multipleChoicePayload("WHAT IS YOUR EMAIL?"),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("pii_request");
  });

  it("refuses an edit that reads as a prediction request", async () => {
    const { cookie, businessId } = await ownerAt();
    const campaignId = await createDraftCampaign(cookie, businessId);
    const questionId = await createQuestion(cookie, businessId, campaignId);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/${businessId}/studio/campaigns/${campaignId}/questions/${questionId}`,
      headers: { cookie },
      payload: multipleChoicePayload("Predict next quarter's revenue"),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("prediction_request");
  });

  it("refuses to change a question's type", async () => {
    const { cookie, businessId } = await ownerAt();
    const campaignId = await createDraftCampaign(cookie, businessId);
    const questionId = await createQuestion(cookie, businessId, campaignId);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/${businessId}/studio/campaigns/${campaignId}/questions/${questionId}`,
      headers: { cookie },
      payload: {
        id: randomUUID(),
        campaignId: randomUUID(),
        type: "true_false",
        prompt: "Was a discount mentioned?",
        correctAnswer: true,
        answerableAfterSeconds: 10,
        timerSeconds: 15,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("question_type_immutable");
  });

  it("refuses an edit once the campaign has left draft", async () => {
    const { cookie, businessId } = await ownerAt();
    const campaignId = await createDraftCampaign(cookie, businessId);
    const questionId = await createQuestion(cookie, businessId, campaignId);
    // This test only needs a NON-draft lifecycle state to exist, not a
    // real, fully-funded submission -- but the media/reward CHECKs still
    // apply to a direct SQL transition the same as they would to a real
    // submit, hence `makeSubmittable`.
    await makeSubmittable(campaignId);
    await db
      .update(campaigns)
      .set({ lifecycleState: "in_review" })
      .where(eq(campaigns.id, campaignId));

    const response = await app.inject({
      method: "PATCH",
      url: `/api/${businessId}/studio/campaigns/${campaignId}/questions/${questionId}`,
      headers: { cookie },
      payload: multipleChoicePayload("A different prompt entirely"),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("campaign_not_draft");
  });
});

describe("POST /api/:tenantId/studio/campaigns/:campaignId/questions (12.3.a teen personal-question guard)", () => {
  it("refuses a personal question on a teen-audience campaign, in plain language", async () => {
    const { cookie, businessId } = await ownerAt();
    const campaignId = await createDraftCampaign(cookie, businessId, "teen");

    const response = await postQuestion(cookie, businessId, campaignId, "How old are you?");
    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; message: string }>();
    expect(body.code).toBe("teen_personal_question");
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("allows an ordinary comprehension question on a teen-audience campaign", async () => {
    const { cookie, businessId } = await ownerAt();
    const campaignId = await createDraftCampaign(cookie, businessId, "teen");

    const response = await postQuestion(
      cookie,
      businessId,
      campaignId,
      "Which discount did the video mention?",
    );
    expect(response.statusCode).toBe(201);
  });

  it("refuses the same personal question on an all_ages campaign too, since a teen reaches it", async () => {
    const { cookie, businessId } = await ownerAt();
    const campaignId = await createDraftCampaign(cookie, businessId, "all_ages");

    const response = await postQuestion(cookie, businessId, campaignId, "How old are you?");
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("teen_personal_question");
  });

  it("does not refuse the same personal-style prompt on an adult-only campaign, which a teen cannot reach", async () => {
    const { cookie, businessId } = await ownerAt();
    const campaignId = await createDraftCampaign(cookie, businessId, "adult");

    const response = await postQuestion(cookie, businessId, campaignId, "How old are you?");
    expect(response.statusCode).toBe(201);
  });

  it("re-checks the teen guard on PATCH: an edit into a personal question is refused", async () => {
    const { cookie, businessId } = await ownerAt();
    const campaignId = await createDraftCampaign(cookie, businessId, "teen");
    const questionId = await createQuestion(cookie, businessId, campaignId);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/${businessId}/studio/campaigns/${campaignId}/questions/${questionId}`,
      headers: { cookie },
      payload: multipleChoicePayload("What school do you go to?"),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("teen_personal_question");
  });
});

describe("DELETE /api/:tenantId/studio/campaigns/:campaignId/questions/:questionId", () => {
  it("soft-retires a question while its campaign is still draft", async () => {
    const { cookie, businessId } = await ownerAt();
    const campaignId = await createDraftCampaign(cookie, businessId);
    const questionId = await createQuestion(cookie, businessId, campaignId);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/${businessId}/studio/campaigns/${campaignId}/questions/${questionId}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
    const retired = del.json<BankQuestionRecordBody>();
    expect(retired.status).toBe("retired");
    expect(retired.retiredReason).not.toBeNull();

    const list = await app.inject({
      method: "GET",
      url: `/api/${businessId}/studio/campaigns/${campaignId}/questions`,
      headers: { cookie },
    });
    const listed = list.json<BankQuestionRecordBody[]>();
    expect(listed.find((record) => record.question.id === questionId)?.status).toBe("retired");
  });

  it("refuses to remove a question once the campaign has left draft", async () => {
    const { cookie, businessId } = await ownerAt();
    const campaignId = await createDraftCampaign(cookie, businessId);
    const questionId = await createQuestion(cookie, businessId, campaignId);
    await makeSubmittable(campaignId);
    await db
      .update(campaigns)
      .set({ lifecycleState: "in_review" })
      .where(eq(campaigns.id, campaignId));

    const response = await app.inject({
      method: "DELETE",
      url: `/api/${businessId}/studio/campaigns/${campaignId}/questions/${questionId}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("campaign_not_draft");
  });

  it("404s for a question that does not belong to this campaign", async () => {
    const { cookie, businessId } = await ownerAt();
    const campaignId = await createDraftCampaign(cookie, businessId);
    const otherCampaignId = await createDraftCampaign(cookie, businessId);
    const questionId = await createQuestion(cookie, businessId, otherCampaignId);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/${businessId}/studio/campaigns/${campaignId}/questions/${questionId}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});
