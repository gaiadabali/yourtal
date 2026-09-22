import type { Voucher } from "./voucher";
import { voucherSchema } from "./voucher";
import { DEFAULT_REFERENCE_INSTANT, addDays, addMinutes, toIsoString } from "../internal/clock";
import { createSeededFaker } from "../internal/seeded-faker";
import { generateMerchantLocation } from "../internal/jakarta";
import { rupiah, toMinorUnits } from "../money/money";
import { pickMockMerchant } from "../merchant/merchant-roster";

export interface GenerateVoucherParams {
  seed: number;
  now?: Date | undefined;
}

/** Generates one deterministic, realistic held voucher for the given seed. */
export function generateVoucher(params: GenerateVoucherParams): Voucher {
  const now = params.now ?? DEFAULT_REFERENCE_INSTANT;
  const faker = createSeededFaker(params.seed);

  // Merchant identity comes from the shared roster, never from the faker.
  // A random per-fixture uuid here is what made every prototype redemption
  // return `wrong_merchant`: the counter can only be provisioned as a roster
  // merchant, so a generated one could never match. See merchant-roster.ts.
  const merchant = pickMockMerchant(faker, "ID");
  const merchantName = merchant.name;
  const faceValueMinor = rupiah(faker.number.int({ min: 15, max: 400 }) * 1_000);
  const issuedDaysAgo = faker.number.int({ min: 0, max: 45 });
  const validForDays = faker.number.int({ min: 7, max: 90 });
  const partialRedemptionPolicy = faker.helpers.arrayElement([
    "balance_carrying",
    "single_use_forfeit",
    "minimum_spend",
  ] as const);
  // Derived from faceValueMinor, which is already in the stored minor unit,
  // so it goes through toMinorUnits rather than any Rupiah conversion.
  const remainingValueMinor =
    partialRedemptionPolicy === "balance_carrying"
      ? toMinorUnits(
          Math.round(faceValueMinor * faker.number.float({ min: 0, max: 1, fractionDigits: 2 })),
        )
      : faceValueMinor;

  // Set if and only if the policy is minimum_spend — voucherSchema enforces
  // the biconditional, so a mock that got this wrong would fail to parse.
  const minimumSpendMinor =
    partialRedemptionPolicy === "minimum_spend"
      ? toMinorUnits(Math.round(faceValueMinor / 2))
      : null;

  return voucherSchema.parse({
    id: faker.string.uuid(),
    listingId: faker.string.uuid(),
    ownerId: faker.string.uuid(),
    code: faker.string.alphanumeric({ length: 10, casing: "upper" }),
    merchantId: merchant.id,
    merchantName,
    location: generateMerchantLocation(faker, merchantName, "Cabang Utama"),
    title: `Voucher ${merchantName}`,
    currency: "IDR" as const,
    faceValueMinor,
    remainingValueMinor,
    partialRedemptionPolicy,
    minimumSpendMinor,
    transferable: faker.datatype.boolean({ probability: 0.4 }),
    status: "active",
    issuedAt: toIsoString(addDays(now, -issuedDaysAgo)),
    expiresAt: toIsoString(addDays(now, validForDays - issuedDaysAgo)),
  });
}

/** Generates `count` deterministic vouchers from a base seed. */
export function generateVouchers(count: number, baseSeed: number, now?: Date): Voucher[] {
  return Array.from({ length: count }, (_unused, index) =>
    generateVoucher({ seed: baseSeed + index, now }),
  );
}

/** A voucher that expired in the past, relative to the fixed reference instant. */
export const expiredVoucherFixture: Voucher = voucherSchema.parse({
  id: "00000000-0000-4000-8000-000000000401",
  listingId: "00000000-0000-4000-8000-000000000201",
  ownerId: "00000000-0000-4000-8000-000000000501",
  code: "EXPIREDX1",
  merchantId: "00000000-0000-4000-8000-000000000604",
  merchantName: "Kopi Sentosa",
  location: {
    id: "00000000-0000-4000-8000-000000000211",
    name: "Kopi Sentosa — Cabang Utama",
    address: "Jl. Kemang Raya No. 12, Kemang",
    district: "Kemang",
  },
  title: "Voucher Kopi Sentosa Rp30.000",
  currency: "IDR" as const,
  faceValueMinor: rupiah(30_000),
  remainingValueMinor: rupiah(30_000),
  partialRedemptionPolicy: "single_use_forfeit",
  minimumSpendMinor: null,
  transferable: false,
  status: "expired",
  issuedAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, -60)),
  expiresAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, -1)),
});

/**
 * A voucher expiring within the hour, relative to the fixed reference
 * instant — exercises the "about to lose it" wallet state (docs/17 section
 * 3) without depending on the wall clock.
 */
export const expiringWithinHourVoucherFixture: Voucher = voucherSchema.parse({
  id: "00000000-0000-4000-8000-000000000402",
  listingId: "00000000-0000-4000-8000-000000000203",
  ownerId: "00000000-0000-4000-8000-000000000502",
  code: "LASTCALL01",
  merchantId: "00000000-0000-4000-8000-000000000601",
  merchantName: "Toko Berkah",
  location: {
    id: "00000000-0000-4000-8000-000000000213",
    name: "Toko Berkah — Cabang Utama",
    address: "Jl. Kartini No. 5, Tebet",
    district: "Tebet",
  },
  title: "Voucher Belanja Toko Berkah",
  currency: "IDR" as const,
  faceValueMinor: rupiah(50_000),
  remainingValueMinor: rupiah(50_000),
  partialRedemptionPolicy: "balance_carrying",
  minimumSpendMinor: null,
  transferable: true,
  status: "active",
  issuedAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, -10)),
  expiresAt: toIsoString(addMinutes(DEFAULT_REFERENCE_INSTANT, 45)),
});

export const mockVouchers: Voucher[] = generateVouchers(15, 3_000);
