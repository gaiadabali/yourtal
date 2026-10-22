import { describe, expect, it, vi } from "vitest";
import { rupiah, toPoints } from "@yourtal/contracts/money";
import { formatExpiryDate, formatListingPrice, formatStockRemaining } from "./store-format";
import { audCents } from "@yourtal/contracts/money/value";

describe("formatListingPrice", () => {
  it("formats the points price and the face value beside it", () => {
    const result = formatListingPrice(toPoints(2_500), rupiah(50_000), "id-ID", "IDR");
    expect(result.pointsLabel).toContain("2.500");
    expect(result.faceValueLabel).toContain("Senilai");
    expect(result.faceValueLabel).toContain("Rp");
    expect(result.faceValueLabel).toContain("50.000");
  });
});

describe("formatExpiryDate", () => {
  it("formats an ISO instant as an absolute Indonesian date", () => {
    expect(formatExpiryDate("2026-09-19T12:00:00.000Z", "id-ID", "ID")).toMatch(/2026/);
  });
});

describe("formatStockRemaining", () => {
  it("shows the remaining count when stock is available", () => {
    expect(formatStockRemaining(12, "id-ID")).toBe("12 tersisa");
  });

  it("shows 'Habis' when stock is zero", () => {
    expect(formatStockRemaining(0, "id-ID")).toBe("Habis");
  });
});

describe("en-AU / AUD (YT-0405)", () => {
  it("formats the points price and AUD face value together", () => {
    const result = formatListingPrice(toPoints(2_500), audCents(5_000), "en-AU", "AUD");
    expect(result.pointsLabel).toBe("2,500 points");
    expect(result.faceValueLabel).toBe("Worth $50.00");
  });

  it("writes an AUD face value the Indonesian way in Indonesian prose, never as a bare $", () => {
    const result = formatListingPrice(toPoints(2_500), audCents(5_000), "id-ID", "AUD");
    expect(result.faceValueLabel).toBe("Senilai AU$50,00");
  });

  it("formats stock remaining and sold-out in English", () => {
    expect(formatStockRemaining(12, "en-AU")).toBe("12 left");
    expect(formatStockRemaining(0, "en-AU")).toBe("Sold out");
  });

  it("formats the expiry date in en-AU", () => {
    expect(formatExpiryDate("2026-09-19T12:00:00.000Z", "en-AU", "AU")).toMatch(/2026/);
  });
});

describe("formatExpiryDate writes the listing's own region's clock", () => {
  // 16:30 UTC on the 19th is 02:30 on the 20th in Sydney (UTC+10, no DST yet in September)
  // and 23:30 on the 19th in Jakarta: both differ from UTC's 19th 16:30.
  it("shows Sydney's day and hour for an AU listing, whatever the machine's zone", () => {
    vi.stubEnv("TZ", "UTC");
    const out = formatExpiryDate("2026-09-19T16:30:00.000Z", "en-AU", "AU");
    expect(out).toMatch(/^20 Sept 2026, 2:30\s?am$/i);
    vi.unstubAllEnvs();
  });

  it("shows Jakarta's day and hour for an ID listing, in Indonesian", () => {
    vi.stubEnv("TZ", "UTC");
    const out = formatExpiryDate("2026-09-19T17:30:00.000Z", "id-ID", "ID");
    expect(out).toContain("20 Sep 2026");
    expect(out).toContain("00.30");
    vi.unstubAllEnvs();
  });
});
