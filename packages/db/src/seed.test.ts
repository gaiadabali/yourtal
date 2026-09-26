import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { APP_URL, OWNER_URL } from "./database-urls";
import { seed } from "./seed";
import { campaignSchema } from "@yourtal/contracts/campaign";
import { mockCampaigns } from "@yourtal/contracts/campaign/mock";
import { publicStatusOf, type CampaignLifecycleState } from "@yourtal/contracts/campaign/lifecycle";

// The seed's own campaigns. Files beside this one insert probe campaigns of
// their own (no questions, no video) while it runs, which are not the seed's.
const seededCampaignIds = mockCampaigns.map((campaign) => campaign.id);

/**
 * YT-0519, against the real Postgres from `pnpm dev:up`.
 *
 * Two things are being tested and only one of them is the seed. The other is
 * that the catalogue migration's constraints actually hold — the same
 * argument as the ledger tests: `listings_settlement_within_face` is an
 * economic invariant, and "a service will not do that" is not enforcement.
 */

const { Pool } = pg;

/**
 * Fixtures are written as the OWNER, assertions run as the app.
 *
 * Seeding is administration. Since YT-0142 the app role can read a voucher
 * and not write one — the value path is split by role deliberately — so a
 * seed running as the app now lacks a grant it used to have. Widening the
 * app's grant to suit a fixture would undo the control; acquiring each
 * value-path role's grant in turn would break again the next time a role is
 * added. See `database-urls.ts`.
 */
let pool: pg.Pool;
let owner: pg.Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: APP_URL, max: 4 });
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
  await seed(owner);
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

async function count(sql: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql);
  return Number(rows[0]?.n ?? "0");
}

describe("the seed", () => {
  it("puts a catalogue in the database", async () => {
    expect(await count("SELECT COUNT(*)::text AS n FROM campaign.campaigns")).toBeGreaterThan(0);
    expect(await count("SELECT COUNT(*)::text AS n FROM store.listings")).toBeGreaterThan(0);
    expect(await count("SELECT COUNT(*)::text AS n FROM voucher.vouchers")).toBeGreaterThan(0);
  });

  it("is idempotent", async () => {
    // Deterministic generators plus ON CONFLICT DO NOTHING. A second run
    // writing rows would mean either the ids move between runs or the
    // catalogue doubles — both make a seeded stack useless to debug against.
    // The owner again: seeding is administration, and since YT-0142 the app
    // role cannot write a voucher. Re-seeding as the app would fail on the
    // grant rather than on idempotency, which is not what this asserts.
    // Seeded TWICE here, and only the second run is asserted. `beforeAll`
    // seeds too, but another suite sharing this database can delete rows
    // between then and now — `question-bank.test.ts` clears its campaign's
    // questions by design — and the re-insert that follows is the seed
    // working, not failing. Asserting the first call after `beforeAll` made
    // this test's result depend on which other file had run, which is
    // YT-0547 in miniature. Two calls inside the test answer the question
    // the test is actually asking: does seeding an already-seeded database
    // write anything?
    await seed(owner);
    // Counted between the two runs, not before the first: files beside this
    // one seed and delete too, and only the second run is the question.
    const before = await count("SELECT COUNT(*)::text AS n FROM store.listings");
    const again = await seed(owner);
    const after = await count("SELECT COUNT(*)::text AS n FROM store.listings");

    expect(again).toEqual({ campaigns: 0, listings: 0, vouchers: 0, questions: 0 });
    expect(after).toBe(before);
  });

  it("produces no voucher its listing could not have issued", async () => {
    // The reason the seed rebuilds vouchers rather than inserting what the
    // generator produced. A voucher whose merchant or face value disagrees
    // with its listing is a state no real flow can reach, and a day lost to
    // debugging one is a day lost to nothing.
    //
    // ## Scoped to `batch_id IS NULL`, which is exactly "seeded"
    //
    // This used to scan every voucher in the table, which was the same thing
    // while the seed was the only thing that ever wrote one. Since YT-0141
    // `services/voucher` mints from an approved BATCH, and a batch carries
    // its own face value, policy and expiry — deliberately, because the
    // terms of a voucher already issued must not change when somebody edits
    // the listing afterwards.
    //
    // So a minted voucher is not required to agree with its listing's
    // current columns, and scanning it here asserted a rule that does not
    // apply to it. The right scope is the rows this test is about.
    const incoherent = await count(`
      SELECT COUNT(*)::text AS n
        FROM voucher.vouchers v
        JOIN store.listings l ON l.id = v.listing_id
       WHERE v.batch_id IS NULL
         AND (v.merchant_id <> l.merchant_id
          OR v.face_value_minor <> l.face_value_minor
          OR v.partial_redemption_policy <> l.partial_redemption_policy)`);

    expect(incoherent).toBe(0);

    // And the scope is not vacuous. If the seed ever stopped producing
    // batch-less vouchers, the query above would pass by matching nothing —
    // which is the failure this whole file exists to catch, reproduced in
    // the fix for it.
    const seeded = await count(
      `SELECT COUNT(*)::text AS n FROM voucher.vouchers WHERE batch_id IS NULL`,
    );
    expect(seeded, "the coherence check scanned no rows").toBeGreaterThan(0);
  });
});

