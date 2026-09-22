import type { Listing } from "./listing";
import { listingSchema } from "./listing";
import { DEFAULT_REFERENCE_INSTANT, addDays, addHours, toIsoString } from "../internal/clock";
import { createSeededFaker } from "../internal/seeded-faker";
import { LONG_MERCHANT_NAME, generateMerchantLocations } from "../internal/jakarta";
import { pointsPriceFromSettlement, rupiah, toMinorUnits, toPoints } from "../money/money";
import { MOCK_BACKING_RATE_IDR_SEN_PER_POINT } from "../money/mock-backing-rate";
import { pickMockMerchant } from "../merchant/merchant-roster";

/** Illustrative mock backing rate (IDR per point), see docs/09 section 4.1. Not the real pricing engine. */
// Rupiah per point. If YT-0506 settles on sen, this becomes sen-per-point
// and must move with the settlement values, or prices go 100x wrong.

export interface GenerateListingParams {
  seed: number;
  now?: Date | undefined;
}

/** Generates one deterministic, realistic store listing for the given seed. */
export function generateListing(params: GenerateListingParams): Listing {
  const now = params.now ?? DEFAULT_REFERENCE_INSTANT;
  const faker = createSeededFaker(params.seed);

  // Merchant identity comes from the shared roster, never from the faker.
  // A random per-fixture uuid here is what made every prototype redemption
  // return `wrong_merchant`: the counter can only be provisioned as a roster
  // merchant, so a generated one could never match. See merchant-roster.ts.
  const merchant = pickMockMerchant(faker, "ID");
  const merchantName = merchant.name;
  const faceValueMinor = rupiah(faker.number.int({ min: 15, max: 400 }) * 1_000);
  // `faceValueMinor` is already in IDR minor units — currently whole Rupiah, see
  // money.ts and YT-0506 — so scaling it by 0.3 keeps it in the same unit and
  // `toMinorUnits` here only re-brands the result, it does not convert.
  const settlementValueMinor = toMinorUnits(Math.round(faceValueMinor * 0.3));
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
  // Weighted toward a single outlet, since that is the common case; up to 3
  // exercises the multi-branch redemption path YT-0502 exists for.
  const locationCount = faker.helpers.weightedArrayElement([
    { value: 1, weight: 6 },
    { value: 2, weight: 3 },
    { value: 3, weight: 1 },
  ]);

  return listingSchema.parse({
    id: faker.string.uuid(),
    merchantId: merchant.id,
    merchantName,
    title: `Voucher ${merchantName}`,
    description: `Nikmati penawaran spesial dari ${merchantName}, berlaku di lokasi terpilih.`,
    category: faker.helpers.arrayElement([
      "food_beverage",
      "retail",
      "digital_goods",
      "merchandise",
      "services",
    ] as const),
    locations: generateMerchantLocations(faker, merchantName, locationCount),
    currency: "IDR" as const,
    faceValueMinor,
    settlementValueMinor,
    priceInPoints: pointsPriceFromSettlement(
      settlementValueMinor,
      MOCK_BACKING_RATE_IDR_SEN_PER_POINT,
    ),
    stockRemaining,
    stockTotal,
    transferable: faker.datatype.boolean({ probability: 0.4 }),
    partialRedemptionPolicy,
    minimumSpendMinor:
      partialRedemptionPolicy === "minimum_spend"
        ? toMinorUnits(Math.round(faceValueMinor * 0.5))
        : null,
    expiresAt: toIsoString(addDays(now, faker.number.int({ min: 7, max: 90 }))),
    status,
  });
}

/** Generates `count` deterministic listings from a base seed. */
export function generateListings(count: number, baseSeed: number, now?: Date): Listing[] {
  return Array.from({ length: count }, (_unused, index) =>
    generateListing({ seed: baseSeed + index, now }),
  );
}

