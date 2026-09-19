import type { Listing } from "../listing/listing";
import { listingSchema } from "../listing/listing";
import type { Campaign } from "../campaign/campaign";
import { campaignSchema } from "../campaign/campaign";
import type { Voucher } from "../voucher/voucher";
import { voucherSchema } from "../voucher/voucher";
import { DEFAULT_REFERENCE_INSTANT, addDays, addMinutes, toIsoString } from "../internal/clock";
import { createSeededFaker } from "../internal/seeded-faker";
import {
  LONG_MERCHANT_NAME_AU,
  generateCampaignSynopsisAu,
  generateCampaignTitleAu,
  generateMerchantNameAu,
  pickSuburb,
} from "../internal/sydney";
import { pointsPriceFromSettlement, toIdrMinorUnits, toPoints } from "../money/money";

/**
 * AU counterpart to `listing.mock.ts` / `campaign.mock.ts` / `voucher.mock.ts`
 * — same generator shape, Sydney flavour, AUD-cents scale amounts. Not
 * exported from the package (no subpath for it): `region.mock.ts` is the
 * public surface, this is its AU half, kept separate only to stay under the
 * 300-line file limit.
 *
 * A known, deliberate wart: `faceValueIdr` etc. are IDR-branded fields
 * (`listing.ts`/`campaign.ts`/`voucher.ts` have no currency-tagged Money
 * type yet — see money.ts's header and the architect note in
 * docs/tasks/phase-u-ui.md YT-0405). These AU fixtures store an amount in
 * AUD **cents** in those same fields; `formatMoney(amount, "AUD")` is what
 * makes that render correctly (divides by 100), never `formatIdr`. Fixing
 * the field name itself is a contract change (a currency-tagged Money type,
 * docs/12 section 3) out of scope for this ticket.
 */

// AUD cents per point. Illustrative only, like the IDR mock rate in
// listing.mock.ts — not the real pricing engine.
const MOCK_BACKING_RATE_AUD_CENTS_PER_POINT = 3;

function auListingFrom(faker: ReturnType<typeof createSeededFaker>, now: Date): Listing {
  const merchantName = generateMerchantNameAu(faker);
  const faceValueCents = toIdrMinorUnits(faker.number.int({ min: 1_000, max: 40_000 })); // $10.00–$400.00
  const settlementValueCents = toIdrMinorUnits(Math.round(faceValueCents * 0.3));
  const stockTotal = faker.number.int({ min: 5, max: 500 });
  const stockRemaining = faker.number.int({ min: 0, max: stockTotal });
  const status =
    stockRemaining === 0
      ? "sold_out"
      : faker.helpers.arrayElement(["available", "available", "expiring_soon", "new"] as const);
  const partialRedemptionPolicy = faker.helpers.arrayElement([
    "balance_carrying",
    "single_use_forfeit",
    "minimum_spend",
  ] as const);

  return listingSchema.parse({
    id: faker.string.uuid(),
    merchantId: faker.string.uuid(),
    merchantName,
    title: `Voucher — ${merchantName}`,
    description: `Enjoy a special offer from ${merchantName}, valid at selected locations.`,
    category: faker.helpers.arrayElement([
      "food_beverage",
      "retail",
      "digital_goods",
      "merchandise",
      "services",
    ] as const),
    district: pickSuburb(faker),
    faceValueIdr: faceValueCents,
    settlementValueIdr: settlementValueCents,
    priceInPoints: pointsPriceFromSettlement(
      settlementValueCents,
      MOCK_BACKING_RATE_AUD_CENTS_PER_POINT,
    ),
    stockRemaining,
    stockTotal,
    transferable: faker.datatype.boolean({ probability: 0.4 }),
    partialRedemptionPolicy,
    minimumSpendIdr:
      partialRedemptionPolicy === "minimum_spend"
        ? toIdrMinorUnits(Math.round(faceValueCents * 0.5))
        : null,
    expiresAt: toIsoString(addDays(now, faker.number.int({ min: 7, max: 90 }))),
    status,
  });
}

/** Generates `count` deterministic AU listings from a base seed. */
export function generateAuListings(count: number, baseSeed: number, now?: Date): Listing[] {
  const reference = now ?? DEFAULT_REFERENCE_INSTANT;
  return Array.from({ length: count }, (_unused, index) =>
    auListingFrom(createSeededFaker(baseSeed + index), reference),
  );
}

