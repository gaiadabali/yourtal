import { describe, expect, it } from "vitest";
import { toMinorUnits } from "@yourtal/contracts/money";
import type { WalletVoucherRow } from "@yourtal/contracts/voucher-internal/wallet";
import { toWalletVoucher } from "./wallet-mapping";

const MERCHANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const row: WalletVoucherRow = {
  voucherId: "11111111-1111-4111-8111-111111111111",
  listingId: "22222222-2222-4222-8222-222222222222",
  sagaId: "saga",
  state: "activated",
  lifecycleState: "active",
  voidReason: null,
  merchantId: MERCHANT_ID,
  merchantName: "Listing copy",
  title: "Coffee",
  currency: "IDR",
  faceValueMinor: toMinorUnits(50_000),
  remainingValueMinor: toMinorUnits(50_000),
  partialRedemptionPolicy: "single_use_forfeit",
  expiresAt: "2027-10-01T00:00:00.000Z",
  location: null,
};

describe("toWalletVoucher merchant name", () => {
  it("uses the business's own display name", () => {
    expect(toWalletVoucher(row, new Map([[MERCHANT_ID, "Kopi Bali"]])).merchantName).toBe(
      "Kopi Bali",
    );
  });
  it("falls back to the listing's name when the business is unknown", () => {
    expect(toWalletVoucher(row).merchantName).toBe("Listing copy");
  });
});
