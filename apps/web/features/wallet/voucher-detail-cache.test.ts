import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoucherDetailSource } from "./voucher-detail-cache";
import {
  buildCachedVoucherDetail,
  readVoucherDetailCache,
  writeVoucherDetailCache,
} from "./voucher-detail-cache";

const sampleVoucher: VoucherDetailSource = {
  voucherId: "00000000-0000-4000-8000-000000000001",
  listingId: "00000000-0000-4000-8000-000000000002",
  state: "activated",
  merchantName: "Kopi Sentosa",
  title: "Kopi Sentosa AUD 10 voucher",
  currency: "AUD",
  faceValueMinor: 1000,
  remainingValueMinor: 1000,
  partialRedemptionPolicy: "balance_carrying",
  issuedAt: "2026-09-01T00:00:00.000Z",
  expiresAt: "2026-10-01T00:00:00.000Z",
  location: { name: "Kopi Sentosa CBD", address: "1 Main St", district: "CBD" },
};

describe("voucher-detail-cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a written voucher detail", () => {
    const detail = buildCachedVoucherDetail(sampleVoucher, "2026-09-19T09:00:00.000Z");
    writeVoucherDetailCache(detail);
    expect(readVoucherDetailCache(sampleVoucher.voucherId)).toEqual(detail);
  });

  it("never writes a redemption code — it must not be part of the source or the cached shape", () => {
    const detail = buildCachedVoucherDetail(sampleVoucher, "2026-09-19T09:00:00.000Z");
    expect(detail).not.toHaveProperty("code");
    writeVoucherDetailCache(detail);
    const raw = window.localStorage.getItem(`yourtal:wallet:voucher:${sampleVoucher.voucherId}`);
    expect(raw).not.toContain('"code"');
  });

  it("caches cleanly even when every optional display field is missing (today's live API shape)", () => {
    const bare: VoucherDetailSource = {
      voucherId: sampleVoucher.voucherId,
      listingId: sampleVoucher.listingId,
      state: "reserved",
    };
    const detail = buildCachedVoucherDetail(bare, "2026-09-19T09:00:00.000Z");
    writeVoucherDetailCache(detail);
    expect(readVoucherDetailCache(sampleVoucher.voucherId)).toEqual(detail);
  });

  it("returns null when nothing has been cached for this voucher id", () => {
    expect(readVoucherDetailCache("never-cached")).toBeNull();
  });

  it("keys separate vouchers under separate cache entries", () => {
    const detailA = buildCachedVoucherDetail(sampleVoucher, "2026-09-19T09:00:00.000Z");
    const otherVoucher: VoucherDetailSource = {
      ...sampleVoucher,
      voucherId: "00000000-0000-4000-8000-000000000999",
      merchantName: "Toko Berkah",
    };
    const detailB = buildCachedVoucherDetail(otherVoucher, "2026-09-19T09:00:00.000Z");

    writeVoucherDetailCache(detailA);
    writeVoucherDetailCache(detailB);

    expect(readVoucherDetailCache(sampleVoucher.voucherId)?.merchantName).toBe("Kopi Sentosa");
    expect(readVoucherDetailCache(otherVoucher.voucherId)?.merchantName).toBe("Toko Berkah");
  });

  it("treats a corrupted (non-JSON) stored value as no cached detail, never throwing", () => {
    window.localStorage.setItem(`yourtal:wallet:voucher:${sampleVoucher.voucherId}`, "{not json");
    expect(() => readVoucherDetailCache(sampleVoucher.voucherId)).not.toThrow();
    expect(readVoucherDetailCache(sampleVoucher.voucherId)).toBeNull();
  });

  it("treats a value that fails schema validation (wrong shape) as no cached detail", () => {
    window.localStorage.setItem(
      `yourtal:wallet:voucher:${sampleVoucher.voucherId}`,
      JSON.stringify({ voucherId: sampleVoucher.voucherId }),
    );
    expect(readVoucherDetailCache(sampleVoucher.voucherId)).toBeNull();
  });

  it("does not throw when localStorage.getItem itself throws (private-mode simulation)", () => {
    const spy = vi.spyOn(window.localStorage.__proto__, "getItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    expect(() => readVoucherDetailCache(sampleVoucher.voucherId)).not.toThrow();
    expect(readVoucherDetailCache(sampleVoucher.voucherId)).toBeNull();
    spy.mockRestore();
  });

  it("does not throw when localStorage.setItem itself throws (quota-exceeded simulation)", () => {
    const spy = vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const detail = buildCachedVoucherDetail(sampleVoucher, "2026-09-19T09:00:00.000Z");
    expect(() => writeVoucherDetailCache(detail)).not.toThrow();
    spy.mockRestore();
  });
});
