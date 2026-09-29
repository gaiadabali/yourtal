import type { PublicListing } from "@yourtal/contracts/listing";
import { publicListingSchema } from "@yourtal/contracts/listing";
import type { WalletSummary } from "@yourtal/contracts/wallet/wallet";
import { walletSummarySchema } from "@yourtal/contracts/wallet/wallet";
import { rupiah, toPoints } from "@yourtal/contracts/money";

/**
 * Shared listing/balance builders for this feature's tests only (mirrors
 * `features/checkpoint/checkpoint-question-fixtures.ts`). Value-imports Zod
 * schemas directly, which is fine here — test files never ship in a client
 * bundle, so the 170 KB initial-JS budget (docs/13b section 8) does not
 * apply to them.
 *
 * 11.6.b: `PublicListing`/`WalletSummary`, the real contracts checkout now
 * uses, replacing Phase U's mock-only `Listing`/`Balance` fixtures.
 */

const BASE_LISTING = {
  id: "00000000-0000-4000-8000-000000000901",
  merchantId: "00000000-0000-4000-8000-000000000902",
  merchantName: "Warung Uji",
  title: "Voucher Uji",
  description: "Voucher untuk pengujian.",
  category: "food_beverage",
  locations: [
    {
      id: "00000002-0000-4000-8000-000000000902",
      name: "Menteng Outlet",
      address: "Jl. Contoh 1",
      district: "Menteng",
    },
  ],
  currency: "IDR",
  faceValueMinor: rupiah(100_000),
  stockRemaining: 5,
  stockTotal: 10,
  transferable: false,
  partialRedemptionPolicy: "single_use_forfeit",
  minimumSpendMinor: null,
  expiresAt: "2026-12-31T00:00:00.000Z",
  status: "available",
  region: "ID",
  audience: "all_ages",
  contentCategory: "food-and-drink",
  imageUrl: "https://cdn.example.com/listing.jpg",
  channel: "in_store",
  partialRedemption: "single_use",
} as const;

export function makeListingFixture(overrides: Record<string, unknown> = {}): PublicListing {
  return publicListingSchema.parse({ ...BASE_LISTING, priceInPoints: toPoints(5_000), ...overrides });
}

export interface BalanceFixtureOverrides {
  availablePoints?: number;
  pendingPoints?: number;
  pendingUnlockAt?: string | null;
  expiringPoints?: number;
  expiringAt?: string | null;
  region?: "AU" | "ID";
}

/**
 * Builds a `WalletSummary` from the simpler `{availablePoints, pendingPoints,
 * pendingUnlockAt}` shape every existing burn test already writes — `pending`
 * (one entry per unlock time, `wallet.ts`'s own doc comment) is derived as a
 * single bucket, which is all a fixture with one `pendingUnlockAt` can
 * represent anyway.
 */
export function makeBalanceFixture(overrides: BalanceFixtureOverrides = {}): WalletSummary {
  const pendingPoints = toPoints(overrides.pendingPoints ?? 0);
  const pendingUnlockAt = overrides.pendingUnlockAt ?? null;
  return walletSummarySchema.parse({
    region: overrides.region ?? "ID",
    availablePoints: toPoints(overrides.availablePoints ?? 0),
    pendingPoints,
    pending: pendingPoints > 0 && pendingUnlockAt !== null
      ? [{ points: pendingPoints, unlockAt: pendingUnlockAt }]
      : [],
    expiringPoints: toPoints(overrides.expiringPoints ?? 0),
    expiringAt: overrides.expiringAt ?? null,
  });
}
