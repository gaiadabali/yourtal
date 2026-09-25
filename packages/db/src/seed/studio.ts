import { createHash } from "node:crypto";
import type pg from "pg";
import { mockCampaigns } from "@yourtal/contracts/campaign/mock";
import { BANK_MULTIPLE, questionsAskedFor } from "@yourtal/contracts/question/bank";
import type { Campaign } from "@yourtal/contracts/campaign";

/**
 * Studio's own domain: campaigns, their creative and their question bank.
 * 1.3.b split this out of the old single `seed.ts` — see that file's header
 * for the idempotency and referential-integrity rules every domain file
 * here follows, and `seed.ts` for how this is wired into the top-level
 * `seed()`.
 */

export interface StudioSeedCounts {
  readonly campaigns: number;
  readonly questions: number;
}

export async function seedStudio(pool: pg.Pool): Promise<StudioSeedCounts> {
  const campaigns = await seedCampaigns(pool);
  const questions = await seedQuestionBank(pool);
  return { campaigns, questions };
}

async function seedCampaigns(pool: pg.Pool): Promise<number> {
  let written = 0;
  for (const campaign of mockCampaigns) {
    const result = await pool.query(
      `INSERT INTO campaign.campaigns
         (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
          estimated_data_mb, reward_points, question_count, scoring_rule,
          lifecycle_state, published_at, business_id, region, audience, content_category,
          poster_url, teaser_url, hls_url, captions_url, aspect, estimated_bytes,
          starts_at, ends_at, open_viewing, teaser_start_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
       ON CONFLICT (id) DO NOTHING`,
      [
        campaign.id,
        campaign.kind,
        campaign.title,
        campaign.merchantId,
        campaign.merchantName,
        campaign.synopsis,
        campaign.durationSeconds,
        campaign.estimatedDataMb,
        campaign.rewardPoints,
        campaign.questionCount,
        campaign.scoringRule,
        // The mock's public `status` mapped back onto the authoring state it
        // must have come from (YT-0101). `campaign.campaigns.status` is gone:
        // the viewer-facing value is DERIVED from `lifecycle_state`, and
        // storing both would be two copies of one fact.
        lifecycleStateFor(campaign.status),
        campaign.publishedAt,
        campaign.businessId,
        campaign.region,
        campaign.audience,
        campaign.contentCategory,
        campaign.posterUrl,
        campaign.teaserUrl,
        campaign.hlsUrl,
        campaign.captionsUrl,
        campaign.aspect,
        campaign.estimatedBytes,
        campaign.startsAt,
        campaign.endsAt,
        campaign.openViewing,
        campaign.teaserStartSeconds,
      ],
    );
    written += result.rowCount ?? 0;
    await seedCampaignCreative(pool, campaign);
  }
  return written;
}

/**
 * A campaign's chapters and video source.
 *
 * Written alongside the campaign rather than in their own pass, and this is
 * not tidiness: `campaignSchema` requires BOTH, so a campaign row without
 * them cannot be parsed as a `Campaign` at all. YT-0548 found that every row
 * in this table was unparseable because the columns did not exist; storing
 * them and then not writing them would be the same bug with more scaffolding.
 * `seed.test.ts` reads one back through the schema, which is the only check
 * that actually proves it.
 */
