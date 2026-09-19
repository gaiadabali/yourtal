import { describe, expect, it } from "vitest";
import {
  addIdr,
  addPoints,
  formatIdr,
  formatPoints,
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
    const parsed = idrMinorUnitsSchema.parse(45_000);
    expect(parsed).toBe(45_000);
  });

  const rejectionTable: Array<{ name: string; input: unknown }> = [
    { name: "negative amount", input: -1 },
    { name: "fractional amount", input: 45_000.5 },
    { name: "NaN", input: Number.NaN },
    { name: "Infinity", input: Number.POSITIVE_INFINITY },
    { name: "string instead of number", input: "45000" },
    { name: "null", input: null },
    { name: "undefined", input: undefined },
    { name: "boolean", input: true },
    { name: "object", input: { amount: 45_000 } },
    { name: "amount over the sane ceiling", input: 100_000_000_000 },
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
    // docs/09 section 4.1 worked example: S = 12,000, B = 6 -> 2,000 points
    const settlement = toIdrMinorUnits(12_000);
    expect(pointsPriceFromSettlement(settlement, 6)).toBe(2_000);
  });

  it("rejects a non-positive backing rate", () => {
    expect(() => pointsPriceFromSettlement(toIdrMinorUnits(12_000), 0)).toThrow();
  });
});

describe("formatting", () => {
  it("formats IDR with the Rupiah symbol and no decimals", () => {
    const formatted = formatIdr(toIdrMinorUnits(45_000));
    expect(formatted).toContain("45.000");
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
