import { describe, expect, it } from "vitest";
// Formatting lives in money-format.ts (dependency-free, one implementation).
import { formatIdr, formatPoints } from "./money-format";
import {
  addIdr,
  rupiah,
  addPoints,
  idrMinorUnitsSchema,
  pointsPriceFromSettlement,
  pointsSchema,
  subtractIdrClamped,
  subtractPointsClamped,
  toIdrMinorUnits,
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
    const a = toIdrMinorUnits(15_000);
    const b = toIdrMinorUnits(30_000);
    expect(addIdr(a, b)).toBe(45_000);
  });

  it("clamps IDR subtraction at zero", () => {
    const a = toIdrMinorUnits(10_000);
    const b = toIdrMinorUnits(30_000);
    expect(subtractIdrClamped(a, b)).toBe(0);
  });

  it("adds points", () => {
    expect(addPoints(toPoints(100), toPoints(50))).toBe(150);
  });

  it("clamps point subtraction at zero", () => {
    expect(subtractPointsClamped(toPoints(10), toPoints(50))).toBe(0);
  });

  it("computes a points price from a settlement value and backing rate", () => {
    // docs/09 4.1 worked example in sen: S = Rp 12.000, B = 600 sen/point ->
    // 2,000 points. Both sides of the division moved together, which is the
    // whole discipline YT-0506 is about.
    const settlement = rupiah(12_000);
    expect(pointsPriceFromSettlement(settlement, 600)).toBe(2_000);
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
  it("stores IDR as sen, settled by YT-0506", () => {
    expect(rupiah(45_000)).toBe(4_500_000);
    // Rp 45.000 renders exactly as it always did, because the formatter takes
    // its scale from MINOR_UNIT rather than from a literal.
    expect(formatIdr(rupiah(45_000))).toContain("45.000");
    // ...while the raw integer that USED to mean Rp 45.000 is now Rp 450.
    expect(formatIdr(toIdrMinorUnits(45_000))).toContain("450");
  });

  it("formats points with the Indonesian word for points", () => {
    expect(formatPoints(toPoints(2_400))).toBe("2.400 poin");
  });
});

describe("determinism", () => {
  it("parsing the same input twice yields deep-equal, byte-identical branded values", () => {
    const first = { idr: toIdrMinorUnits(45_000), points: toPoints(2_400) };
    const second = { idr: toIdrMinorUnits(45_000), points: toPoints(2_400) };
    expect(first).toStrictEqual(second);
  });
});
