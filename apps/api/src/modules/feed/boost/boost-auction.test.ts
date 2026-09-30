import { describe, expect, it } from "vitest";
import { placeBoosted, runBoostAuction } from "./boost-auction";
import type { BoostBid } from "./boost-auction";

const bid = (campaignId: string, maxBidCpmMinor: number, overrides: Partial<BoostBid> = {}) => ({
  campaignId,
  maxBidCpmMinor,
  dailyBudgetMinor: 1_000,
  spentMilliToday: 0,
  ...overrides,
});

describe("boost auction (13.23.b)", () => {
  it("the highest bid wins and pays the next bid plus one minor unit", () => {
    const awards = runBoostAuction([bid("b", 300), bid("a", 500)], 100, 1);
    expect(awards).toEqual([{ slot: 0, campaignId: "a", priceCpmMinor: 301 }]);
  });

  it("the second slot goes to the next bid, priced against the one after it or the reserve", () => {
    const awards = runBoostAuction([bid("a", 500), bid("b", 300), bid("c", 200)], 100);
    expect(awards).toEqual([
      { slot: 0, campaignId: "a", priceCpmMinor: 301 },
      { slot: 1, campaignId: "b", priceCpmMinor: 201 },
    ]);
    expect(runBoostAuction([bid("a", 500)], 100)).toEqual([
      { slot: 0, campaignId: "a", priceCpmMinor: 100 },
    ]);
  });

  it("never charges above the winner's own bid, and a bid below the reserve never wins", () => {
    expect(runBoostAuction([bid("a", 300), bid("b", 300)], 100, 1)[0]?.priceCpmMinor).toBe(300);
    expect(runBoostAuction([bid("a", 99)], 100)).toEqual([]);
  });

  it("a boost whose day's budget cannot cover the price sits out", () => {
    const spent = bid("a", 500, { dailyBudgetMinor: 1, spentMilliToday: 800 });
    expect(runBoostAuction([spent, bid("b", 300)], 100, 1)).toEqual([
      { slot: 0, campaignId: "b", priceCpmMinor: 100 },
    ]);
  });

  it("moves winners into the slot positions and marks them boosted", () => {
    const items = ["x", "y", "z", "w"].map((campaignId) => ({ campaignId }));
    const placed = placeBoosted(items, [{ slot: 0, campaignId: "z", priceCpmMinor: 100 }]);
    expect(placed.map((item) => [item.campaignId, item.boosted])).toEqual([
      ["z", true],
      ["x", false],
      ["y", false],
      ["w", false],
    ]);
  });
});
