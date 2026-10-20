import { describe, expect, it } from "vitest";
import { taxMinorOf, withTax } from "./tax";

describe("taxMinorOf (F118)", () => {
  it("adds 10% GST, rounded half up to a whole cent", () => {
    expect(taxMinorOf(4_500, 1_000)).toBe(450);
    expect(taxMinorOf(5, 1_000)).toBe(1); // 0.5 rounds up
    expect(taxMinorOf(4, 1_000)).toBe(0); // 0.4 rounds down
    expect(taxMinorOf(15, 1_000)).toBe(2); // 1.5 rounds up
  });

  it("adds nothing at a zero rate (Indonesia)", () => {
    expect(taxMinorOf(1_500_000, 0)).toBe(0);
  });

  it("stays exact past 2^53 when multiplied", () => {
    expect(taxMinorOf(90_000_000_000_005, 1_000)).toBe(9_000_000_000_001);
  });

  it("refuses fractional money and impossible rates", () => {
    expect(() => taxMinorOf(1.5, 1_000)).toThrow(RangeError);
    expect(() => taxMinorOf(-1, 1_000)).toThrow(RangeError);
    expect(() => taxMinorOf(100, 10_001)).toThrow(RangeError);
  });

  it("splits a subtotal into tax and total", () => {
    expect(withTax(4_500, 1_000)).toEqual({
      subtotalMinor: 4_500,
      taxMinor: 450,
      totalMinor: 4_950,
    });
  });
});