describe("the seeded question bank (YT-0122)", () => {
  it("gives every campaign a bank at least three times the questions asked", async () => {
    // Not "exactly `question_count`", which is what this test asserted first
    // and which would have locked in the defect it was meant to prevent.
    // `question-bank.ts` is explicit: "with a bank the same size as the ask,
    // every viewer sees every question and a single leaked set covers the
    // whole campaign forever". At 1x, YT-0122's per-user subset is a subset
    // of one and YT-0125's population-accuracy signal has no unknowing
    // viewers left to measure.
    //
    // The ask is the larger of `question_count` and the duration-derived
    // count, because those two disagree — quick campaigns run 15-58s with
    // `question_count` 0-2 while the duration rule returns 0 below 300s.
    // Asserting against the larger holds whichever is authoritative.
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM campaign.campaigns c
        WHERE c.id = ANY($1::uuid[])
          AND (SELECT count(*) FROM campaign.question q WHERE q.campaign_id = c.id)
              < 3 * greatest(c.question_count, least(c.duration_seconds / 300, 5))`,
      [seededCampaignIds],
    );
    expect(rows[0]?.count, "every bank must be at least 3x the questions asked").toBe("0");
  });

  it("spreads the correct answer across every option position", async () => {
    // Caught by measuring rather than by reading: the first version derived
    // the correct ordinal from the question's index, and multiple-choice
    // questions only occur at odd indices — odd numbers mod 4 are only ever
    // 1 or 3, so ordinals 0 and 2 were never correct. The distribution came
    // back `1|16, 3|5`. A bank with two dead positions is one a guesser beats
    // at 50% rather than 25%, and it would make YT-0122's option shuffling
    // untestable, because an unshuffled order would still score.
    const { rows } = await pool.query<{ ordinal: number }>(
      `SELECT DISTINCT o.ordinal
         FROM campaign.question_answer_key k
         JOIN campaign.question_option o ON o.id = k.correct_option_id`,
    );
    const used = new Set(rows.map((row) => row.ordinal));
    expect(used, "the correct answer must be able to sit at any position").toEqual(
      new Set([0, 1, 2, 3]),
    );
  });

  it("keeps the answer key out of the question row", async () => {
    // `question_answer_key` is its own table precisely so a `SELECT *` on a
    // question cannot return the answer. The seed must not undo that by
    // stashing it on the question — asserted against the live column list
    // rather than the migration, because the migration is what we would be
    // checking against ourselves.
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'campaign' AND table_name = 'question'`,
    );
    const columns = rows.map((row) => row.column_name);
    expect(columns).not.toContain("correct_answer");
    expect(columns).not.toContain("correct_option_id");
  });
});

