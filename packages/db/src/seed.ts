import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { mockCampaigns } from "@yourtal/contracts/campaign/mock";
import { mockListings } from "@yourtal/contracts/listing/mock";
import { generateVouchers } from "@yourtal/contracts/voucher/mock";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { Listing } from "@yourtal/contracts/listing";
import type { Voucher } from "@yourtal/contracts/voucher";
import { toIdrMinorUnits } from "@yourtal/contracts/money";

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
}

export async function seed(pool: pg.Pool): Promise<SeedCounts> {
  const campaigns = await seedCampaigns(pool);
  const listings = await seedListings(pool);
  const vouchers = await seedVouchers(pool, mockListings);
  return { campaigns, listings, vouchers };
}

async function seedCampaigns(pool: pg.Pool): Promise<number> {
  let written = 0;
  for (const campaign of mockCampaigns) {
    const result = await pool.query(
      `INSERT INTO campaign.campaigns
         (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
          estimated_data_mb, reward_points, question_count, scoring_rule,
          lifecycle_state, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
        duration_seconds, effective_from)
     VALUES ($1, 1, $2, $3, $4, $5, $6)
     ON CONFLICT (campaign_id, version) DO NOTHING`,
    [
      campaign.id,
      campaign.rewardPoints,
      campaign.questionCount,
      campaign.scoringRule,
      campaign.durationSeconds,
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

async function seedListings(pool: pg.Pool): Promise<number> {
  let written = 0;
  for (const listing of mockListings) {
    const result = await pool.query(
      `INSERT INTO store.listings
         (id, merchant_id, merchant_name, title, description, category,
          face_value_idr, settlement_value_idr, price_in_points, stock_remaining,
          stock_total, transferable, partial_redemption_policy, minimum_spend_idr,
          expires_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO NOTHING`,
      [
        listing.id,
        listing.merchantId,
        listing.merchantName,
        listing.title,
        listing.description,
        listing.category,
        listing.faceValueIdr,
        listing.settlementValueIdr,
        listing.priceInPoints,
        listing.stockRemaining,
        listing.stockTotal,
        listing.transferable,
        listing.partialRedemptionPolicy,
        listing.minimumSpendIdr,
        listing.expiresAt,
        listing.status,
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
            face_value_idr, remaining_value_idr, partial_redemption_policy,
            minimum_spend_idr, transferable, state, void_reason, issued_at,
            expires_at, location_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (id) DO NOTHING`,
        [
          coherent.id,
          coherent.listingId,
          coherent.ownerId,
          coherent.merchantId,
          coherent.merchantName,
          coherent.title,
          coherent.faceValueIdr,
          coherent.remainingValueIdr,
          coherent.partialRedemptionPolicy,
          coherent.minimumSpendIdr,
          coherent.transferable,
          state,
          voidReason,
          coherent.issuedAt,
          coherent.expiresAt,
          coherent.location.id,
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
 * `remainingValueIdr` is clamped to the listing's face value because the
 * generator picked its remainder against a face value that no longer
 * applies, and `vouchers_remaining_within_face` would reject it — correctly.
 */
function againstListing(voucher: Voucher, listing: Listing): Voucher {
  // Through toIdrMinorUnits, not a bare Math.min: IdrMinorUnits is a Zod
  // branded type precisely so an arbitrary number cannot become a money
  // value without being parsed. The brand catching this is the brand
  // working, not an inconvenience to cast away.
  const remaining = toIdrMinorUnits(Math.min(voucher.remainingValueIdr, listing.faceValueIdr));

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
    faceValueIdr: listing.faceValueIdr,
    remainingValueIdr:
      listing.partialRedemptionPolicy === "balance_carrying" ? remaining : listing.faceValueIdr,
    partialRedemptionPolicy: listing.partialRedemptionPolicy,
    minimumSpendIdr: listing.minimumSpendIdr,
    transferable: listing.transferable,
  };
}

/** CLI entry point. Kept separate so tests can seed a pool they control. */
/**
 * DATABASE_URL from the environment, falling back to the repo's `.env`.
 *
 * The same fallback `scripts/atlas.mjs` has, and for the same reason: `pnpm`
 * does not load `.env`, so without this `pnpm dev:fresh` fails halfway —
 * migrations apply (the migration runner reads the file) and then the seed
 * cannot find a database. A documented command that works for two of its
 * three steps is worse than one that does not exist.
 */
function resolveDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL !== undefined) return process.env.DATABASE_URL;

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const envFile = path.join(repoRoot, ".env");
  if (!existsSync(envFile)) return undefined;

  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

async function main(): Promise<void> {
  const connectionString = resolveDatabaseUrl();
  if (connectionString === undefined) {
    console.error("No DATABASE_URL. Copy .env.example to .env and run `pnpm dev:up`.");
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString });
  try {
    const counts = await seed(pool);
    console.log(
      `Seeded ${String(counts.campaigns)} campaigns, ${String(counts.listings)} listings, ` +
        `${String(counts.vouchers)} vouchers. Re-running is a no-op; use \`pnpm dev:fresh\` for a clean slate.`,
    );
  } finally {
    await pool.end();
  }
}

// Only when run directly, so importing `seed` from a test does not connect.
if (process.argv[1]?.endsWith("seed.ts") === true) {
  await main();
}
