import { describe, expect, it } from "vitest";
import { toPoints } from "@yourtal/contracts/money";
import { computeBalanceShortfall } from "./store-balance";

describe("computeBalanceShortfall", () => {
  it("is affordable with zero shortfall when the balance exactly covers the price", () => {
    expect(computeBalanceShortfall(toPoints(2_000), toPoints(2_000))).toEqual({
      isAffordable: true,
      shortfallPoints: 0,
    });
  });

  it("is affordable when the balance exceeds the price", () => {
    expect(computeBalanceShortfall(toPoints(2_000), toPoints(5_000))).toEqual({
      isAffordable: true,
      shortfallPoints: 0,
    });
  });

  it("reports the exact shortfall when the balance is insufficient", () => {
    expect(computeBalanceShortfall(toPoints(5_000), toPoints(2_000))).toEqual({
      isAffordable: false,
      shortfallPoints: 3_000,
    });
  });

  it("reports the full price as the shortfall against a zero balance", () => {
    expect(computeBalanceShortfall(toPoints(1_500_000), toPoints(0))).toEqual({
      isAffordable: false,
      shortfallPoints: 1_500_000,
    });
  });
});
