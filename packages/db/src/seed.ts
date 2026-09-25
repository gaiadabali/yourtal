import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { mockCampaigns } from "@yourtal/contracts/campaign/mock";
import { BANK_MULTIPLE, questionsAskedFor } from "@yourtal/contracts/question/bank";
import { mockListings } from "@yourtal/contracts/listing/mock";
import { generateVouchers } from "@yourtal/contracts/voucher/mock";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { Listing } from "@yourtal/contracts/listing";
import type { Voucher } from "@yourtal/contracts/voucher";
import { toMinorUnits } from "@yourtal/contracts/money";

/**
 * Seeds the local database from the same mock generators Phase U renders.
 * YT-0519.
 *
 *   pnpm --filter @yourtal/db seed
 *
 * The point is not test data for its own sake. Phase U has been proving its
 * surfaces against in-process fixtures, which cannot fail the way a database
 * fails — no foreign keys, no check constraints, no round trip through
 * Postgres types. Seeding the real stack turns "works against fixtures" into
 * "works against the stack", and this batch already showed what lives in
 * that gap: a policy that was correct and unreachable, found only by a real
 * request.
 *
 * ## Mock generators produce independent objects; a database has referential
 * ## integrity, and that difference is the whole job
 *
 * `generateVoucher` invents a `listingId`, a `merchantId` and a face value
 * with no relation to any listing, because nothing in a fixture requires
 * them to agree. Inserted as-is they would violate the foreign key — and if
 * they somehow did not, they would be worse: a voucher for listing L issued
 * by a different merchant, at a face value the listing never offered, is
 * data that no real flow could ever produce. A seeded stack that contains
 * impossible states teaches you nothing, and wastes a day the first time
 * someone debugs against one.
 *
 * So vouchers here are DERIVED from the listings that were actually
 * inserted, inheriting listing id, merchant, title, face value, redemption
 * policy and — since YT-0502 — one of that listing's own branches. Only the
 * parts that are genuinely the voucher's own (code, owner, issue, expiry)
 * come from the generator.
 *
 * The branch is not optional cosmetics: the database enforces that a
 * voucher's location is one its listing actually offers, so a generated
 * location would be rejected rather than merely odd.
 *
 * ## Idempotent, by primary key — but only for a FIXED contract
 *
 * `ON CONFLICT DO NOTHING`, and the generators are seeded, so ids are stable
 * across runs and re-seeding is a no-op.
 *
 * **That guarantee ends the moment a schema gains a field.** The generators
 * draw from a seeded faker in field order, so adding one property shifts
 * every draw after it — and every id downstream changes. Re-seeding then
 * inserts a whole SECOND catalogue beside the first, because the new ids
 * conflict with nothing. Observed exactly once, when YT-0502 added
 * `locations` to the listing: 30 listings became 60, half of them orphaned
 * from the locations that could only link to the new ids.
 *
 * It looks like idempotency failing and it is not — it is idempotency
 * working on data that is no longer the same data. The keys really are new.
 *
 * So: **after any contract change, `pnpm dev:fresh`, not `pnpm db:seed`.**
 * Seeded data is disposable by design; treating it as durable is what makes
 * this bite. `seed.test.ts` asserts no listing is left without locations,
 * which is the shape this failure takes and the reason it was caught.
 */

const { Pool } = pg;

/** Enough to populate a board and a store without being unreadable in psql. */
const VOUCHERS_PER_LISTING = 2;
const VOUCHER_SEED_BASE = 90_000;

/** Fixed, so seeded vouchers always belong to the same demo user. */
const DEMO_USER_ID = "11111111-1111-4111-8111-111111111111";

export interface SeedCounts {
  readonly campaigns: number;
  readonly listings: number;
  readonly vouchers: number;
  readonly questions: number;
}