async function seedCampaignCreative(pool: pg.Pool, campaign: Campaign): Promise<void> {
  // Version 1 of the terms, derived from the campaign's own fields (YT-0101).
  // Not optional scaffolding: `watch.session` carries a composite foreign key
  // to (campaign_id, terms_version), so a campaign with no terms row cannot
  // be watched at all. A seeded catalogue nobody can start a session against
  // would look complete and be useless.
  await pool.query(
    `INSERT INTO campaign.terms_version
       (campaign_id, version, reward_points, question_count, scoring_rule,
        duration_seconds, accuracy_bonus_points, effective_from)
     VALUES ($1, 1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (campaign_id, version) DO NOTHING`,
    [
      campaign.id,
      campaign.rewardPoints,
      campaign.questionCount,
      campaign.scoringRule,
      campaign.durationSeconds,
      // No `campaignRewardConfigSchema` row is seeded yet (that table is
      // still unwired end to end — see this file's INSERT list), so there is
      // no real accuracy-bonus figure to freeze here. Zero is the honest
      // placeholder rather than a guess: it never overstates what a viewer
      // is owed.
      0,
      campaign.publishedAt,
    ],
  );

  for (const [ordinal, chapter] of campaign.chapters.entries()) {
    await pool.query(
      `INSERT INTO campaign.chapter (campaign_id, ordinal, title, start_seconds, reward_weight)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [campaign.id, ordinal, chapter.title, chapter.startSeconds, chapter.rewardWeight],
    );
  }

  await pool.query(
    `INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
     VALUES ($1,$2,$3) ON CONFLICT (campaign_id) DO NOTHING`,
    [campaign.id, campaign.videoSource.kind, campaign.videoSource.manifestUrl],
  );
}

/**
 * The authoring state a published campaign must have been in. The inverse of
 * `publicStatusOf`, and the only direction a mock can be read in: a fixture
 * describes a campaign a viewer can see, so it was never a draft.
 */
function lifecycleStateFor(status: Campaign["status"]): string {
  switch (status) {
    case "active":
      return "live";
    case "paused":
      return "paused";
    case "ended":
      return "ended";
  }
}

/**
 * A question bank for every seeded campaign. YT-0122's unblock.
 *
 * `campaign.questionCount` has always been seeded — it is on the campaign
 * row and on `terms_version`, so the catalogue *claims* a question count —
 * and the three tables that would hold the questions were empty. A campaign
 * promising four questions with none in the bank is a campaign nobody can
 * complete, and it looks complete from the catalogue.
 *
 * ## Real rows, not a fake bank
 *
 * This writes to `campaign.question`, `campaign.question_option` and
 * `campaign.question_answer_key` — the actual tables, with the actual
 * constraints. It is deliberately NOT a code path that returns questions
 * when storage is empty: `env.schema.ts` records what the last such
 * fallback cost, when a missing `DATABASE_URL` silently selected in-memory
 * repositories and the entire backend ran without executing a line of SQL.
 * Seeding data is safe; branching on its absence is not.
 *
 * ## Why the answer key is a separate row, and stays that way here
 *
 * `question_answer_key` is its own table so a `SELECT *` on the question
 * cannot return the answer (YT-0102's schema note). Seeding respects that:
 * the key is inserted separately and nothing here joins the two.
 *
 * Idempotent, so `pnpm dev:seed` can be re-run and so a suite that clears
 * its own campaign's questions gets them back on the next seed.
 */
async function seedQuestionBank(pool: pg.Pool): Promise<number> {
  let written = 0;

  for (const campaign of mockCampaigns) {
    // THREE TIMES the number asked, not one each. `question-bank.ts` is
    // explicit about why: "with a bank the same size as the ask, every
    // viewer sees every question and a single leaked set covers the whole
    // campaign forever". A 1x bank makes YT-0122's per-user subset a subset
    // of one — every viewer gets the identical questions — and leaves
    // YT-0125's population-accuracy signal with no unknowing viewers to
    // measure against.
    //
    // The ask count is taken as the larger of the campaign's own
    // `questionCount` and `questionsAskedFor(duration)`, because the two
    // disagree and neither is obviously wrong: quick campaigns run 15-58s
    // and carry `questionCount` 0-2, while `questionsAskedFor` returns 0
    // below 300s. Seeding the larger keeps the 3x property true whichever
    // field turns out to be authoritative. That disagreement is a real
    // modelling question and not this seed's to settle.
    const asked = Math.max(campaign.questionCount, questionsAskedFor(campaign.durationSeconds));
    for (let index = 0; index < asked * BANK_MULTIPLE; index += 1) {
      const questionId = deterministicQuestionId(campaign.id, index);
      const isTrueFalse = index % 2 === 0;

      const inserted = await pool.query(
        `INSERT INTO campaign.question
           (id, campaign_id, type, prompt, timer_seconds, status, pii_screen, answerable_after_seconds)
         VALUES ($1, $2, $3, $4, 20, 'approved', 'clear', $5)
         ON CONFLICT (id) DO NOTHING`,
        [
          questionId,
          campaign.id,
          isTrueFalse ? "true_false" : "multiple_choice",
          `${campaign.title} — checkpoint ${String(index + 1)}: was this segment about ${campaign.merchantName}?`,
          // Spread evenly across the video so every question in the bank is
          // not eligible from second 0 — a fixed, deterministic function of
          // the question's own position rather than a random draw, so
          // re-seeding is still idempotent.
          Math.min(index * 60, Math.max(0, campaign.durationSeconds - 10)),
        ],
      );
      written += inserted.rowCount ?? 0;

      if (isTrueFalse) {
        await pool.query(
          `INSERT INTO campaign.question_answer_key (question_id, correct_answer)
           VALUES ($1, true) ON CONFLICT DO NOTHING`,
          [questionId],
        );
        continue;
      }

      // Four options, and the correct one is spread across all four
      // ordinals — a bank whose answer is always first would let a bot score
      // without reading anything, and would make YT-0122's option shuffling
      // untestable because every unshuffled order would still be correct.
      //
      // Derived from the question id rather than from `index`. `index % 4`
      // was the obvious choice and was wrong: multiple-choice questions only
      // occur at odd indices, and odd numbers mod 4 are only ever 1 or 3, so
      // the answer was never at ordinal 0 or 2. Measured, not assumed — the
      // distribution came back `1|16, 3|5`. A bank with two dead positions
      // is a bank a guesser beats at 50%, not 25%.
      const correctOrdinal = ordinalFromId(questionId);
      let correctOptionId = "";
      for (let ordinal = 0; ordinal < 4; ordinal += 1) {
        const optionId = deterministicOptionId(questionId, ordinal);
        if (ordinal === correctOrdinal) correctOptionId = optionId;
        await pool.query(
          `INSERT INTO campaign.question_option (id, question_id, label, ordinal)
           VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
          [optionId, questionId, `Option ${String.fromCharCode(65 + ordinal)}`, ordinal],
        );
      }
      await pool.query(
        `INSERT INTO campaign.question_answer_key (question_id, correct_option_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [questionId, correctOptionId],
      );
    }
  }

  return written;
}

/** A stable 0-3 drawn from the question's own id, so answers spread evenly. */
function ordinalFromId(questionId: string): number {
  const [firstByte = 0] = createHash("sha256").update(questionId).digest();
  return firstByte % 4;
}

/**
 * Stable ids derived from the campaign, so re-seeding updates the same rows
 * rather than accumulating a new bank on every run. A random uuid here would
 * make the seed non-idempotent and quietly grow the bank past the
 * `questionCount` the campaign advertises.
 */
function deterministicQuestionId(campaignId: string, index: number): string {
  return uuidFromParts(campaignId, `q${String(index)}`);
}

function deterministicOptionId(questionId: string, ordinal: number): string {
  return uuidFromParts(questionId, `o${String(ordinal)}`);
}

/** A v4-shaped uuid derived from a seed string, so it is stable across runs. */
function uuidFromParts(namespace: string, suffix: string): string {
  const digest = createHash("sha256").update(`${namespace}:${suffix}`).digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}