/** A Sydney listing with zero stock remaining — the AU sold-out fixture. */
export const auSoldOutListingFixture: Listing = listingSchema.parse({
  id: "00000000-0000-4000-8000-0000000002a1",
  merchantId: "00000000-0000-4000-8000-0000000003a1",
  merchantName: "Wharf Espresso Co",
  title: "Voucher — Wharf Espresso Co",
  description: "Coffee voucher, currently out of stock.",
  category: "food_beverage",
  district: "Manly",
  faceValueIdr: toIdrMinorUnits(2_000), // $20.00
  settlementValueIdr: toIdrMinorUnits(600), // $6.00
  priceInPoints: pointsPriceFromSettlement(
    toIdrMinorUnits(600),
    MOCK_BACKING_RATE_AUD_CENTS_PER_POINT,
  ),
  stockRemaining: 0,
  stockTotal: 100,
  transferable: false,
  partialRedemptionPolicy: "single_use_forfeit",
  minimumSpendIdr: null,
  expiresAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, 30)),
  status: "sold_out",
});

/** The AU "long merchant name" listing fixture, for 320px-viewport checks. */
export const auLongMerchantNameListingFixture: Listing = listingSchema.parse({
  id: "00000000-0000-4000-8000-0000000002a2",
  merchantId: "00000000-0000-4000-8000-0000000003a2",
  merchantName: LONG_MERCHANT_NAME_AU,
  title: "Premium Electronics Bundle",
  description: "A high-value item, requiring a large number of points.",
  category: "merchandise",
  district: "Chatswood",
  faceValueIdr: toIdrMinorUnits(1_000_000), // $10,000.00
  settlementValueIdr: toIdrMinorUnits(600_000),
  priceInPoints: toPoints(1_500_000),
  stockRemaining: 3,
  stockTotal: 10,
  transferable: false,
  partialRedemptionPolicy: "single_use_forfeit",
  minimumSpendIdr: null,
  expiresAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, 60)),
  status: "available",
});

function auCampaignFrom(faker: ReturnType<typeof createSeededFaker>, now: Date): Campaign {
  const kind = faker.helpers.arrayElement(["long_form", "quick"] as const);
  const merchantName = generateMerchantNameAu(faker);
  const durationSeconds =
    kind === "quick"
      ? faker.number.int({ min: 15, max: 60 })
      : faker.number.int({ min: 300, max: 1_800 });
  const questionCount =
    kind === "quick" ? faker.number.int({ min: 0, max: 2 }) : faker.number.int({ min: 1, max: 6 });
  const scoringRule =
    questionCount > 0 && faker.datatype.boolean({ probability: 0.7 })
      ? "base_plus_accuracy_bonus"
      : "base_only";

  return campaignSchema.parse({
    id: faker.string.uuid(),
    kind,
    title: generateCampaignTitleAu(faker, merchantName),
    merchantId: faker.string.uuid(),
    merchantName,
    synopsis: generateCampaignSynopsisAu(faker, merchantName),
    durationSeconds,
    estimatedDataMb: Math.round(durationSeconds * 0.35 * 10) / 10,
    rewardPoints: toPoints(
      faker.number.int({ min: kind === "quick" ? 50 : 500, max: kind === "quick" ? 400 : 4_000 }),
    ),
    questionCount,
    scoringRule,
    status: "active",
    publishedAt: toIsoString(addDays(now, -faker.number.int({ min: 0, max: 30 }))),
  });
}

/** Generates `count` deterministic AU campaigns from a base seed. */
export function generateAuCampaigns(count: number, baseSeed: number, now?: Date): Campaign[] {
  const reference = now ?? DEFAULT_REFERENCE_INSTANT;
  return Array.from({ length: count }, (_unused, index) =>
    auCampaignFrom(createSeededFaker(baseSeed + index), reference),
  );
}

/** The AU "long merchant name" campaign fixture. */
export const auLongMerchantNameCampaignFixture: Campaign = campaignSchema.parse({
  id: "00000000-0000-4000-8000-0000000001a2",
  kind: "quick",
  title: "Flash Promo",
  merchantId: "00000000-0000-4000-8000-0000000010a2",
  merchantName: LONG_MERCHANT_NAME_AU,
  synopsis: "A short campaign from a merchant with a very long name.",
  durationSeconds: 30,
  estimatedDataMb: 12,
  rewardPoints: toPoints(150),
  questionCount: 0,
  scoringRule: "base_only",
  status: "active",
  publishedAt: toIsoString(DEFAULT_REFERENCE_INSTANT),
});

