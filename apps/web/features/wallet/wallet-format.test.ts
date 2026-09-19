import { describe, expect, it } from "vitest";
import { formatRelativeToNow, formatWalletDate } from "./wallet-format";

describe("formatWalletDate", () => {
  it("formats an ISO instant as a short Indonesian date", () => {
    expect(formatWalletDate("2026-09-19T09:00:00.000Z")).toMatch(/2026/);
  });
});

describe("formatRelativeToNow", () => {
  const nowMs = Date.parse("2026-09-19T09:00:00.000Z");

  it("reads in days for a date several days in the future", () => {
    const threeDaysLater = new Date(nowMs + 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeToNow(threeDaysLater, nowMs)).toMatch(/3 hari/);
  });

  it("reads in hours for a date less than a day away", () => {
    const fiveHoursLater = new Date(nowMs + 5 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeToNow(fiveHoursLater, nowMs)).toMatch(/5 jam/);
  });

  it("reads in minutes for a date less than an hour away", () => {
    const fortyFiveMinutesLater = new Date(nowMs + 45 * 60 * 1000).toISOString();
    expect(formatRelativeToNow(fortyFiveMinutesLater, nowMs)).toMatch(/45 menit/);
  });

  it("reads as past when the instant has already happened", () => {
    const twoDaysAgo = new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeToNow(twoDaysAgo, nowMs)).toMatch(/lalu/);
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
