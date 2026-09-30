import { describe, expect, it } from "vitest";
import { minorToBidInput, parseBidToMinor } from "./bid-amount";

describe("bid amounts (13.22.b)", () => {
  it("reads AUD exactly, cents and all", () => {
    expect(parseBidToMinor("12.5", "AUD")).toBe(1250);
    expect(parseBidToMinor("12.05", "AUD")).toBe(1205);
    expect(parseBidToMinor("1,012.99", "AUD")).toBe(101299);
    expect(parseBidToMinor("0.1", "AUD")).toBe(10);
    expect(parseBidToMinor("12.345", "AUD")).toBeNull();
    expect(parseBidToMinor("-3", "AUD")).toBeNull();
    expect(parseBidToMinor("abc", "AUD")).toBeNull();
  });

  it("reads IDR as whole rupiah, with thousands marks", () => {
    expect(parseBidToMinor("25.000", "IDR")).toBe(25000);
    expect(parseBidToMinor("25000", "IDR")).toBe(25000);
    expect(parseBidToMinor("1,250,000", "IDR")).toBe(1250000);
    expect(parseBidToMinor("12,5x", "IDR")).toBeNull();
  });

  it("round-trips the minimum next bid", () => {
    expect(minorToBidInput(1205, "AUD")).toBe("12.05");
    expect(parseBidToMinor(minorToBidInput(99999, "AUD"), "AUD")).toBe(99999);
    expect(minorToBidInput(25000, "IDR")).toBe("25000");
  });
});
