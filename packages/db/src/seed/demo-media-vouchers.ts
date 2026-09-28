import { randomUUID } from "node:crypto";
import type pg from "pg";
import { listingSchema } from "@yourtal/contracts/listing";
import type { Listing, ListingCategory } from "@yourtal/contracts/listing";
import type { ContentCategory } from "@yourtal/jurisdiction/content-category";
import { toMinorUnits } from "@yourtal/contracts/money";
import {
  approveBatchRequestSchema,
  batchSchema,
  requestBatchRequestSchema,
} from "@yourtal/contracts/voucher-internal/batches";
import type {
  ApproveBatchRequest,
  RequestBatchRequest,
} from "@yourtal/contracts/voucher-internal/batches";
import { stableId } from "@yourtal/media/demo-media";
import type { DemoMediaBusiness } from "@yourtal/media/demo-media";
import { existingListingFacts, insertListing, postSigned, priceListing } from "./staging";
import type { StagingLedgerConfig, StagingVoucherConfig } from "./staging";

/**
 * TASKS.md 7.2.e's own half this file fills in: each of `runDemoMedia`'s 16
 * businesses (8 AU + 8 ID, `packages/media/src/demo-media.ts`) gets one
 * store listing plus 6 real vouchers, minted through the SAME real ledger
 * pricing + voucher-service batch/approve path `staging.ts`'s own single
 * demo voucher already uses — never `seed/store.ts`'s mock generator, which
 * has no `voucher.code_custody` row (see `ensureDemoVoucher`'s own header).
 *
 * Region and currency come from each business's own region (AU -> AUD,
 * ID -> IDR, the same mapping `demo-media.ts`'s own `ensureBusiness` uses),
 * never chosen independently — the same F2 rule `buildDemoListing` already
 * follows for the single 2.3.c demo listing.
 *
 * Idempotent per business: a listing already priced is left alone (its own
 * face/settlement/policy read back off the row, same as `ensureDemoVoucher`),
 * and a listing already holding 6+ vouchers mints nothing further. Never
 * fails the deploy on its own — see `runDemoMediaVouchers`'s own header,
 * same reasoning `main-staging.ts` already applies to `runDemoMedia` itself:
 * this depends on the voucher service and the ledger, both real hops a
 * transient failure in one of 16 cosmetic listings must not hold hostage.
 */

const VOUCHERS_PER_LISTING = 6;
const STOCK_TOTAL = 20;

interface RegionMoney {
  readonly currency: "AUD" | "IDR";
  readonly faceValueMinor: number;
  readonly settlementValueMinor: number;
}

/** AUD exponent 2 (cents), IDR exponent 0 (whole Rupiah) — F2/CLAUDE.md's own
 * money rule. Modest, clearly-demo amounts, the same spirit as `staging.ts`'s
 * own `DEMO_FACE_VALUE_MINOR`/`DEMO_SETTLEMENT_VALUE_MINOR`. */
function regionMoney(region: "AU" | "ID"): RegionMoney {
  return region === "AU"
    ? { currency: "AUD", faceValueMinor: 3_000, settlementValueMinor: 2_000 }
    : { currency: "IDR", faceValueMinor: 50_000, settlementValueMinor: 35_000 };
}

/** A light, defensible category pairing per brand — demo data, not a real
 * merchant's own catalogue submission, so this is a lookup rather than
 * anything the manifest itself needs to carry. */
const CATEGORY_BY_SLUG: Readonly<
  Record<string, { readonly category: ListingCategory; readonly contentCategory: ContentCategory }>