describe("the catalogue constraints hold in Postgres", () => {
  const listing = (over: Record<string, unknown> = {}) => ({
    id: "00000000-0000-4000-8000-0000000000f1",
    merchant_id: "00000000-0000-4000-8000-0000000000f2",
    merchant_name: "Test Merchant",
    title: "T",
    description: "D",
    category: "food_beverage",
    currency: "IDR",
    face_value_minor: 50_000,
    settlement_value_minor: 30_000,
    price_in_points: 5_000,
    stock_remaining: 5,
    stock_total: 10,
    transferable: false,
    partial_redemption_policy: "single_use_forfeit",
    minimum_spend_minor: null,
    expires_at: "2027-01-01T00:00:00Z",
    status: "available",
    region: "ID",
    audience: "all_ages",
    content_category: "food-and-drink",
    image_url: "https://cdn.example.com/listing.jpg",
    channel: "in_store",
    partial_redemption: "single_use",
    ...over,
  });

  async function insertListing(row: Record<string, unknown>): Promise<void> {
    const keys = Object.keys(row);
    const placeholders = keys.map((_key, index) => `$${String(index + 1)}`).join(",");
    await pool.query(
      `INSERT INTO store.listings (${keys.join(",")}) VALUES (${placeholders})`,
      Object.values(row),
    );
  }

  it("REJECTS settlement above face value", async () => {
    // An economic invariant: settlement above face means the platform pays
    // out more than the voucher was ever worth, on every redemption,
    // silently. docs/09 §3.
    await expect(insertListing(listing({ settlement_value_minor: 60_000 }))).rejects.toThrow(
      /listings_settlement_within_face/,
    );
  });

  it("REJECTS stock remaining above the total", async () => {
    await expect(insertListing(listing({ stock_remaining: 11 }))).rejects.toThrow(
      /listings_stock_within_total/,
    );
  });

  it("REJECTS a sold_out listing that still has stock", async () => {
    await expect(
      insertListing(listing({ status: "sold_out", stock_remaining: 3 })),
    ).rejects.toThrow(/listings_sold_out_has_no_stock/);
  });

  it("REJECTS a minimum_spend policy with no threshold", async () => {
    await expect(
      insertListing(listing({ partial_redemption_policy: "minimum_spend" })),
    ).rejects.toThrow(/listings_minimum_spend_iff_policy/);
  });

  it("REJECTS a quick campaign longer than 60 seconds", async () => {
    // campaignSchema's refinement, which JSON Schema could not carry into
    // the OpenAPI document. Re-implemented where it cannot be bypassed.
    await expect(
      pool.query(
        `INSERT INTO campaign.campaigns
           (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
            estimated_data_mb, reward_points, question_count, scoring_rule, lifecycle_state, published_at,
            business_id, region, audience, content_category, poster_url, teaser_url, hls_url,
            aspect, estimated_bytes, starts_at, ends_at)
         VALUES ('00000000-0000-4000-8000-0000000000f3','quick','T',
                 '00000000-0000-4000-8000-0000000000f4','M','S',
                 120, 5, 100, 0, 'base_only', 'live', now(),
                 '00000000-0000-4000-8000-0000000000f4', 'ID', 'all_ages', 'food-and-drink',
                 'https://cdn.example.com/poster.jpg', 'https://cdn.example.com/teaser.mp4',
                 'https://cdn.example.com/hls.m3u8', '9:16', 1000000, now(), now() + interval '90 days')`,
      ),
    ).rejects.toThrow(/campaigns_quick_is_short/);
  });

  it("REJECTS an accuracy bonus with no questions to score", async () => {
    await expect(
      pool.query(
        `INSERT INTO campaign.campaigns
           (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
            estimated_data_mb, reward_points, question_count, scoring_rule, lifecycle_state, published_at,
            business_id, region, audience, content_category, poster_url, teaser_url, hls_url,
            aspect, estimated_bytes, starts_at, ends_at)
         VALUES ('00000000-0000-4000-8000-0000000000f5','long_form','T',
                 '00000000-0000-4000-8000-0000000000f6','M','S',
                 600, 50, 100, 0, 'base_plus_accuracy_bonus', 'live', now(),
                 '00000000-0000-4000-8000-0000000000f6', 'ID', 'all_ages', 'food-and-drink',
                 'https://cdn.example.com/poster.jpg', 'https://cdn.example.com/teaser.mp4',
                 'https://cdn.example.com/hls.m3u8', '16:9', 1000000, now(), now() + interval '90 days')`,
      ),
    ).rejects.toThrow(/campaigns_bonus_needs_questions/);
  });
});