/** A listing with zero stock remaining, status sold_out — the store's empty-inventory state. */
export const soldOutListingFixture: Listing = listingSchema.parse({
  id: "00000000-0000-4000-8000-000000000201",
  merchantId: "00000000-0000-4000-8000-000000000604",
  merchantName: "Kopi Sentosa",
  title: "Voucher Kopi Sentosa Rp30.000",
  description: "Voucher kopi favorit, sedang habis diminati.",
  category: "food_beverage",
  locations: [
    {
      id: "00000000-0000-4000-8000-000000000211",
      name: "Kopi Sentosa — Cabang Utama",
      address: "Jl. Kemang Raya No. 12, Kemang",
      district: "Kemang",
    },
  ],
  currency: "IDR" as const,
  faceValueMinor: rupiah(30_000),
  settlementValueMinor: rupiah(9_000),
  priceInPoints: pointsPriceFromSettlement(rupiah(9_000), MOCK_BACKING_RATE_IDR_SEN_PER_POINT),
  stockRemaining: 0,
  stockTotal: 100,
  transferable: false,
  partialRedemptionPolicy: "single_use_forfeit",
  minimumSpendMinor: null,
  expiresAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, 30)),
  status: "sold_out",
});

/**
 * A listing priced above any plausible user balance (docs/09 realistic
 * earning rates top out at a few thousand points a day). Used to exercise
 * the "insufficient balance, here is how much more you need" state
 * (docs/tasks/phase-u-ui.md YT-0421).
 */
export const abovePlausibleBalanceListingFixture: Listing = listingSchema.parse({
  id: "00000000-0000-4000-8000-000000000202",
  merchantId: "00000000-0000-4000-8000-000000000606",
  merchantName: LONG_MERCHANT_NAME,
  title: "Paket Elektronik Premium",
  description: "Item bernilai tinggi, memerlukan poin dalam jumlah besar.",
  category: "merchandise",
  locations: [
    {
      id: "00000000-0000-4000-8000-000000000212",
      name: `${LONG_MERCHANT_NAME} — Cabang Utama`,
      address: "Jl. Sudirman No. 88, Senayan",
      district: "Senayan",
    },
  ],
  currency: "IDR" as const,
  faceValueMinor: rupiah(15_000_000),
  settlementValueMinor: rupiah(9_000_000),
  priceInPoints: toPoints(1_500_000),
  stockRemaining: 3,
  stockTotal: 10,
  transferable: false,
  partialRedemptionPolicy: "single_use_forfeit",
  minimumSpendMinor: null,
  expiresAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, 60)),
  status: "available",
});

/** A listing expiring within the next few hours — the "expiring soon" catalogue state. */
export const expiringSoonListingFixture: Listing = listingSchema.parse({
  id: "00000000-0000-4000-8000-000000000203",
  merchantId: "00000000-0000-4000-8000-000000000601",
  merchantName: "Toko Berkah",
  title: "Voucher Belanja Toko Berkah",
  description: "Voucher belanja yang akan segera berakhir masa berlakunya.",
  category: "retail",
  locations: [
    {
      id: "00000000-0000-4000-8000-000000000213",
      name: "Toko Berkah — Cabang Utama",
      address: "Jl. Kartini No. 5, Tebet",
      district: "Tebet",
    },
    {
      id: "00000000-0000-4000-8000-000000000214",
      name: "Toko Berkah — Cabang 2",
      address: "Jl. Diponegoro No. 41, Setiabudi",
      district: "Setiabudi",
    },
  ],
  currency: "IDR" as const,
  faceValueMinor: rupiah(50_000),
  settlementValueMinor: rupiah(15_000),
  priceInPoints: pointsPriceFromSettlement(rupiah(15_000), MOCK_BACKING_RATE_IDR_SEN_PER_POINT),
  stockRemaining: 12,
  stockTotal: 50,
  transferable: true,
  partialRedemptionPolicy: "balance_carrying",
  minimumSpendMinor: null,
  expiresAt: toIsoString(addHours(DEFAULT_REFERENCE_INSTANT, 3)),
  status: "expiring_soon",
});

export const mockListings: Listing[] = generateListings(30, 2_000);