function auVoucherFrom(faker: ReturnType<typeof createSeededFaker>, now: Date): Voucher {
  const merchantName = generateMerchantNameAu(faker);
  const faceValueCents = toIdrMinorUnits(faker.number.int({ min: 1_000, max: 40_000 }));
  const issuedDaysAgo = faker.number.int({ min: 0, max: 45 });
  const validForDays = faker.number.int({ min: 7, max: 90 });
  const partialRedemptionPolicy = faker.helpers.arrayElement([
    "balance_carrying",
    "single_use_forfeit",
    "minimum_spend",
  ] as const);
  const remainingValueCents =
    partialRedemptionPolicy === "balance_carrying"
      ? toIdrMinorUnits(
          Math.round(faceValueCents * faker.number.float({ min: 0, max: 1, fractionDigits: 2 })),
        )
      : faceValueCents;

  // merchantId and minimumSpendIdr added by YT-0039 follow-up: a redemption
  // is authorized on merchantId, never on the display name, and a
  // minimum_spend voucher must carry its own threshold.
  const minimumSpendIdr =
    partialRedemptionPolicy === "minimum_spend"
      ? toIdrMinorUnits(Math.round(faceValueCents / 2))
      : null;

  return voucherSchema.parse({
    id: faker.string.uuid(),
    listingId: faker.string.uuid(),
    ownerId: faker.string.uuid(),
    code: faker.string.alphanumeric({ length: 10, casing: "upper" }),
    merchantId: faker.string.uuid(),
    merchantName,
    title: `Voucher — ${merchantName}`,
    faceValueIdr: faceValueCents,
    remainingValueIdr: remainingValueCents,
    partialRedemptionPolicy,
    minimumSpendIdr,
    transferable: faker.datatype.boolean({ probability: 0.4 }),
    status: "active",
    issuedAt: toIsoString(addDays(now, -issuedDaysAgo)),
    expiresAt: toIsoString(addDays(now, validForDays - issuedDaysAgo)),
  });
}

/** Generates `count` deterministic AU vouchers from a base seed. */
export function generateAuVouchers(count: number, baseSeed: number, now?: Date): Voucher[] {
  const reference = now ?? DEFAULT_REFERENCE_INSTANT;
  return Array.from({ length: count }, (_unused, index) =>
    auVoucherFrom(createSeededFaker(baseSeed + index), reference),
  );
}

/** An AU voucher that expired in the past — the AU expired-voucher fixture. */
export const auExpiredVoucherFixture: Voucher = voucherSchema.parse({
  id: "00000000-0000-4000-8000-0000000004a1",
  listingId: "00000000-0000-4000-8000-0000000002a1",
  ownerId: "00000000-0000-4000-8000-0000000005a1",
  code: "EXPIREDAU1",
  merchantId: "00000000-0000-4000-8000-0000000003a1",
  merchantName: "Wharf Espresso Co",
  title: "Voucher — Wharf Espresso Co",
  faceValueIdr: toIdrMinorUnits(2_000),
  remainingValueIdr: toIdrMinorUnits(2_000),
  partialRedemptionPolicy: "single_use_forfeit",
  minimumSpendIdr: null,
  transferable: false,
  status: "expired",
  issuedAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, -60)),
  expiresAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, -1)),
});

/** An AU voucher expiring within the hour — mirrors `expiringWithinHourVoucherFixture`. */
export const auExpiringWithinHourVoucherFixture: Voucher = voucherSchema.parse({
  id: "00000000-0000-4000-8000-0000000004a2",
  listingId: "00000000-0000-4000-8000-0000000002a2",
  ownerId: "00000000-0000-4000-8000-0000000005a2",
  code: "LASTCALLAU",
  merchantId: "00000000-0000-4000-8000-0000000003a1",
  merchantName: "Cedar Deli Bar",
  title: "Voucher — Cedar Deli Bar",
  faceValueIdr: toIdrMinorUnits(5_000),
  remainingValueIdr: toIdrMinorUnits(5_000),
  partialRedemptionPolicy: "balance_carrying",
  minimumSpendIdr: null,
  transferable: true,
  status: "active",
  issuedAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, -10)),
  expiresAt: toIsoString(addMinutes(DEFAULT_REFERENCE_INSTANT, 45)),
});
