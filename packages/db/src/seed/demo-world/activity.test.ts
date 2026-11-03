import { describe, expect, it } from "vitest";
import { KEEP_GIFTABLE, pickToAuction, pickToRedeem } from "./activity";

const active = (id: string, giftable: boolean) => ({ id, status: "active", giftable });

describe("pickToRedeem: what the daily counter visit spends", () => {
  it("spends a voucher the member cannot pass on before any they can", () => {
    const won = active("won", false);
    expect(pickToRedeem([active("a", true), won, active("b", true)])).toEqual([won]);
  });

  it("keeps the last unused giftable vouchers for the guide's gift and auction journeys", () => {
    const stock = Array.from({ length: KEEP_GIFTABLE }, (_, i) => active(`g${String(i)}`, true));
    expect(pickToRedeem(stock)).toEqual([]);
    expect(pickToRedeem([...stock, active("extra", true)])).toHaveLength(1);
  });

  it("ignores vouchers that are not active, and an account with none", () => {
    expect(pickToRedeem([{ status: "redeemed", giftable: false }])).toEqual([]);
    expect(pickToRedeem([])).toEqual([]);
  });
});

describe("pickToAuction: the voucher put up for a charity when no auction is open", () => {
  it("takes an unused voucher the member can pass on", () => {
    const keep = active("a", true);
    expect(pickToAuction([active("won", false), keep])).toBe(keep);
  });

  it("takes nothing when none can be passed on", () => {
    expect(
      pickToAuction([active("won", false), { status: "redeemed", giftable: true }]),
    ).toBeUndefined();
  });
});