> = {
  "au-southern-cross-coffee": { category: "food_beverage", contentCategory: "food-and-drink" },
  "au-outback-trail-gear": { category: "merchandise", contentCategory: "travel" },
  "au-bondi-board-co": { category: "merchandise", contentCategory: "fitness" },
  "au-melbourne-bicycle-works": { category: "merchandise", contentCategory: "fitness" },
  "au-perth-power-tools": { category: "retail", contentCategory: "home" },
  "au-sydney-skyline-tours": { category: "services", contentCategory: "travel" },
  "au-adelaide-artisan-bakery": { category: "food_beverage", contentCategory: "food-and-drink" },
  "au-tasmania-wool-co": { category: "retail", contentCategory: "fashion" },
  "id-kopi-nusantara": { category: "food_beverage", contentCategory: "food-and-drink" },
  "id-jakarta-jaya-motor": { category: "services", contentCategory: "transport" },
  "id-bali-batik-house": { category: "retail", contentCategory: "fashion" },
  "id-surabaya-snack-co": { category: "food_beverage", contentCategory: "food-and-drink" },
  "id-bandung-boba-bar": { category: "food_beverage", contentCategory: "food-and-drink" },
  "id-yogyakarta-textiles": { category: "retail", contentCategory: "fashion" },
  "id-medan-spice-traders": { category: "food_beverage", contentCategory: "food-and-drink" },
  "id-makassar-marine-gear": { category: "merchandise", contentCategory: "travel" },
};

function categoryFor(slug: string): {
  category: ListingCategory;
  contentCategory: ContentCategory;
} {
  return CATEGORY_BY_SLUG[slug] ?? { category: "retail", contentCategory: "services" };
}

export interface DemoMediaVoucherResult {
  readonly slug: string;
  readonly status: "seeded" | "already_present" | "failed";
  readonly detail?: string;
}

