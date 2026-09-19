import { describe, expect, it } from "vitest";
import { CURRENCY_CODES, isCurrency } from "./currency";
import {
  MINOR_UNIT,
  UnsettledMinorUnitError,
  assertUnitSettled,
  isUnitSettled,
  minorUnitExponent,
} from "./minor-unit";
import {
  CurrencyMismatchError,
  addMoney,
  compareMoney,
  fromLegacyAmount,
  money,
  moneySchema,
  subtractMoneyClamped,
  zeroMoney,
} from "./money-value";
import { formatMoney, formatMoneyValue } from "./money-format";
import { toIdrMinorUnits } from "./money";
import { REGION_CONFIG } from "../region/region";

describe("moneySchema", () => {
  it("round-trips an amount with its currency", () => {
    const parsed = moneySchema.parse({ amountMinor: 45_000, currency: "IDR" });
    expect(parsed.amountMinor).toBe(45_000);
    expect(parsed.currency).toBe("IDR");
  });

  const rejectionTable: Array<{ name: string; input: unknown }> = [
    { name: "a bare number with no currency", input: 45_000 },
    { name: "a missing currency", input: { amountMinor: 45_000 } },
    { name: "an unknown currency", input: { amountMinor: 45_000, currency: "USD" } },
    { name: "a lowercase currency", input: { amountMinor: 45_000, currency: "idr" } },
    { name: "a fractional amount", input: { amountMinor: 45_000.5, currency: "AUD" } },
    { name: "a negative amount", input: { amountMinor: -1, currency: "AUD" } },
    { name: "NaN", input: { amountMinor: Number.NaN, currency: "AUD" } },
    { name: "Infinity", input: { amountMinor: Number.POSITIVE_INFINITY, currency: "AUD" } },
    { name: "a stringified amount", input: { amountMinor: "45000", currency: "IDR" } },
    { name: "an amount over the ceiling", input: { amountMinor: 1e11, currency: "IDR" } },
    { name: "null", input: null },
  ];

  it.each(rejectionTable)("rejects $name", ({ input }) => {
    expect(moneySchema.safeParse(input).success).toBe(false);
  });
});

describe("currency-checked arithmetic", () => {
  it("adds two amounts in the same currency", () => {
    expect(addMoney(money(15_000, "IDR"), money(30_000, "IDR")).amountMinor).toBe(45_000);
  });

  it("clamps subtraction at zero", () => {
    expect(subtractMoneyClamped(money(10_000, "IDR"), money(30_000, "IDR")).amountMinor).toBe(0);
  });

  it("compares amounts in the same currency", () => {
    expect(compareMoney(money(10, "AUD"), money(4, "AUD"))).toBeGreaterThan(0);
    expect(compareMoney(money(4, "AUD"), money(4, "AUD"))).toBe(0);
  });

  it("starts at zero in a named currency", () => {
    expect(zeroMoney("AUD")).toStrictEqual(money(0, "AUD"));
  });

  // The whole point of the type. Before YT-0513 these two were both
  // `IdrMinorUnits` and adding them was a silent, well-typed mistake.
  const mixing: Array<{ name: string; run: () => unknown }> = [
    { name: "add", run: () => addMoney(money(1_000, "AUD"), money(1_000, "IDR")) },
    { name: "subtract", run: () => subtractMoneyClamped(money(1_000, "AUD"), money(1_000, "IDR")) },
    { name: "compare", run: () => compareMoney(money(1_000, "AUD"), money(1_000, "IDR")) },
  ];

  it.each(mixing)("refuses to $name across currencies", ({ run }) => {
    expect(run).toThrow(CurrencyMismatchError);
  });
});

describe("fromLegacyAmount", () => {
  // `region-mock-au-listing.ts` stores AUD cents in `faceValueIdr`. A
  // one-argument converter would have relabelled all of it as Rupiah with
  // the type system's blessing, so the currency is a required argument.
  it("tags a legacy amount with the currency the caller names", () => {
    const legacy = toIdrMinorUnits(1_250);
    expect(fromLegacyAmount(legacy, "AUD")).toStrictEqual(money(1_250, "AUD"));
    expect(fromLegacyAmount(legacy, "IDR")).toStrictEqual(money(1_250, "IDR"));
  });

  it("renders the same legacy integer differently once it is tagged", () => {
    const legacy = toIdrMinorUnits(1_250);
    expect(formatMoneyValue(fromLegacyAmount(legacy, "AUD"))).toContain("12.50");
    expect(formatMoneyValue(fromLegacyAmount(legacy, "IDR"))).toContain("1.250");
  });
});

