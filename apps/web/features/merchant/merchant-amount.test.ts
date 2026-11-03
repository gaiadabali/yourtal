import { describe, expect, it } from "vitest";
import { currencyExponent, formatAmountForInput, parseAmountInput } from "./merchant-amount";

const ok = (amountMinor: number) => ({ ok: true, amountMinor });
const refused = (reason: string) => ({ ok: false, reason });

describe("parseAmountInput: AUD in dollars to exact cents", () => {
  it.each([
    ["4.5", 450],
    ["4.50", 450],
    ["4", 400],
    ["0.05", 5],
    [".5", 50],
    ["4.", 400],
    ["10.00", 1000],
    ["1,000.50", 100_050],
    ["  4.50  ", 450],
    ["4.500", 450],
    // The float traps: 1.15 * 100 is 114.99999999999999, 0.29 * 100 is 28.999999999999996.
    ["1.15", 115],
    ["0.29", 29],
    ["19.99", 1999],
  ])("reads %j as %i cents", (typed, cents) => {
    expect(parseAmountInput(typed, "AUD", "en-AU")).toEqual(ok(cents));
  });

  it("reads zero as zero (the caller refuses it as 'not above zero')", () => {
    expect(parseAmountInput("0", "AUD", "en-AU")).toEqual(ok(0));
    expect(parseAmountInput("0.00", "AUD", "en-AU")).toEqual(ok(0));
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["abc", "invalid"],
    ["-4", "invalid"],
    ["1e3", "invalid"],
    ["4.5.0", "invalid"],
    ["$4.50", "invalid"],
    ["4,50", "invalid"],
    ["1,00", "invalid"],
    [".", "invalid"],
    ["4.505", "too_precise"],
    ["4.501", "too_precise"],
    ["1234567890123", "invalid"],
  ])("refuses %j as %s", (typed, reason) => {
    expect(parseAmountInput(typed, "AUD", "en-AU")).toEqual(refused(reason));
  });
});

describe("parseAmountInput: IDR is whole rupiah", () => {
  it.each([
    ["25000", 25_000],
    ["25.000", 25_000],
    ["1.250.000", 1_250_000],
    ["25.000,00", 25_000],
    ["0", 0],
  ])("reads %j as %i rupiah on an id-ID counter", (typed, rupiah) => {
    expect(parseAmountInput(typed, "IDR", "id-ID")).toEqual(ok(rupiah));
  });

  it("reads the en-AU grouping too when the device is en-AU", () => {
    expect(parseAmountInput("25,000", "IDR", "en-AU")).toEqual(ok(25_000));
  });

  it.each(["250,5", "250,50", "25.0000", "25.00"])("refuses %j", (typed) => {
    // "25.00" in id-ID is a misplaced group separator, not 25 rupiah.
    expect(parseAmountInput(typed, "IDR", "id-ID").ok).toBe(false);
  });

  it("treats a decimal comma on an AUD amount in id-ID as the decimal point", () => {
    expect(parseAmountInput("4,50", "AUD", "id-ID")).toEqual(ok(450));
    expect(parseAmountInput("1.000,50", "AUD", "id-ID")).toEqual(ok(100_050));
  });
});

describe("formatAmountForInput", () => {
  it("writes cents as dollars in the device's decimal style and rupiah as plain digits", () => {
    expect(formatAmountForInput(450, "AUD", "en-AU")).toBe("4.50");
    expect(formatAmountForInput(5, "AUD", "en-AU")).toBe("0.05");
    expect(formatAmountForInput(0, "AUD", "en-AU")).toBe("0.00");
    expect(formatAmountForInput(450, "AUD", "id-ID")).toBe("4,50");
    expect(formatAmountForInput(25_000, "IDR", "id-ID")).toBe("25000");
    expect(formatAmountForInput(0, "IDR", "id-ID")).toBe("0");
  });

  it("round-trips through the parser", () => {
    for (const cents of [0, 1, 99, 100, 450, 123_456]) {
      const text = formatAmountForInput(cents, "AUD", "en-AU");
      expect(parseAmountInput(text, "AUD", "en-AU")).toEqual(ok(cents));
    }
  });
});

describe("currencyExponent", () => {
  it("AUD has cents, IDR has no minor unit", () => {
    expect(currencyExponent("AUD")).toBe(2);
    expect(currencyExponent("IDR")).toBe(0);
  });
});
