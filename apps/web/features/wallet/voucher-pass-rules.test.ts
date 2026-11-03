import { describe, expect, it } from "vitest";
import { passOptions, type PassInput } from "./voucher-pass-rules";

const NOW = Date.parse("2026-10-21T00:00:00.000Z");
const base: PassInput = {
  redeemable: true,
  ageBand: "adult",
  giftable: true,
  giftBlock: undefined,
  expiresAt: "2027-10-01T00:00:00.000Z",
  nowMs: NOW,
};

describe("passOptions", () => {
  it("offers both Gift and List for charity on an unused voucher with time left", () => {
    expect(passOptions(base)).toEqual({ canGift: true, canList: true, notice: null });
  });

  it.each([
    ["received_as_gift", "received_as_gift"],
    ["not_transferable", "not_transferable"],
    ["not_unused", "not_unused"],
  ] as const)("says why when the service blocks it: %s", (giftBlock, notice) => {
    expect(passOptions({ ...base, giftable: false, giftBlock })).toEqual({
      canGift: false,
      canList: false,
      notice,
    });
  });

  it("falls back to the general line when the service names no rule", () => {
    expect(passOptions({ ...base, giftable: false }).notice).toBe("unavailable");
    expect(passOptions({ ...base, giftable: undefined }).notice).toBe("unavailable");
  });

  it("tells a teen it is for members 18 and over, and an unknown age nothing more than the general line", () => {
    expect(passOptions({ ...base, ageBand: "teen" })).toEqual({
      canGift: false,
      canList: false,
      notice: "teen",
    });
    expect(passOptions({ ...base, ageBand: undefined }).notice).toBe("unavailable");
  });

  it("still offers Gift, but not the charity listing, within 4 days of expiry", () => {
    const soon = new Date(NOW + 3 * 86_400_000).toISOString();
    expect(passOptions({ ...base, expiresAt: soon })).toEqual({
      canGift: true,
      canList: false,
      notice: "expires_soon",
    });
    const enough = new Date(NOW + 4 * 86_400_000).toISOString();
    expect(passOptions({ ...base, expiresAt: enough }).canList).toBe(true);
  });

  it("says nothing for a voucher that is not redeemable: its own panel explains", () => {
    expect(passOptions({ ...base, redeemable: false, giftable: false })).toEqual({
      canGift: false,
      canList: false,
      notice: null,
    });
  });
});
