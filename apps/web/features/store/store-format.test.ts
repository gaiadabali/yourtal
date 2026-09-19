import { describe, expect, it } from "vitest";
import { toIdrMinorUnits, toPoints } from "@yourtal/contracts/money";
import { formatExpiryDate, formatListingPrice, formatStockRemaining } from "./store-format";

describe("formatListingPrice", () => {
  it("formats the points price and the face value beside it", () => {
    const result = formatListingPrice(toPoints(2_500), toIdrMinorUnits(50_000));
    expect(result.pointsLabel).toContain("2.500");
    expect(result.faceValueLabel).toContain("Senilai");
    expect(result.faceValueLabel).toContain("Rp");
    expect(result.faceValueLabel).toContain("50.000");
  });
});

describe("formatExpiryDate", () => {
  it("formats an ISO instant as an absolute Indonesian date", () => {
    expect(formatExpiryDate("2026-09-19T12:00:00.000Z")).toMatch(/2026/);
  });
});

describe("formatStockRemaining", () => {
  it("shows the remaining count when stock is available", () => {
    expect(formatStockRemaining(12)).toBe("12 tersisa");
  });

  it("shows 'Habis' when stock is zero", () => {
    expect(formatStockRemaining(0)).toBe("Habis");
  });
});

describe("en-AU / AUD (YT-0405)", () => {
  it("formats the points price and AUD face value together", () => {
    const result = formatListingPrice(toPoints(2_500), toIdrMinorUnits(5_000), "en-AU", "AUD");
    expect(result.pointsLabel).toBe("2,500 points");
    expect(result.faceValueLabel).toBe("Worth $50.00");
  });

  it("formats stock remaining and sold-out in English", () => {
    expect(formatStockRemaining(12, "en-AU")).toBe("12 left");
    expect(formatStockRemaining(0, "en-AU")).toBe("Sold out");
  });

  it("formats the expiry date in en-AU", () => {
    expect(formatExpiryDate("2026-09-19T12:00:00.000Z", "en-AU")).toMatch(/2026/);
  });
});
