import { describe, expect, it } from "vitest";
import type { RegionSetting } from "../ledger-internal/settings";
import {
  funderFor,
  partnersFundedBy,
  receiptFunderKey,
  receiptFunderValueSchema,
} from "./receipt-funder";

const AU_BUSINESS = "00000000-0000-4000-8000-000000000001";
const ID_BUSINESS = "00000000-0000-4000-8000-00000000000a";

function setting(
  key: string,
  region: "AU" | "ID",
  value: unknown,
  approvedBy: string | null = "finance-2",
): RegionSetting {
  return {
    id: `${key}:${region}`,
    region,
    key,
    value,
    setBy: "finance-1",
    approvedBy,
    effectiveFrom: null,
  };
}

describe("receipt funder setting", () => {
  it("names the key receipt_funder.<partnerId>", () => {
    expect(receiptFunderKey("snap-app")).toBe("receipt_funder.snap-app");
  });

  it("accepts a lowercase uuid and refuses upper case, extra keys and a missing id", () => {
    expect(receiptFunderValueSchema.safeParse({ businessId: ID_BUSINESS }).success).toBe(true);
    expect(
      receiptFunderValueSchema.safeParse({ businessId: ID_BUSINESS.toUpperCase() }).success,
    ).toBe(false);
    expect(receiptFunderValueSchema.safeParse({ businessId: AU_BUSINESS, extra: 1 }).success).toBe(
      false,
    );
    expect(receiptFunderValueSchema.safeParse({}).success).toBe(false);
    expect(receiptFunderValueSchema.safeParse({ businessId: "not-a-uuid" }).success).toBe(false);
  });

  const settings = [
    setting("receipt_funder.snap-app", "AU", { businessId: AU_BUSINESS }),
    setting("receipt_funder.snap-app", "ID", { businessId: ID_BUSINESS }),
    setting("receipt_funder.other", "AU", { businessId: AU_BUSINESS }),
    setting("receipt_funder.pending", "AU", { businessId: AU_BUSINESS }, null),
    setting("receipt_funder.broken", "AU", { businessId: "nope" }),
    setting("receipt_points", "AU", 1),
  ];

  it("finds the funder per partner and region", () => {
    expect(funderFor(settings, "snap-app", "AU")).toBe(AU_BUSINESS);
    expect(funderFor(settings, "snap-app", "ID")).toBe(ID_BUSINESS);
  });

  it("answers null for no setting, a pending proposal or a malformed value", () => {
    expect(funderFor(settings, "unknown", "AU")).toBeNull();
    expect(funderFor(settings, "pending", "AU")).toBeNull();
    expect(funderFor(settings, "broken", "AU")).toBeNull();
    expect(funderFor([], "snap-app", "AU")).toBeNull();
  });

  it("lists the partners a business funds in a region, sorted", () => {
    expect(partnersFundedBy(settings, AU_BUSINESS, "AU")).toEqual(["other", "snap-app"]);
    expect(partnersFundedBy(settings, AU_BUSINESS, "ID")).toEqual([]);
    expect(partnersFundedBy(settings, ID_BUSINESS, "ID")).toEqual(["snap-app"]);
    expect(partnersFundedBy(settings, "00000000-0000-4000-8000-000000000009", "AU")).toEqual([]);
  });
});