describe("the minor-unit registry", () => {
  it("covers every currency and nothing else", () => {
    expect(Object.keys(MINOR_UNIT).sort()).toStrictEqual([...CURRENCY_CODES].sort());
  });

  // REGION_CONFIG is the source of truth for which currency a region uses.
  // If it ever names one this module does not know, formatting and
  // settlement would both fail on a real region rather than in a test.
  it("knows every currency a region is configured to use", () => {
    for (const config of Object.values(REGION_CONFIG)) {
      expect(isCurrency(config.currency)).toBe(true);
    }
  });

  it("treats AUD as settled two-decimal", () => {
    expect(MINOR_UNIT.AUD).toMatchObject({ exponent: 2, status: "confirmed" });
    expect(() => {
      assertUnitSettled("AUD", "settle");
    }).not.toThrow();
  });

  /**
   * Pairs with money.test.ts's "stores IDR as Rupiah, not sen, until YT-0506
   * settles". That test guards the behaviour; this one guards the admission
   * that the behaviour is unconfirmed. Whoever settles YT-0506 must move
   * both, which is the point — flipping the exponent to sen while leaving
   * the status `provisional` would be a decision nobody recorded.
   */
  it("still records IDR as provisional, pending YT-0506", () => {
    expect(MINOR_UNIT.IDR).toMatchObject({ exponent: 0, status: "provisional" });
    expect(isUnitSettled("IDR")).toBe(false);
    expect(MINOR_UNIT.IDR.evidence).toContain("YT-0506");
  });

  it("refuses to settle in a currency whose unit is unsettled", () => {
    expect(() => {
      assertUnitSettled("IDR", "settle a merchant payout");
    }).toThrow(UnsettledMinorUnitError);
  });

  it("names the operation and the currency when it refuses", () => {
    const refusal = captureRefusal(() => {
      assertUnitSettled("IDR", "settle a merchant payout");
    });
    expect(refusal).toBeInstanceOf(UnsettledMinorUnitError);
    expect(refusal?.currency).toBe("IDR");
    expect(refusal?.message).toContain("settle a merchant payout");
    expect(refusal?.message).toContain("YT-0506");
  });
});

function captureRefusal(run: () => void): UnsettledMinorUnitError | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof UnsettledMinorUnitError ? error : undefined;
  }
  return undefined;
}

describe("formatting derives its scale from the registry", () => {
  /**
   * YT-0513 replaced a hardcoded `/ 100` for AUD and a hardcoded literal
   * union with lookups. These assert the rendered output did not move — a
   * refactor that deduplicates knowledge must not also change what a user
   * sees, or the two changes become impossible to tell apart in a bug report.
   */
  it("renders AUD cents as dollars", () => {
    expect(formatMoney(toIdrMinorUnits(1_250), "AUD")).toContain("12.50");
  });

  it("renders IDR without decimals, undivided", () => {
    const rendered = formatMoney(toIdrMinorUnits(45_000), "IDR");
    expect(rendered).toContain("45.000");
  });

  it("scales by ten to the power of the declared exponent", () => {
    expect(minorUnitExponent("AUD")).toBe(2);
    expect(minorUnitExponent("IDR")).toBe(0);
  });
});

describe("isCurrency", () => {
  const table: Array<{ input: unknown; expected: boolean }> = [
    { input: "AUD", expected: true },
    { input: "IDR", expected: true },
    { input: "USD", expected: false },
    { input: "aud", expected: false },
    { input: "", expected: false },
    { input: null, expected: false },
    { input: 840, expected: false },
  ];

  it.each(table)("returns $expected for $input", ({ input, expected }) => {
    expect(isCurrency(input)).toBe(expected);
  });
});
