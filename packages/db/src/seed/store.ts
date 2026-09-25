import type pg from "pg";
import { mockListings } from "@yourtal/contracts/listing/mock";
import { generateVouchers } from "@yourtal/contracts/voucher/mock";
import type { Listing } from "@yourtal/contracts/listing";
import type { Voucher } from "@yourtal/contracts/voucher";
import { toMinorUnits } from "@yourtal/contracts/money";

/**
 * The store's own domain: listings, their branches, and the vouchers that
 * demonstrate them. 1.3.b split this out of the old single `seed.ts` — see
 * that file's header for the idempotency and referential-integrity rules
 * every domain file here follows, and `seed.ts` for how this is wired into
 * the top-level `seed()`.
 */

/** Enough to populate a board and a store without being unreadable in psql. */
const VOUCHERS_PER_LISTING = 2;
const VOUCHER_SEED_BASE = 90_000;

/** Fixed, so seeded vouchers always belong to the same demo user. */
const DEMO_USER_ID = "11111111-1111-4111-8111-111111111111";

export interface StoreSeedCounts {
  readonly listings: number;
  readonly vouchers: number;
}

export async function seedStore(pool: pg.Pool): Promise<StoreSeedCounts> {
  const listings = await seedListings(pool);
  const vouchers = await seedVouchers(pool, mockListings);
  return { listings, vouchers };
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
            expires_at, location_id, currency, region)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
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
          // 4.5.e: a voucher carries its own region, denormalised from the
          // listing at mint time in the real engine — the seed mirrors that.
          listing.region,
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
