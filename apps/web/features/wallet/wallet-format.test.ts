import { describe, expect, it } from "vitest";
import { formatRelativeToNow, formatShortDate, formatWalletDate } from "./wallet-format";

describe("formatWalletDate", () => {
  it("formats an ISO instant as a short Indonesian date", () => {
    expect(formatWalletDate("2026-09-19T09:00:00.000Z", "id-ID")).toMatch(/2026/);
  });
});

describe("formatRelativeToNow", () => {
  const nowMs = Date.parse("2026-09-19T09:00:00.000Z");

  it("reads in days for a date several days in the future", () => {
    const threeDaysLater = new Date(nowMs + 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeToNow(threeDaysLater, nowMs, "id-ID")).toMatch(/3 hari/);
  });

  it("reads in hours for a date less than a day away", () => {
    const fiveHoursLater = new Date(nowMs + 5 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeToNow(fiveHoursLater, nowMs, "id-ID")).toMatch(/5 jam/);
  });

  it("reads in minutes for a date less than an hour away", () => {
    const fortyFiveMinutesLater = new Date(nowMs + 45 * 60 * 1000).toISOString();
    expect(formatRelativeToNow(fortyFiveMinutesLater, nowMs, "id-ID")).toMatch(/45 menit/);
  });

  it("reads as past when the instant has already happened", () => {
    const twoDaysAgo = new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeToNow(twoDaysAgo, nowMs, "id-ID")).toMatch(/lalu/);
  });
});

describe("en-AU locale (YT-0405)", () => {
  const nowMs = Date.parse("2026-09-19T09:00:00.000Z");

  it("formats the wallet date in en-AU", () => {
    expect(formatWalletDate("2026-09-19T09:00:00.000Z", "en-AU")).toMatch(/2026/);
  });

  it("reads relative time in English, driven by Intl, not a hardcoded word list", () => {
    const threeDaysLater = new Date(nowMs + 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeToNow(threeDaysLater, nowMs, "en-AU")).toBe("in 3 days");

    const twoDaysAgo = new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeToNow(twoDaysAgo, nowMs, "en-AU")).toMatch(/ago$/);
  });
});

describe("formatShortDate (13.15.d)", () => {
  const nowMs = Date.parse("2026-09-19T09:00:00.000Z");

  it("leaves the year off a date in the current year", () => {
    expect(formatShortDate("2026-10-01T09:00:00.000Z", "en-AU", nowMs)).toBe("1 Oct");
    expect(formatShortDate("2026-10-01T09:00:00.000Z", "id-ID", nowMs)).not.toMatch(/2026/);
  });

  it("adds the year to a date in another year", () => {
    expect(formatShortDate("2027-10-01T09:00:00.000Z", "en-AU", nowMs)).toBe("1 Oct 2027");
    expect(formatShortDate("2027-10-01T09:00:00.000Z", "id-ID", nowMs)).toMatch(/1 Okt 2027/);
    expect(formatShortDate("2025-12-31T09:00:00.000Z", "en-AU", nowMs)).toMatch(/2025/);
  });

  it("judges the year in the region's zone, not UTC", () => {
    // 31 Dec 2026 18:00 UTC is already 1 Jan 2027 in Sydney.
    expect(formatShortDate("2026-12-31T18:00:00.000Z", "en-AU", nowMs)).toBe("1 Jan 2027");
  });
});
