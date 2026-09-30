import { describe, expect, it } from "vitest";
import { inputFromMinor, minorFromInput } from "./money-input";

describe("boost money input", () => {
  it("parses dollars to exact cents and whole rupiah", () => {
    expect(minorFromInput("12.5", "AUD")).toBe(1250);
    expect(minorFromInput("0.01", "AUD")).toBe(1);
    expect(minorFromInput("5,000", "IDR")).toBe(5000);
    expect(minorFromInput("1.005", "AUD")).toBeNull();
    expect(minorFromInput("10.5", "IDR")).toBeNull();
    expect(minorFromInput("-3", "AUD")).toBeNull();
    expect(minorFromInput("0", "AUD")).toBeNull();
  });

  it("formats minor units back", () => {
    expect(inputFromMinor(1250, "AUD")).toBe("12.50");
    expect(inputFromMinor(5, "AUD")).toBe("0.05");
    expect(inputFromMinor(5000, "IDR")).toBe("5000");
  });
});
