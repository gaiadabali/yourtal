import { describe, expect, it } from "vitest";
import { walletVoucherDetailSchema } from "./wallet";

const base = {
  voucherId: "00000000-0000-4000-8000-000000000001",
  listingId: "00000000-0000-4000-8000-000000000010",
  state: "activated",
};

describe("walletVoucherDetailSchema redeemIn", () => {
  it("is optional and carries the partner id when present", () => {
    expect(walletVoucherDetailSchema.parse(base)).not.toHaveProperty("redeemIn");
    expect(
      walletVoucherDetailSchema.parse({ ...base, redeemIn: { partnerId: "snap-app" } }),
    ).toMatchObject({
      redeemIn: { partnerId: "snap-app" },
    });
  });

  it("refuses an empty partner id", () => {
    expect(
      walletVoucherDetailSchema.safeParse({ ...base, redeemIn: { partnerId: "" } }).success,
    ).toBe(false);
  });
});
