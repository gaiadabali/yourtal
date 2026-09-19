import type { Listing } from "@yourtal/contracts/listing";
import { listingSchema } from "@yourtal/contracts/listing";
import type { Balance } from "@yourtal/contracts/balance";
import { balanceSchema } from "@yourtal/contracts/balance";
import { toIdrMinorUnits, toPoints } from "@yourtal/contracts/money";

/**
 * Shared listing/balance builders for this feature's tests only (mirrors
 * `features/checkpoint/checkpoint-question-fixtures.ts`). Value-imports Zod
 * schemas directly, which is fine here — test files never ship in a client
 * bundle, so the 170 KB initial-JS budget (docs/13b section 8) does not
 * apply to them.
 */

const BASE_LISTING = {
  id: "00000000-0000-4000-8000-000000000901",
  merchantId: "00000000-0000-4000-8000-000000000902",
  merchantName: "Warung Uji",
  title: "Voucher Uji",
  description: "Voucher untuk pengujian.",
  category: "food_beverage",
  district: "Menteng",
  faceValueIdr: toIdrMinorUnits(100_000),
  settlementValueIdr: toIdrMinorUnits(30_000),
  stockRemaining: 5,
  stockTotal: 10,
  transferable: false,
  partialRedemptionPolicy: "single_use_forfeit",
  minimumSpendIdr: null,
  expiresAt: "2026-12-31T00:00:00.000Z",
  status: "available",
} as const;

export function makeListingFixture(overrides: Record<string, unknown> = {}): Listing {
  return listingSchema.parse({ ...BASE_LISTING, priceInPoints: toPoints(5_000), ...overrides });
}

export function makeBalanceFixture(overrides: Record<string, unknown> = {}): Balance {
  return balanceSchema.parse({
    userId: "00000000-0000-4000-8000-000000000903",
    availablePoints: toPoints(0),
    pendingPoints: toPoints(0),
    pendingUnlockAt: null,
    expiringPoints: toPoints(0),
    expiringAt: null,
    updatedAt: "2026-09-19T00:00:00.000Z",
    ...overrides,
  });
}
