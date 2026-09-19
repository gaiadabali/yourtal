import { describe, expect, it } from "vitest";
import {
  classifyVoucherStatus,
  describeVoucherStatus,
  isVoucherEffectivelyExpired,
} from "./wallet-voucher-status-copy";

describe("isVoucherEffectivelyExpired", () => {
  it("is false before the expiry instant", () => {
    expect(
      isVoucherEffectivelyExpired(
        { expiresAt: "2026-09-19T10:00:00.000Z" },
        Date.parse("2026-09-19T09:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("is true at and after the expiry instant", () => {
    const expiresAtMs = Date.parse("2026-09-19T10:00:00.000Z");
    expect(
      isVoucherEffectivelyExpired({ expiresAt: "2026-09-19T10:00:00.000Z" }, expiresAtMs),
    ).toBe(true);
    expect(
      isVoucherEffectivelyExpired({ expiresAt: "2026-09-19T10:00:00.000Z" }, expiresAtMs + 1),
    ).toBe(true);
  });
});

describe("describeVoucherStatus", () => {
  it("labels a redeemed voucher as archived and used", () => {
    const copy = describeVoucherStatus("redeemed", false);
    expect(copy.label).toBe("Sudah dipakai");
    expect(copy.isArchived).toBe(true);
  });

  it("labels a transferred voucher as archived", () => {
    const copy = describeVoucherStatus("transferred", false);
    expect(copy.isArchived).toBe(true);
  });

  it("labels an expired-status voucher as archived and expired", () => {
    const copy = describeVoucherStatus("expired", false);
    expect(copy.label).toBe("Kedaluwarsa");
    expect(copy.isArchived).toBe(true);
  });

  it("treats an 'active'-status voucher as archived once it is effectively expired by wall-clock time", () => {
    const copy = describeVoucherStatus("active", true);
    expect(copy.label).toBe("Kedaluwarsa");
    expect(copy.isArchived).toBe(true);
  });

  it("labels a live active voucher as not archived", () => {
    const copy = describeVoucherStatus("active", false);
    expect(copy.label).toBe("Aktif");
    expect(copy.isArchived).toBe(false);
  });
});

describe("describeVoucherStatus (en-AU, YT-0405)", () => {
  it("labels every status in English", () => {
    expect(describeVoucherStatus("redeemed", false, "en-AU").label).toBe("Redeemed");
    expect(describeVoucherStatus("transferred", false, "en-AU").label).toBe("Transferred");
    expect(describeVoucherStatus("expired", false, "en-AU").label).toBe("Expired");
    expect(describeVoucherStatus("active", false, "en-AU").label).toBe("Active");
  });
});

/**
 * `classifyVoucherStatus` is the translation-free half `voucher-detail-view.tsx`
 * (a Client Component) uses instead of `describeVoucherStatus` — see that
 * function's doc comment for why (YT-0405: avoids shipping both locales'
 * `wallet` catalogue to the client).
 */
describe("classifyVoucherStatus", () => {
  it("classifies every status kind and badge variant without producing any label", () => {
    expect(classifyVoucherStatus("redeemed", false)).toEqual({
      kind: "redeemed",
      badgeVariant: "secondary",
      isArchived: true,
    });
    expect(classifyVoucherStatus("transferred", false)).toEqual({
      kind: "transferred",
      badgeVariant: "outline",
      isArchived: true,
    });
    expect(classifyVoucherStatus("expired", false)).toEqual({
      kind: "expired",
      badgeVariant: "danger",
      isArchived: true,
    });
    expect(classifyVoucherStatus("active", false)).toEqual({
      kind: "active",
      badgeVariant: "success",
      isArchived: false,
    });
  });

  it("treats an 'active'-status voucher as expired once it is effectively expired by wall-clock time", () => {
    expect(classifyVoucherStatus("active", true).kind).toBe("expired");
  });
});