async function existingVoucherCount(pool: pg.Pool, listingId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM voucher.vouchers WHERE listing_id = $1",
    [listingId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

function buildListing(params: {
  listingId: string;
  business: DemoMediaBusiness;
  money: RegionMoney;
  pricePoints: number;
}): Listing {
  const { listingId, business, money, pricePoints } = params;
  const { category, contentCategory } = categoryFor(business.slug);
  const locationId = stableId(`demo-media:location:${business.slug}`);
  const district = business.region === "AU" ? "Sydney" : "Jakarta";
  const address =
    business.region === "AU"
      ? `${business.brand}, NSW, Australia`
      : `${business.brand}, Jakarta, Indonesia`;

  return listingSchema.parse({
    id: listingId,
    merchantId: business.businessId,
    merchantName: business.brand,
    title: `${business.brand} — Demo Voucher`,
    description: `A demonstration voucher for ${business.brand}, seeded by pnpm demo:media (7.2.e).`,
    category,
    locations: [{ id: locationId, name: `${business.brand} — Demo Outlet`, address, district }],
    currency: money.currency,
    faceValueMinor: toMinorUnits(money.faceValueMinor),
    settlementValueMinor: toMinorUnits(money.settlementValueMinor),
    priceInPoints: pricePoints,
    stockRemaining: STOCK_TOTAL,
    stockTotal: STOCK_TOTAL,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    minimumSpendMinor: null,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    status: "available",
    region: business.region,
    audience: "all_ages",
    contentCategory,
    imageUrl: "http://127.0.0.1:26900/yourtal-media/listings/demo-media-placeholder.jpg",
    channel: "in_store",
    partialRedemption: "single_use",
  });
}

async function ensureOneBusiness(
  pool: pg.Pool,
  ledger: StagingLedgerConfig,
  voucher: StagingVoucherConfig,
  business: DemoMediaBusiness,
  log: (message: string) => void,
): Promise<DemoMediaVoucherResult> {
  const listingId = stableId(`demo-media:listing:${business.slug}`);

  if ((await existingVoucherCount(pool, listingId)) >= VOUCHERS_PER_LISTING) {
    return { slug: business.slug, status: "already_present" };
  }

  const money = regionMoney(business.region);
  let listingFacts = await existingListingFacts(pool, listingId);
  if (listingFacts === null) {
    const priced = await priceListing(ledger, {
      listingId,
      region: business.region,
      currency: money.currency,
      settlementMinor: money.settlementValueMinor,
    });
    if (!priced.ok) {
      const detail = `ledger /v1/pricing/listing answered an error: ${priced.detail}`;
      log(`[demo:media:voucher] ${business.slug}: ${detail}`);
      return { slug: business.slug, status: "failed", detail };
    }
    const listing = buildListing({ listingId, business, money, pricePoints: priced.pricePoints });
    await insertListing(pool, listing);
    listingFacts = {
      faceValueMinor: listing.faceValueMinor,
      settlementValueMinor: listing.settlementValueMinor,
      currency: listing.currency,
      partialRedemptionPolicy: listing.partialRedemptionPolicy,
    };
  }

  const requestBatchBody: RequestBatchRequest = requestBatchRequestSchema.parse({
    listingId,
    merchantId: business.businessId,
    currency: listingFacts.currency,
    faceValueMinor: listingFacts.faceValueMinor,
    quantity: VOUCHERS_PER_LISTING,
    partialRedemptionPolicy: listingFacts.partialRedemptionPolicy,
    requestedBy: `demo-media-seed-requester-${randomUUID()}`,
  });
  const requested = await postSigned(voucher, "/internal/v1/batches", requestBatchBody);
  if (!requested.ok) {
    const detail = `voucher /internal/v1/batches answered an error: ${requested.detail}`;
    log(`[demo:media:voucher] ${business.slug}: ${detail}`);
    return { slug: business.slug, status: "failed", detail };
  }
  const requestedBatch = batchSchema.safeParse(requested.body);
  if (!requestedBatch.success) {
    const detail = `unexpected /internal/v1/batches response: ${requestedBatch.error.message}`;
    log(`[demo:media:voucher] ${business.slug}: ${detail}`);
    return { slug: business.slug, status: "failed", detail };
  }

  // A different approver than requester — Minter.Approve rejects self-approval
  // (same two-person rule `ensureDemoVoucher` already documents).
  const approveBody: ApproveBatchRequest = approveBatchRequestSchema.parse({
    batchId: requestedBatch.data.batchId,
    approvedBy: `demo-media-seed-approver-${randomUUID()}`,
  });
  const approved = await postSigned(voucher, "/internal/v1/batches/approve", approveBody);
  if (!approved.ok) {
    const detail = `voucher /internal/v1/batches/approve answered an error: ${approved.detail}`;
    log(`[demo:media:voucher] ${business.slug}: ${detail}`);
    return { slug: business.slug, status: "failed", detail };
  }

  // Approval can 200 without actually minting — the only trustworthy
  // confirmation is a real row (same check `ensureDemoVoucher` makes).
  if ((await existingVoucherCount(pool, listingId)) < VOUCHERS_PER_LISTING) {
    const detail = "batches/approve answered 200 but fewer than 6 voucher.vouchers rows exist";
    log(`[demo:media:voucher] ${business.slug}: ${detail}`);
    return { slug: business.slug, status: "failed", detail };
  }
  log(
    `[demo:media:voucher] ${business.slug}: listing ${listingId}, ${VOUCHERS_PER_LISTING} vouchers minted`,
  );
  return { slug: business.slug, status: "seeded" };
}

/**
 * Never throws: every per-business failure is caught and reported as a
 * `"failed"` result, the same convention `runDemoMedia` itself uses — see
 * this file's own header for why (the ledger/voucher hop is real, and one
 * bad listing must not stop the other 15).
 */
export async function runDemoMediaVouchers(
  pool: pg.Pool,
  businesses: readonly DemoMediaBusiness[],
  ledger: StagingLedgerConfig,
  voucher: StagingVoucherConfig,
  log: (message: string) => void,
): Promise<readonly DemoMediaVoucherResult[]> {
  const results: DemoMediaVoucherResult[] = [];
  for (const business of businesses) {
    try {
      results.push(await ensureOneBusiness(pool, ledger, voucher, business, log));
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      log(`[demo:media:voucher] ${business.slug} threw rather than returning a result: ${detail}`);
      results.push({ slug: business.slug, status: "failed", detail });
    }
  }
  return results;
}
