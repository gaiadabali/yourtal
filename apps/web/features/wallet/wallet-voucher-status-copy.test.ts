import { describe, expect, it } from "vitest";
import {
  classifyVoucherStatus,
  describeVoucherStatus,
  isVoucherEffectivelyExpired,
  isVoucherRedeemable,
} from "./wallet-voucher-status-copy";
import { walletTestTranslator } from "./wallet-test-translator";

describe("isVoucherEffectivelyExpired", () => {
  it("is false before the expiry instant", () => {
    expect(
      isVoucherEffectivelyExpired(
        "2026-09-19T10:00:00.000Z",
        Date.parse("2026-09-19T09:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("is true at and after the expiry instant", () => {
    const expiresAtMs = Date.parse("2026-09-19T10:00:00.000Z");
    expect(isVoucherEffectivelyExpired("2026-09-19T10:00:00.000Z", expiresAtMs)).toBe(true);
    expect(isVoucherEffectivelyExpired("2026-09-19T10:00:00.000Z", expiresAtMs + 1)).toBe(true);
  });

  it("is false when expiresAt is not known yet (the live API has not sent it)", () => {
    expect(isVoucherEffectivelyExpired(undefined, Date.now())).toBe(false);
  });
});

describe("classifyVoucherStatus", () => {
  it("falls back to the coarse state when no real status is known (pre-4.8.c response)", () => {
    expect(classifyVoucherStatus("activated", false)).toEqual({
      kind: "held",
      badgeStatus: "success",
      isArchived: false,
    });
    expect(classifyVoucherStatus("reserved", false)).toEqual({
      kind: "pending",
      badgeStatus: "info",
      isArchived: false,
    });
    expect(classifyVoucherStatus("released", false)).toEqual({
      kind: "released",
      badgeStatus: "neutral",
      isArchived: true,
    });
  });

  it("treats any state as expired once it is effectively expired by wall-clock time, even with a real status", () => {
    expect(classifyVoucherStatus("activated", true)).toEqual({
      kind: "expired",
      badgeStatus: "danger",
      isArchived: true,
    });
    expect(classifyVoucherStatus("activated", true, "active")).toEqual({
      kind: "expired",
      badgeStatus: "danger",
      isArchived: true,
    });
  });

  it("11.6.d: prefers the real status once the wallet read carries one", () => {
    expect(classifyVoucherStatus("activated", false, "active")).toEqual({
      kind: "held",
      badgeStatus: "success",
      isArchived: false,
    });
    expect(classifyVoucherStatus("activated", false, "redeemed")).toEqual({
      kind: "redeemed",
      badgeStatus: "neutral",
      isArchived: true,
    });
    expect(classifyVoucherStatus("activated", false, "expired")).toEqual({
      kind: "expired",
      badgeStatus: "danger",
      isArchived: true,
    });
    expect(classifyVoucherStatus("activated", false, "transferred")).toEqual({
      kind: "transferred",
      badgeStatus: "neutral",
      isArchived: true,
    });
  });
});

describe("describeVoucherStatus", () => {
  it("labels every status in en-AU", () => {
    const t = walletTestTranslator("en-AU");
    expect(describeVoucherStatus("activated", false, t).label).toBe("Active");
    expect(describeVoucherStatus("reserved", false, t).label).toBe("Processing");
    expect(describeVoucherStatus("released", false, t).label).toBe("Released");
    expect(describeVoucherStatus("activated", true, t).label).toBe("Expired");
  });

  it("labels every status in id-ID", () => {
    const t = walletTestTranslator("id-ID");
    expect(describeVoucherStatus("activated", false, t).label).toBe("Aktif");
    expect(describeVoucherStatus("released", false, t).label).toBe("Dilepas");
  });

  it("11.6.d: labels a voucher spent at a counter as redeemed, in both locales", () => {
    expect(describeVoucherStatus("activated", false, walletTestTranslator("en-AU"), "redeemed").label).toBe(
      "Redeemed",
    );
    expect(describeVoucherStatus("activated", false, walletTestTranslator("id-ID"), "redeemed").label).toBe(
      "Sudah Ditukar",
    );
  });
});

describe("isVoucherRedeemable", () => {
  it("prefers the real status: only status active (which folds in a mid-hold voucher) is redeemable", () => {
    expect(
      isVoucherRedeemable({ state: "activated", status: "active" }, Date.now()),
    ).toBe(true);
    expect(
      isVoucherRedeemable({ state: "activated", status: "redeemed" }, Date.now()),
    ).toBe(false);
    expect(
      isVoucherRedeemable({ state: "activated", status: "transferred" }, Date.now()),
    ).toBe(false);
  });

  it("falls back to state === activated when no status is known", () => {
    expect(isVoucherRedeemable({ state: "activated" }, Date.now())).toBe(true);
    expect(isVoucherRedeemable({ state: "reserved" }, Date.now())).toBe(false);
    expect(isVoucherRedeemable({ state: "released" }, Date.now())).toBe(false);
  });

  it("a past expiresAt always wins, status or no status", () => {
    const past = "2020-01-01T00:00:00.000Z";
    expect(
      isVoucherRedeemable({ state: "activated", status: "active", expiresAt: past }, Date.now()),
    ).toBe(false);
  });
});
