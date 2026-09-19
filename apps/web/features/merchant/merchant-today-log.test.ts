import { beforeEach, describe, expect, it } from "vitest";
import type { MerchantLogEntry } from "./merchant-today-log";
import {
  confirmedRunningTotal,
  dayKeyFor,
  effectiveRemainingValue,
  pendingEntries,
  readTodayLog,
  writeTodayLog,
} from "./merchant-today-log";

function makeEntry(overrides: Partial<MerchantLogEntry> = {}): MerchantLogEntry {
  return {
    id: "entry-1",
    voucherId: "voucher-1",
    voucherCode: "ABC12345",
    merchantName: "Toko Berkah",
    amountMinor: 10_000,
    status: "confirmed",
    createdAt: "2026-09-19T09:00:00.000Z",
    confirmedAt: "2026-09-19T09:00:01.000Z",
    failureReason: null,
    ...overrides,
  };
}

describe("dayKeyFor", () => {
  it("returns the UTC date slice", () => {
    expect(dayKeyFor(Date.parse("2026-09-19T23:59:59.000Z"))).toBe("2026-09-19");
    expect(dayKeyFor(Date.parse("2026-09-20T00:00:00.000Z"))).toBe("2026-09-20");
  });
});

describe("localStorage persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips entries written for a device and day", () => {
    const entries = [makeEntry()];
    writeTodayLog("device-1", "2026-09-19", entries);
    expect(readTodayLog("device-1", "2026-09-19")).toEqual(entries);
  });

  it("returns [] for a device/day with nothing written", () => {
    expect(readTodayLog("device-1", "2026-09-19")).toEqual([]);
  });

  it("scopes storage per device — one device's log never leaks into another's", () => {
    writeTodayLog("device-1", "2026-09-19", [makeEntry({ id: "a" })]);
    writeTodayLog("device-2", "2026-09-19", [makeEntry({ id: "b" })]);
    expect(readTodayLog("device-1", "2026-09-19").map((entry) => entry.id)).toEqual(["a"]);
    expect(readTodayLog("device-2", "2026-09-19").map((entry) => entry.id)).toEqual(["b"]);
  });

  it("never throws and returns [] for tampered, schema-invalid storage", () => {
    window.localStorage.setItem(
      "yourtal:merchant:today-log:device-1:2026-09-19",
      "{not valid json",
    );
    expect(readTodayLog("device-1", "2026-09-19")).toEqual([]);

    window.localStorage.setItem(
      "yourtal:merchant:today-log:device-1:2026-09-19",
      JSON.stringify([{ nonsense: true }]),
    );
    expect(readTodayLog("device-1", "2026-09-19")).toEqual([]);
  });
});

describe("effectiveRemainingValue", () => {
  it("returns the full remaining value when nothing has been captured or queued today", () => {
    expect(effectiveRemainingValue([], "voucher-1", 50_000)).toBe(50_000);
  });

  it("subtracts confirmed and pending amounts for the same voucher", () => {
    const entries = [
      makeEntry({ voucherId: "voucher-1", amountMinor: 10_000, status: "confirmed" }),
      makeEntry({ id: "entry-2", voucherId: "voucher-1", amountMinor: 5_000, status: "pending" }),
    ];
    expect(effectiveRemainingValue(entries, "voucher-1", 50_000)).toBe(35_000);
  });

  it("ignores failed entries — a failed attempt never reduces what is still spendable", () => {
    const entries = [makeEntry({ voucherId: "voucher-1", amountMinor: 40_000, status: "failed" })];
    expect(effectiveRemainingValue(entries, "voucher-1", 50_000)).toBe(50_000);
  });

  it("ignores entries for a different voucher", () => {
    const entries = [
      makeEntry({ voucherId: "other-voucher", amountMinor: 40_000, status: "confirmed" }),
    ];
    expect(effectiveRemainingValue(entries, "voucher-1", 50_000)).toBe(50_000);
  });

  it("never goes negative even if committed exceeds the stated remaining value", () => {
    const entries = [
      makeEntry({ voucherId: "voucher-1", amountMinor: 60_000, status: "confirmed" }),
    ];
    expect(effectiveRemainingValue(entries, "voucher-1", 50_000)).toBe(0);
  });
});

describe("confirmedRunningTotal", () => {
  it("sums only confirmed entries, never pending or failed", () => {
    const entries = [
      makeEntry({ amountMinor: 10_000, status: "confirmed" }),
      makeEntry({ id: "b", amountMinor: 20_000, status: "confirmed" }),
      makeEntry({ id: "c", amountMinor: 5_000, status: "pending" }),
      makeEntry({ id: "d", amountMinor: 7_000, status: "failed" }),
    ];
    expect(confirmedRunningTotal(entries)).toBe(30_000);
  });
});

describe("pendingEntries", () => {
  it("returns only entries with status pending", () => {
    const entries = [
      makeEntry({ id: "a", status: "confirmed" }),
      makeEntry({ id: "b", status: "pending" }),
      makeEntry({ id: "c", status: "failed" }),
    ];
    expect(pendingEntries(entries).map((entry) => entry.id)).toEqual(["b"]);
  });
});
