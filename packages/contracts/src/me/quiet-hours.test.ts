import { describe, expect, it } from "vitest";
import { isQuietHours } from "./quiet-hours";

describe("isQuietHours", () => {
  it("is false just before 21:00 and true from 21:00 in Australia/Sydney", () => {
    // AEST (UTC+10) in July: 20:59 local = 10:59Z, 21:00 local = 11:00Z.
    expect(isQuietHours(new Date("2026-07-01T10:59:00.000Z"), "Australia/Sydney")).toBe(false);
    expect(isQuietHours(new Date("2026-07-01T11:00:00.000Z"), "Australia/Sydney")).toBe(true);
  });

  it("stays true through midnight and clears at 07:00 local", () => {
    expect(isQuietHours(new Date("2026-07-01T14:00:00.000Z"), "Australia/Sydney")).toBe(true); // 00:00 local
    expect(isQuietHours(new Date("2026-07-01T20:59:00.000Z"), "Australia/Sydney")).toBe(true); // 06:59 local
    expect(isQuietHours(new Date("2026-07-01T21:00:00.000Z"), "Australia/Sydney")).toBe(false); // 07:00 local
  });

  it("uses the profile's own timezone, not UTC or the region default", () => {
    // Asia/Jakarta is UTC+7 with no DST: 21:00 local = 14:00Z.
    expect(isQuietHours(new Date("2026-07-01T14:00:00.000Z"), "Asia/Jakarta")).toBe(true);
    expect(isQuietHours(new Date("2026-07-01T13:59:00.000Z"), "Asia/Jakarta")).toBe(false);
  });
});
