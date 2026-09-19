import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Voucher } from "@yourtal/contracts/voucher";
import { expiredVoucherFixture } from "@yourtal/contracts/voucher/mock";
import { buildCachedVoucherDetail, readVoucherDetailCache, writeVoucherDetailCache } from "./voucher-detail-cache";

const sampleVoucher: Voucher = expiredVoucherFixture;

describe("voucher-detail-cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a written voucher detail", () => {
    const detail = buildCachedVoucherDetail(sampleVoucher, "Tunjukkan kode ini ke kasir.", "2026-09-19T09:00:00.000Z");
    writeVoucherDetailCache(detail);
    expect(readVoucherDetailCache(sampleVoucher.id)).toEqual(detail);
  });

  it("returns null when nothing has been cached for this voucher id", () => {
    expect(readVoucherDetailCache("never-cached")).toBeNull();
  });

  it("keys separate vouchers under separate cache entries", () => {
    const detailA = buildCachedVoucherDetail(sampleVoucher, "Instruksi A", "2026-09-19T09:00:00.000Z");
    const otherVoucher: Voucher = { ...sampleVoucher, id: "00000000-0000-4000-8000-000000000999" };
    const detailB = buildCachedVoucherDetail(otherVoucher, "Instruksi B", "2026-09-19T09:00:00.000Z");

    writeVoucherDetailCache(detailA);
    writeVoucherDetailCache(detailB);

    expect(readVoucherDetailCache(sampleVoucher.id)?.redemptionInstructions).toBe("Instruksi A");
    expect(readVoucherDetailCache(otherVoucher.id)?.redemptionInstructions).toBe("Instruksi B");
  });

  it("treats a corrupted (non-JSON) stored value as no cached detail, never throwing", () => {
    window.localStorage.setItem(`yourtal:wallet:voucher:${sampleVoucher.id}`, "{not json");
    expect(() => readVoucherDetailCache(sampleVoucher.id)).not.toThrow();
    expect(readVoucherDetailCache(sampleVoucher.id)).toBeNull();
  });

  it("treats a value that fails schema validation (wrong shape) as no cached detail", () => {
    window.localStorage.setItem(`yourtal:wallet:voucher:${sampleVoucher.id}`, JSON.stringify({ id: sampleVoucher.id }));
    expect(readVoucherDetailCache(sampleVoucher.id)).toBeNull();
  });

  it("does not throw when localStorage.getItem itself throws (private-mode simulation)", () => {
    const spy = vi.spyOn(window.localStorage.__proto__, "getItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    expect(() => readVoucherDetailCache(sampleVoucher.id)).not.toThrow();
    expect(readVoucherDetailCache(sampleVoucher.id)).toBeNull();
    spy.mockRestore();
  });

  it("does not throw when localStorage.setItem itself throws (quota-exceeded simulation)", () => {
    const spy = vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const detail = buildCachedVoucherDetail(sampleVoucher, "Instruksi", "2026-09-19T09:00:00.000Z");
    expect(() => writeVoucherDetailCache(detail)).not.toThrow();
    spy.mockRestore();
  });
});