export async function seed(pool: pg.Pool): Promise<SeedCounts> {
  const campaigns = await seedCampaigns(pool);
  const listings = await seedListings(pool);
  const vouchers = await seedVouchers(pool, mockListings);
  const questions = await seedQuestionBank(pool);
  return { campaigns, listings, vouchers, questions };
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

async function seedListings(pool: pg.Pool): Promise<number> {
  let written = 0;
  for (const listing of mockListings) {
    const result = await pool.query(
      `INSERT INTO store.listings
         (id, merchant_id, merchant_name, title, description, category,
          face_value_minor, settlement_value_minor, price_in_points, stock_remaining,
          stock_total, transferable, partial_redemption_policy, minimum_spend_minor,
          expires_at, status, currency, region, audience, content_category, image_url,
          channel, partial_redemption)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       ON CONFLICT (id) DO NOTHING`,
      [
        listing.id,
        listing.merchantId,
        listing.merchantName,
        listing.title,
        listing.description,
        listing.category,
        listing.faceValueMinor,
        listing.settlementValueMinor,
        listing.priceInPoints,
        listing.stockRemaining,
        listing.stockTotal,
        listing.transferable,
        listing.partialRedemptionPolicy,
        listing.minimumSpendMinor,
        listing.expiresAt,
        listing.status,
        listing.currency,
        listing.region,
        listing.audience,
        listing.contentCategory,
        listing.imageUrl,
        listing.channel,
        listing.partialRedemption,
      ],
    );
    written += result.rowCount ?? 0;
    await seedLocations(pool, listing);
  }
  return written;
}

/**
 * A listing's branches, and the link rows that say which listing offers
 * which. Written alongside the listing rather than in their own pass,
 * because a listing without its locations violates `listingSchema`'s
 * `.min(1)` and a voucher against it could not satisfy the composite foreign
 * key — a half-seeded catalogue is one nothing can be issued from.
 */
async function seedLocations(pool: pg.Pool, listing: Listing): Promise<void> {
  for (const location of listing.locations) {
    await pool.query(
      `INSERT INTO store.merchant_location (id, merchant_id, name, address, district)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      [location.id, listing.merchantId, location.name, location.address, location.district],
    );
    await pool.query(
      `INSERT INTO store.listing_location (listing_id, location_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [listing.id, location.id],
    );
  }
}

async function seedVouchers(pool: pg.Pool, listings: readonly Listing[]): Promise<number> {
  let written = 0;

  for (const [index, listing] of listings.entries()) {
    const generated = generateVouchers(
      VOUCHERS_PER_LISTING,
      VOUCHER_SEED_BASE + index * VOUCHERS_PER_LISTING,
    );

    for (const voucher of generated) {
      const coherent = againstListing(voucher, listing);
      const [state, voidReason] = internalStateOf(coherent.status);
      const result = await pool.query(
        `INSERT INTO voucher.vouchers
           (id, listing_id, owner_id, merchant_id, merchant_name, title,
            face_value_minor, remaining_value_minor, partial_redemption_policy,
            minimum_spend_minor, transferable, state, void_reason, issued_at,
            expires_at, location_id, currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (id) DO NOTHING`,
        [
          coherent.id,
          coherent.listingId,
          coherent.ownerId,
          coherent.merchantId,
          coherent.merchantName,
          coherent.title,
          coherent.faceValueMinor,
          coherent.remainingValueMinor,
          coherent.partialRedemptionPolicy,
          coherent.minimumSpendMinor,
          coherent.transferable,
          state,
          voidReason,
          coherent.issuedAt,
          coherent.expiresAt,
          coherent.location.id,
          coherent.currency,
        ],
      );
      written += result.rowCount ?? 0;
    }
  }
  return written;
}

/**
 * The inverse of `publicVoucherStatusOf` (YT-0142), for seeding only.
 *
 * The mock generators produce the WALLET-facing status, because that is what
 * the Phase U surfaces consume. The table stores the internal lifecycle, so
 * the seed has to go backwards — and the mapping is not one-to-one, which is
 * the whole reason the two enums exist: `transferred` is not a state, it is
 * `voided` carrying the reason `transfer`.
 *
 * Deliberately exhaustive over the public statuses with no `default` branch,
 * so adding a fifth one is a type error here rather than a row that quietly
 * seeds as `voided`.
 *
 * ## What the seed cannot produce
 *
 * No `voucher.code_custody` row, so **a seeded voucher cannot be redeemed at
 * a till**. The custody row needs envelope encryption from the voucher
 * service's keyring, and `yourtal_app` has no grant on that table anyway —
 * by design, since a store service that could write custody could mint
 * itself a voucher. Seeded vouchers exist so the wallet has something to
 * render; minting a redeemable one is `services/voucher`'s job.
 */
function internalStateOf(status: Voucher["status"]): [string, string | null] {
  switch (status) {
    case "active":
      return ["active", null];
    case "redeemed":
      return ["redeemed", null];
    case "expired":
      return ["expired", null];
    case "transferred":
      return ["voided", "transfer"];
  }
}

/**
 * Rebuilds a generated voucher so it is one the listing could actually have
 * produced. Everything the listing decides comes from the listing; only the
 * voucher's own identity and lifecycle stay generated.
 *
 * `remainingValueMinor` is clamped to the listing's face value because the
 * generator picked its remainder against a face value that no longer
 * applies, and `vouchers_remaining_within_face` would reject it — correctly.
 */
function againstListing(voucher: Voucher, listing: Listing): Voucher {
  // Through toMinorUnits, not a bare Math.min: MinorUnits is a Zod
  // branded type precisely so an arbitrary number cannot become a money
  // value without being parsed. The brand catching this is the brand
  // working, not an inconvenience to cast away.
  const remaining = toMinorUnits(Math.min(voucher.remainingValueMinor, listing.faceValueMinor));

  // The listing's first branch. Any of them would satisfy the composite
  // foreign key; taking the first keeps the seed deterministic.
  const location = listing.locations[0];
  if (location === undefined) {
    throw new Error(`listing ${listing.id} has no locations, so no voucher can be issued`);
  }

  return {
    ...voucher,
    listingId: listing.id,
    location,
    ownerId: DEMO_USER_ID,
    merchantId: listing.merchantId,
    merchantName: listing.merchantName,
    title: listing.title,
    currency: listing.currency,
    faceValueMinor: listing.faceValueMinor,
    remainingValueMinor:
      listing.partialRedemptionPolicy === "balance_carrying" ? remaining : listing.faceValueMinor,
    partialRedemptionPolicy: listing.partialRedemptionPolicy,
    minimumSpendMinor: listing.minimumSpendMinor,
    transferable: listing.transferable,
  };
}

/** CLI entry point. Kept separate so tests can seed a pool they control. */
/**
 * DATABASE_OWNER_URL from the environment, falling back to the repo's `.env`.
 *
 * The same fallback `scripts/atlas.mjs` has, and for the same reason: `pnpm`
 * does not load `.env`, so without this `pnpm dev:fresh` fails halfway —
 * migrations apply (the migration runner reads the file) and then the seed
 * cannot find a database. A documented command that works for two of its
 * three steps is worse than one that does not exist.
 *
 * The OWNER credential, not the app's. Seeding is administration: since
 * YT-0142 the app role can read a voucher and not write one, so a seed
 * running as the app fails on the first voucher. Widening that grant to suit
 * a fixture would undo a control that exists because voucher issuance is the
 * value path — see `database-urls.ts`.
 */
function resolveDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_OWNER_URL !== undefined) return process.env.DATABASE_OWNER_URL;

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const envFile = path.join(repoRoot, ".env");
  if (!existsSync(envFile)) return undefined;

  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*DATABASE_OWNER_URL\s*=\s*(.+?)\s*$/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

async function main(): Promise<void> {
  const connectionString = resolveDatabaseUrl();
  if (connectionString === undefined) {
    console.error(
      "No DATABASE_OWNER_URL. The seed writes fixtures as the owner, not as the app role. " +
        "Copy .env.example to .env and run `pnpm dev:up`.",
    );
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString });
  try {
    const counts = await seed(pool);
    console.log(
      `Seeded ${String(counts.campaigns)} campaigns, ${String(counts.listings)} listings, ` +
        `${String(counts.vouchers)} vouchers, ${String(counts.questions)} questions. ` +
        `Re-running is a no-op; use \`pnpm dev:fresh\` for a clean slate.`,
    );
  } finally {
    await pool.end();
  }
}

// Only when run directly, so importing `seed` from a test does not connect.
if (process.argv[1]?.endsWith("seed.ts") === true) {
  await main();
}