describe("a voucher's branch must be one its listing offers (YT-0502)", () => {
  it("REJECTS a voucher pointing at a branch of a different listing", async () => {
    // The reason locations are tables rather than a jsonb column. A plain FK
    // to merchant_location would allow a voucher for listing L naming a
    // branch L does not serve — the customer is sent to a shop that has
    // never heard of the offer, and nothing objects. The composite FK makes
    // that unrepresentable.
    // The pair is SELECTED to be mismatched rather than assumed to be.
    // This used to take the first two link rows and assert they had
    // different listings, which held only while no listing happened to own
    // both of the first two rows — a merchant-roster change reordered the
    // catalogue and it failed, having found nothing wrong. The NOT EXISTS is
    // load-bearing too: two listings from one merchant can share a branch,
    // and such a location is one the listing DOES serve, so the constraint
    // would rightly accept it and the test would report a false negative.
    const { rows } = await pool.query<{ listing_id: string; location_id: string }>(
      `SELECT a.listing_id, b.location_id
         FROM store.listing_location a
         JOIN store.listing_location b ON b.listing_id <> a.listing_id
        WHERE NOT EXISTS (
                SELECT 1 FROM store.listing_location c
                 WHERE c.listing_id = a.listing_id
                   AND c.location_id = b.location_id)
        ORDER BY a.listing_id, b.location_id
        LIMIT 1`,
    );
    const pair = rows[0];
    expect(
      pair,
      "the seed should offer at least two listings with distinct branches",
    ).toBeDefined();
    const mine = { listing_id: pair?.listing_id };
    const someoneElses = { location_id: pair?.location_id };

    // As the OWNER: since YT-0142 the app role has no INSERT on vouchers, so
    // as the app this would be refused by a grant before the constraint ever
    // ran — and would pass while proving nothing about the constraint.
    await expect(
      owner.query(
        `INSERT INTO voucher.vouchers
           (id, listing_id, owner_id, merchant_id, merchant_name, title,
            face_value_minor, remaining_value_minor, partial_redemption_policy,
            minimum_spend_minor, transferable, state, issued_at, expires_at, location_id, currency, region)
         VALUES (gen_random_uuid(), $1, gen_random_uuid(),
                 gen_random_uuid(), 'M', 'T', 1000, 1000, 'single_use_forfeit',
                 NULL, false, 'active', now(), now() + interval '30 days', $2, 'IDR', 'ID')`,
        [mine?.listing_id, someoneElses?.location_id],
      ),
    ).rejects.toThrow(/vouchers_location_is_offered_by_its_listing/);
  });

  it("accepts a voucher at a branch its own listing offers", async () => {
    const { rows } = await pool.query<{ listing_id: string; location_id: string }>(
      `SELECT listing_id, location_id FROM store.listing_location LIMIT 1`,
    );
    const pair = rows[0];
    // A handle for the cleanup below. It used to be the voucher's code;
    // there is no code column any more (YT-0142 — codes live envelope-
    // encrypted in voucher.code_custody), so the id does the job.
    const probeId = "00000000-0000-4000-8000-0000000502cc";

    // Removed again at the end: this row exists to prove the constraint
    // accepts it, and it is deliberately NOT coherent with its listing in
    // the other fields. Leaving it behind would make the seed's own
    // coherence assertion fail on the next run — which it did, once, and
    // the coherence test is right to object.
    await expect(
      owner.query(
        `INSERT INTO voucher.vouchers
           (id, listing_id, owner_id, merchant_id, merchant_name, title,
            face_value_minor, remaining_value_minor, partial_redemption_policy,
            minimum_spend_minor, transferable, state, issued_at, expires_at, location_id, currency, region)
         VALUES ($3, $1, gen_random_uuid(),
                 gen_random_uuid(), 'M', 'T', 1000, 1000, 'single_use_forfeit',
                 NULL, false, 'active', now(), now() + interval '30 days', $2, 'IDR', 'ID')
         ON CONFLICT (id) DO NOTHING`,
        [pair?.listing_id, pair?.location_id, probeId],
      ),
    ).resolves.toBeDefined();

    await owner.query(`DELETE FROM voucher.vouchers WHERE id = $1`, [probeId]);
  });

  it("every seeded listing offers at least one branch", async () => {
    // listingSchema says `.min(1)`; a table cannot express "at least one
    // row", so that half of the invariant is asserted here against real data
    // rather than left to Zod alone.
    const orphaned = await count(`
      SELECT COUNT(*)::text AS n FROM store.listings l
       WHERE NOT EXISTS (SELECT 1 FROM store.listing_location ll WHERE ll.listing_id = l.id)`);

    expect(orphaned).toBe(0);
  });
});

