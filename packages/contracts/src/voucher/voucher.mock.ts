import type { Voucher } from "./voucher";
import { voucherSchema } from "./voucher";
import { DEFAULT_REFERENCE_INSTANT, addDays, addMinutes, toIsoString } from "../internal/clock";
import { createSeededFaker } from "../internal/seeded-faker";
import { generateMerchantName } from "../internal/jakarta";
import { toIdrMinorUnits } from "../money/money";

export interface GenerateVoucherParams {
  seed: number;
  now?: Date | undefined;
}

/** Generates one deterministic, realistic held voucher for the given seed. */
export function generateVoucher(params: GenerateVoucherParams): Voucher {
  const now = params.now ?? DEFAULT_REFERENCE_INSTANT;
  const faker = createSeededFaker(params.seed);

  const merchantName = generateMerchantName(faker);
  const faceValueIdr = toIdrMinorUnits(faker.number.int({ min: 15, max: 400 }) * 1_000);
  const issuedDaysAgo = faker.number.int({ min: 0, max: 45 });
  const validForDays = faker.number.int({ min: 7, max: 90 });
  const partialRedemptionPolicy = faker.helpers.arrayElement([
    "balance_carrying",
    "single_use_forfeit",
    "minimum_spend",
  ] as const);
  // Derived from faceValueIdr, which is already in the stored minor unit,
  // so it goes through toIdrMinorUnits rather than any Rupiah conversion.
  const remainingValueIdr =
    partialRedemptionPolicy === "balance_carrying"
      ? toIdrMinorUnits(
          Math.round(faceValueIdr * faker.number.float({ min: 0, max: 1, fractionDigits: 2 })),
        )
      : faceValueIdr;

  // Set if and only if the policy is minimum_spend — voucherSchema enforces
  // the biconditional, so a mock that got this wrong would fail to parse.
  const minimumSpendIdr =
    partialRedemptionPolicy === "minimum_spend"
      ? toIdrMinorUnits(Math.round(faceValueIdr / 2))
      : null;

  return voucherSchema.parse({
    id: faker.string.uuid(),
    listingId: faker.string.uuid(),
    ownerId: faker.string.uuid(),
    code: faker.string.alphanumeric({ length: 10, casing: "upper" }),
    merchantId: faker.string.uuid(),
    merchantName,
    title: `Voucher ${merchantName}`,
    faceValueIdr,
    remainingValueIdr,
    partialRedemptionPolicy,
    minimumSpendIdr,
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
  merchantId: "00000000-0000-4000-8000-000000000301",
  merchantName: "Kopi Sentosa",
  title: "Voucher Kopi Sentosa Rp30.000",
  faceValueIdr: toIdrMinorUnits(30_000),
  remainingValueIdr: toIdrMinorUnits(30_000),
  partialRedemptionPolicy: "single_use_forfeit",
  minimumSpendIdr: null,
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
  merchantId: "00000000-0000-4000-8000-000000000302",
  merchantName: "Toko Berkah",
  title: "Voucher Belanja Toko Berkah",
  faceValueIdr: toIdrMinorUnits(50_000),
  remainingValueIdr: toIdrMinorUnits(50_000),
  partialRedemptionPolicy: "balance_carrying",
  minimumSpendIdr: null,
  transferable: true,
  status: "active",
  issuedAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, -10)),
  expiresAt: toIsoString(addMinutes(DEFAULT_REFERENCE_INSTANT, 45)),
});

export const mockVouchers: Voucher[] = generateVouchers(15, 3_000);
