import type { Voucher } from "../voucher/voucher";
import { voucherSchema } from "../voucher/voucher";
import { DEFAULT_REFERENCE_INSTANT, addDays, addMinutes, toIsoString } from "../internal/clock";
import { createSeededFaker } from "../internal/seeded-faker";
import { generateMerchantLocationAu } from "../internal/sydney";

import { pickMockMerchant } from "../merchant/merchant-roster";
import { audCents } from "../money/money-value";

/**
 * AU counterpart to `voucher.mock.ts` — see `region-mock-au-listing.ts`'s
 * header for why this used to live in one `region-mock-au.ts` file.
 */

function auVoucherFrom(faker: ReturnType<typeof createSeededFaker>, now: Date): Voucher {
  // Merchant identity comes from the shared roster, never from the faker.
  // A random per-fixture uuid here is what made every prototype redemption
  // return `wrong_merchant`: the counter can only be provisioned as a roster
  // merchant, so a generated one could never match. See merchant-roster.ts.
  const merchant = pickMockMerchant(faker, "AU");
  const merchantName = merchant.name;
  const faceValueCents = audCents(faker.number.int({ min: 1_000, max: 40_000 }));
  const issuedDaysAgo = faker.number.int({ min: 0, max: 45 });
  const validForDays = faker.number.int({ min: 7, max: 90 });
  const partialRedemptionPolicy = faker.helpers.arrayElement([
    "balance_carrying",
    "single_use_forfeit",
    "minimum_spend",
  ] as const);
  const remainingValueCents =
    partialRedemptionPolicy === "balance_carrying"
      ? audCents(
          Math.round(faceValueCents * faker.number.float({ min: 0, max: 1, fractionDigits: 2 })),
        )
      : faceValueCents;

  const minimumSpendIdr =
    partialRedemptionPolicy === "minimum_spend" ? audCents(Math.round(faceValueCents / 2)) : null;

  return voucherSchema.parse({
    id: faker.string.uuid(),
    listingId: faker.string.uuid(),
    ownerId: faker.string.uuid(),
    code: faker.string.alphanumeric({ length: 10, casing: "upper" }),
    merchantId: merchant.id,
    merchantName,
    location: generateMerchantLocationAu(faker, merchantName, "Main Branch"),
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
  merchantId: "00000000-0000-4000-8000-0000000006a1",
  merchantName: "Wharf Espresso Co",
  location: {
    id: "00000000-0000-4000-8000-0000000022a1",
    name: "Wharf Espresso Co — Main Branch",
    address: "12 Marine Parade, Manly",
    district: "Manly",
  },
  title: "Voucher — Wharf Espresso Co",
  faceValueIdr: audCents(2_000),
  remainingValueIdr: audCents(2_000),
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
  merchantId: "00000000-0000-4000-8000-0000000006a3",
  merchantName: "Cedar Deli Bar",
  location: {
    id: "00000000-0000-4000-8000-0000000022a3",
    name: "Cedar Deli Bar — Main Branch",
    address: "5 Crown Street, Surry Hills",
    district: "Surry Hills",
  },
  title: "Voucher — Cedar Deli Bar",
  faceValueIdr: audCents(5_000),
  remainingValueIdr: audCents(5_000),
  partialRedemptionPolicy: "balance_carrying",
  minimumSpendIdr: null,
  transferable: true,
  status: "active",
  issuedAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, -10)),
  expiresAt: toIsoString(addMinutes(DEFAULT_REFERENCE_INSTANT, 45)),
});
