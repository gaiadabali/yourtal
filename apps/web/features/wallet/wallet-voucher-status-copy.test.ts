import { describe, expect, it } from "vitest";
import {
  classifyVoucherStatus,
  describeVoucherStatus,
  isVoucherEffectivelyExpired,
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
  it("classifies every live wallet state and badge status without producing any label", () => {
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

  it("treats any state as expired once it is effectively expired by wall-clock time", () => {
    expect(classifyVoucherStatus("activated", true)).toEqual({
      kind: "expired",
      badgeStatus: "danger",
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
});