describe("a seeded campaign can be read back as a Campaign (YT-0548)", () => {
  /**
   * The check that actually closes YT-0548.
   *
   * `campaignSchema` requires `chapters` and `videoSource`. Before YT-0101
   * neither had a column anywhere, so **every row in this table was
   * unparseable as a `Campaign`** — invisible only because Phase U reads
   * mocks, and a total outage of the watch flow the first time a real API
   * served one.
   *
   * Adding the tables was not enough: a seed that did not write them left
   * the same bug with more scaffolding. So this reassembles a campaign from
   * Postgres and runs it through the contract, which is the only assertion
   * that distinguishes "the columns exist" from "the database can produce a
   * valid campaign".
   */
  it("parses, with its chapters and video source", async () => {
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT c.*,
              (SELECT COALESCE(json_agg(json_build_object(
                        'title', ch.title,
                        'startSeconds', ch.start_seconds,
                        'rewardWeight', ch.reward_weight::float)
                      ORDER BY ch.ordinal), '[]'::json)
                 FROM campaign.chapter ch WHERE ch.campaign_id = c.id) AS chapters,
              (SELECT json_build_object('kind', vs.kind, 'manifestUrl', vs.manifest_url)
                 FROM campaign.video_source vs WHERE vs.campaign_id = c.id) AS video_source
         FROM campaign.campaigns c
        WHERE c.lifecycle_state = 'live' AND c.kind = 'long_form'
        LIMIT 1`,
    );

    const row = rows[0];
    expect(row, "the seed should have produced a live campaign").toBeDefined();

    const publicStatus = publicStatusOf(row?.["lifecycle_state"] as CampaignLifecycleState);
    const parsed = campaignSchema.safeParse({
      id: row?.["id"],
      kind: row?.["kind"],
      title: row?.["title"],
      merchantId: row?.["merchant_id"],
      merchantName: row?.["merchant_name"],
      synopsis: row?.["synopsis"],
      durationSeconds: row?.["duration_seconds"],
      estimatedDataMb: Number(row?.["estimated_data_mb"]),
      rewardPoints: Number(row?.["reward_points"]),
      questionCount: row?.["question_count"],
      scoringRule: row?.["scoring_rule"],
      // Derived, never stored — see the migration's note on dropping `status`.
      status: publicStatus,
      publishedAt: (row?.["published_at"] as Date).toISOString(),
      chapters: row?.["chapters"],
      videoSource: row?.["video_source"],
      businessId: row?.["business_id"],
      region: row?.["region"],
      audience: row?.["audience"],
      contentCategory: row?.["content_category"],
      posterUrl: row?.["poster_url"],
      teaserUrl: row?.["teaser_url"],
      hlsUrl: row?.["hls_url"],
      captionsUrl: row?.["captions_url"],
      aspect: row?.["aspect"],
      estimatedBytes: Number(row?.["estimated_bytes"]),
      startsAt: (row?.["starts_at"] as Date).toISOString(),
      endsAt: (row?.["ends_at"] as Date).toISOString(),
      openViewing: row?.["open_viewing"],
      teaserStartSeconds: row?.["teaser_start_seconds"],
    });

    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues, null, 2)).toBe(
      true,
    );
  });

  it("gives every campaign a video source, and chapters only where they belong", async () => {
    // One parsing campaign does not prove the catalogue is coherent. A
    // campaign with no video is one nobody can watch, and the failure would
    // surface as an empty player rather than as a seed error.
    //
    // Chapters are asserted BY KIND rather than universally. A quick
    // campaign having none is not an accident to code around: sixty seconds
    // has nowhere to navigate, and `campaignSchema` now states that in both
    // directions rather than permitting an empty array by omission.
    const wrong = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM campaign.campaigns c
        WHERE c.id = ANY($1::uuid[])
          AND (NOT EXISTS (SELECT 1 FROM campaign.video_source v WHERE v.campaign_id = c.id)
           OR (c.kind = 'long_form'
               AND NOT EXISTS (SELECT 1 FROM campaign.chapter ch WHERE ch.campaign_id = c.id))
           OR (c.kind = 'quick'
               AND EXISTS (SELECT 1 FROM campaign.chapter ch WHERE ch.campaign_id = c.id)))`,
      [seededCampaignIds],
    );
    expect(Number(wrong.rows[0]?.n ?? "1")).toBe(0);
  });
});
