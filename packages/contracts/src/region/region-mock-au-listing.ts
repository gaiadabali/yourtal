import type { Listing } from "../listing/listing";
import { listingSchema } from "../listing/listing";
import { DEFAULT_REFERENCE_INSTANT, addDays, toIsoString } from "../internal/clock";
import { createSeededFaker } from "../internal/seeded-faker";
import { LONG_MERCHANT_NAME_AU, generateMerchantLocationsAu } from "../internal/sydney";
import { pointsPriceFromSettlement, toPoints } from "../money/money";

import { pickMockMerchant } from "../merchant/merchant-roster";
import { audCents } from "../money/money-value";
import { MOCK_BACKING_RATE_AUD_CENTS_PER_POINT } from "../money/mock-backing-rate";

/**
 * AU counterpart to `listing.mock.ts` — Sydney flavour, AUD-cents scale
 * amounts. Split out of what was one `region-mock-au.ts` (campaign and
 * voucher moved to their own siblings) to stay under the 300-line ceiling
 * once YT-0502's `locations` array replaced a single `district` field here.
 *
 * The known IDR-field wart described in `region-mock-au.ts`'s original
 * header still applies: these fixtures store AUD **cents** in the
 * IDR-branded fields, and `formatMoney(amount, "AUD")` is what renders that
 * correctly.
 */

// AUD cents per point. Illustrative only, like the IDR mock rate in
// listing.mock.ts — not the real pricing engine.

function auListingFrom(faker: ReturnType<typeof createSeededFaker>, now: Date): Listing {
  // Merchant identity comes from the shared roster, never from the faker.
  // A random per-fixture uuid here is what made every prototype redemption
  // return `wrong_merchant`: the counter can only be provisioned as a roster
  // merchant, so a generated one could never match. See merchant-roster.ts.
  const merchant = pickMockMerchant(faker, "AU");
  const merchantName = merchant.name;
  const faceValueCents = audCents(faker.number.int({ min: 1_000, max: 40_000 })); // $10.00–$400.00
  const settlementValueCents = audCents(Math.round(faceValueCents * 0.3));
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
  const locationCount = faker.helpers.weightedArrayElement([
    { value: 1, weight: 6 },
    { value: 2, weight: 3 },
    { value: 3, weight: 1 },
  ]);

  return listingSchema.parse({
    id: faker.string.uuid(),
    merchantId: merchant.id,
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
    locations: generateMerchantLocationsAu(faker, merchantName, locationCount),
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
        ? audCents(Math.round(faceValueCents * 0.5))
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
  merchantId: "00000000-0000-4000-8000-0000000006a1",
  merchantName: "Wharf Espresso Co",
  title: "Voucher — Wharf Espresso Co",
  description: "Coffee voucher, currently out of stock.",
  category: "food_beverage",
  locations: [
    {
      id: "00000000-0000-4000-8000-0000000022a1",
      name: "Wharf Espresso Co — Main Branch",
      address: "12 Marine Parade, Manly",
      district: "Manly",
    },
  ],
  faceValueIdr: audCents(2_000), // $20.00
  settlementValueIdr: audCents(600), // $6.00
  priceInPoints: pointsPriceFromSettlement(audCents(600), MOCK_BACKING_RATE_AUD_CENTS_PER_POINT),
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
  merchantId: "00000000-0000-4000-8000-0000000006a2",
  merchantName: LONG_MERCHANT_NAME_AU,
  title: "Premium Electronics Bundle",
  description: "A high-value item, requiring a large number of points.",
  category: "merchandise",
  locations: [
    {
      id: "00000000-0000-4000-8000-0000000022a2",
      name: `${LONG_MERCHANT_NAME_AU} — Main Branch`,
      address: "88 George Street, Chatswood",
      district: "Chatswood",
    },
  ],
  faceValueIdr: audCents(1_000_000), // $10,000.00
  settlementValueIdr: audCents(600_000),
  priceInPoints: toPoints(1_500_000),
  stockRemaining: 3,
  stockTotal: 10,
  transferable: false,
  partialRedemptionPolicy: "single_use_forfeit",
  minimumSpendIdr: null,
  expiresAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, 60)),
  status: "available",
});
