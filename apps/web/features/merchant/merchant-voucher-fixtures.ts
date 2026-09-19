import type { Voucher } from "@yourtal/contracts/voucher";
import { voucherSchema } from "@yourtal/contracts/voucher";
import { rupiah, toIdrMinorUnits } from "@yourtal/contracts/money";

/**
 * SERVER-ONLY fixtures (value-imports `voucherSchema`/`toIdrMinorUnits`,
 * so this must never be reached from a "use client" file — only
 * `merchant-data.ts` imports it, same rule as
 * `@yourtal/contracts/voucher/mock`'s own fixtures).
 *
 * `@yourtal/contracts/voucher/mock` ships `expiredVoucherFixture` and
 * `expiringWithinHourVoucherFixture` (used below), but this ticket's
 * brief names two more failure states the counter device must exercise
 * that the shared catalogue has no fixture for: a voucher someone else
 * already redeemed, and a voucher for a merchant other than this device's
 * own. Both are built the same way `voucher.mock.ts` builds its own fixed
 * fixtures — a hardcoded, deterministic UUID and a fixed reference
 * instant, run through `voucherSchema.parse` so an accidental
 * schema-violating literal fails loudly instead of silently rendering
 * wrong.
 */
const REFERENCE_INSTANT = new Date("2026-09-19T09:00:00.000Z");

function daysFrom(base: Date, days: number): string {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * `merchantName` on these three matches the mock device's own merchant
 * (`merchant-data.ts` — "Toko Berkah", the same merchant
 * `expiringWithinHourVoucherFixture` already belongs to in
 * `@yourtal/contracts/voucher/mock`), so looking them up demonstrates the
 * failure state named in each comment rather than being masked by an
 * unrelated wrong-merchant rejection. `wrongMerchantVoucherFixture` below
 * is the one deliberately for a DIFFERENT merchant.
 */

/** Already redeemed by a previous transaction — exercises the "already_redeemed" failure state. */
export const alreadyRedeemedVoucherFixture: Voucher = voucherSchema.parse({
  id: "00000000-0000-4000-8000-000000000901",
  listingId: "00000000-0000-4000-8000-000000000801",
  ownerId: "00000000-0000-4000-8000-000000000701",
  code: "USEDCODE1",
  merchantId: "00000000-0000-4000-8000-000000000601",
  merchantName: "Toko Berkah",
  location: {
    id: "00000005-0000-4000-8000-000000000905",
    name: "Toko Berkah Kemang",
    address: "Jl. Kemang Raya 1",
    district: "Kemang",
  },
  title: "Voucher Toko Berkah",
  faceValueIdr: rupiah(25_000),
  remainingValueIdr: toIdrMinorUnits(0),
  partialRedemptionPolicy: "single_use_forfeit",
  minimumSpendIdr: null,
  transferable: false,
  status: "redeemed",
  issuedAt: daysFrom(REFERENCE_INSTANT, -5),
  expiresAt: daysFrom(REFERENCE_INSTANT, 25),
});

/** Genuine and active, but minted for a different merchant than this device's own — exercises "wrong_merchant". */
export const wrongMerchantVoucherFixture: Voucher = voucherSchema.parse({
  id: "00000000-0000-4000-8000-000000000902",
  listingId: "00000000-0000-4000-8000-000000000802",
  ownerId: "00000000-0000-4000-8000-000000000702",
  code: "OTHRSHOP1",
  merchantId: "00000000-0000-4000-8000-000000000602",
  merchantName: "Kopi Kenangan Kemang",
  location: {
    id: "00000006-0000-4000-8000-000000000906",
    name: "Kopi Kenangan Kemang Kemang",
    address: "Jl. Kemang Raya 1",
    district: "Kemang",
  },
  title: "Voucher Kopi Kenangan Kemang",
  faceValueIdr: rupiah(60_000),
  remainingValueIdr: rupiah(60_000),
  partialRedemptionPolicy: "balance_carrying",
  minimumSpendIdr: null,
  transferable: false,
  status: "active",
  issuedAt: daysFrom(REFERENCE_INSTANT, -2),
  expiresAt: daysFrom(REFERENCE_INSTANT, 30),
});

/** A voucher with a `minimum_spend` policy, active and redeemable in full — exercises "requires_full_value_redemption" when staff enter a partial amount. */
export const minimumSpendVoucherFixture: Voucher = voucherSchema.parse({
  id: "00000000-0000-4000-8000-000000000903",
  listingId: "00000000-0000-4000-8000-000000000803",
  ownerId: "00000000-0000-4000-8000-000000000703",
  code: "MINSPEND1",
  merchantId: "00000000-0000-4000-8000-000000000601",
  merchantName: "Toko Berkah",
  location: {
    id: "00000007-0000-4000-8000-000000000907",
    name: "Toko Berkah Kemang",
    address: "Jl. Kemang Raya 1",
    district: "Kemang",
  },
  title: "Voucher Belanja Minimum",
  faceValueIdr: rupiah(100_000),
  remainingValueIdr: rupiah(100_000),
  partialRedemptionPolicy: "minimum_spend",
  minimumSpendIdr: rupiah(50_000),
  transferable: false,
  status: "active",
  issuedAt: daysFrom(REFERENCE_INSTANT, -1),
  expiresAt: daysFrom(REFERENCE_INSTANT, 60),
});

/** Plain, healthy, active voucher for the device's own merchant with no edge case in play — the ordinary happy path. */
export const healthyVoucherFixture: Voucher = voucherSchema.parse({
  id: "00000000-0000-4000-8000-000000000904",
  listingId: "00000000-0000-4000-8000-000000000804",
  ownerId: "00000000-0000-4000-8000-000000000704",
  code: "GOODCODE1",
  merchantId: "00000000-0000-4000-8000-000000000601",
  merchantName: "Toko Berkah",
  location: {
    id: "00000008-0000-4000-8000-000000000908",
    name: "Toko Berkah Kemang",
    address: "Jl. Kemang Raya 1",
    district: "Kemang",
  },
  title: "Voucher Belanja Toko Berkah",
  faceValueIdr: rupiah(80_000),
  remainingValueIdr: rupiah(80_000),
  partialRedemptionPolicy: "balance_carrying",
  minimumSpendIdr: null,
  transferable: true,
  status: "active",
  issuedAt: daysFrom(REFERENCE_INSTANT, -3),
  expiresAt: daysFrom(REFERENCE_INSTANT, 45),
});
