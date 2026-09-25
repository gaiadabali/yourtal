import { describe, expect, it } from "vitest";
// Formatting lives in money-format.ts (dependency-free, one implementation).
import { formatIdr, formatPoints, formatPointsIn } from "./money-format";
import {
  addIdr,
  rupiah,
  addPoints,
  idrMinorUnitsSchema,
  pointsPriceFromSettlement,
  pointsSchema,
  subtractIdrClamped,
  subtractPointsClamped,
  toMinorUnits,
  toPoints,
} from "./money";

describe("idrMinorUnitsSchema", () => {
  it("round-trips a valid amount", () => {
    const parsed = idrMinorUnitsSchema.parse(4_500_000);
    expect(parsed).toBe(4_500_000);
  });

  const rejectionTable: Array<{ name: string; input: unknown }> = [
    { name: "negative amount", input: -1 },
    { name: "fractional amount", input: 4_500_000.5 },
    { name: "NaN", input: Number.NaN },
    { name: "Infinity", input: Number.POSITIVE_INFINITY },
    { name: "string instead of number", input: "45000" },
    { name: "null", input: null },
    { name: "undefined", input: undefined },
    { name: "boolean", input: true },
    { name: "object", input: { amount: 45_000 } },
    { name: "amount over the sane ceiling", input: 10_000_000_000_000 },
  ];

  it.each(rejectionTable)("rejects $name", ({ input }) => {
    expect(idrMinorUnitsSchema.safeParse(input).success).toBe(false);
  });
});

describe("pointsSchema", () => {
  it("round-trips a valid amount", () => {
    expect(pointsSchema.parse(2_400)).toBe(2_400);
  });

  const rejectionTable: Array<{ name: string; input: unknown }> = [
    { name: "negative points", input: -50 },
    { name: "fractional points", input: 10.5 },
    { name: "NaN", input: Number.NaN },
    { name: "string instead of number", input: "2400" },
    { name: "null", input: null },
    { name: "array", input: [2_400] },
  ];

  it.each(rejectionTable)("rejects $name", ({ input }) => {
    expect(pointsSchema.safeParse(input).success).toBe(false);
  });
});

describe("arithmetic helpers", () => {
  it("adds IDR amounts without floating point drift", () => {
    const a = toMinorUnits(15_000);
    const b = toMinorUnits(30_000);
    expect(addIdr(a, b)).toBe(45_000);
  });

  it("clamps IDR subtraction at zero", () => {
    const a = toMinorUnits(10_000);
    const b = toMinorUnits(30_000);
    expect(subtractIdrClamped(a, b)).toBe(0);
  });

  it("adds points", () => {
    expect(addPoints(toPoints(100), toPoints(50))).toBe(150);
  });

  it("clamps point subtraction at zero", () => {
    expect(subtractPointsClamped(toPoints(10), toPoints(50))).toBe(0);
  });

  it("computes a points price from a settlement value and backing rate", () => {
    // docs/09 4.1: S = Rp 12.000, B = Rp 6/point -> 2,000 points. Both sides
    // share the stored unit, whole Rupiah.
    expect(pointsPriceFromSettlement(rupiah(12_000), 6)).toBe(2_000);
    expect(pointsPriceFromSettlement(rupiah(54_000), 6)).toBe(9_000);
  });

  it("rounds a points price up, never below its backing", () => {
    expect(pointsPriceFromSettlement(rupiah(12_001), 6)).toBe(2_001);
    expect(pointsPriceFromSettlement(rupiah(12_005), 6)).toBe(2_001);
  });

  it("rejects a fractional backing rate", () => {
    expect(() => pointsPriceFromSettlement(rupiah(12_000), 4.5)).toThrow();
  });

  it("rejects a non-positive backing rate", () => {
    expect(() => pointsPriceFromSettlement(rupiah(12_000), 0)).toThrow();
  });
});

describe("formatting", () => {
  it("formats a whole-Rupiah amount with no decimals", () => {
    expect(formatIdr(rupiah(45_000))).toContain("45.000");
  });

  /**
   * The inverse of the guard this replaces.
   *
   * That guard read "stores IDR as Rupiah, not sen, until YT-0506 settles",
   * and it did its job: it held the unit still while nobody had the authority
   * to set it, and it failed the moment this migration moved. The founder
   * settled on sen on 2026-09-20, so the assertion turns over rather than
   * being deleted — the risk it covers did not go away, it reversed.
   *
   * A bare `45_000` reaching a money field now means Rp 450, not Rp 45.000.
   * That is the same 100x error pointing the other way.
   */
  it("stores IDR in whole Rupiah, decision T-1", () => {
    expect(rupiah(45_000)).toBe(45_000);
    expect(formatIdr(rupiah(45_000))).toContain("45.000");
    expect(() => rupiah(45_000.5)).toThrow();
  });

  it("formats points with the Indonesian word for points", () => {
    expect(formatPointsIn("id-ID", toPoints(2_400))).toBe("2.400 poin");
  });

  it("formatPoints (deprecated) defaults to en-AU (0.5.a, 1.7.d)", () => {
    expect(formatPoints(toPoints(2_400))).toBe("2,400 points");
  });
});

describe("determinism", () => {
  it("parsing the same input twice yields deep-equal, byte-identical branded values", () => {
    const first = { idr: toMinorUnits(45_000), points: toPoints(2_400) };
    const second = { idr: toMinorUnits(45_000), points: toPoints(2_400) };
    expect(first).toStrictEqual(second);
  });
});
