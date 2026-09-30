import { describe, expect, it } from "vitest";
import { parseCachedVoucherDetail } from "./voucher-detail-cache";
import { parseResumePosition } from "../player/resume-position";

const base = {
  voucherId: "v1",
  listingId: "l1",
  state: "activated",
  cachedAt: "2026-09-30T00:00:00.000Z",
};

describe("13.4.d guards replacing zod/mini", () => {
  it("keeps a valid voucher entry and drops unknown keys such as a code", () => {
    expect(parseCachedVoucherDetail({ ...base, currency: "AUD", code: "SECRET" })).toEqual({
      ...base,
      currency: "AUD",
    });
  });

  it("refuses tampered voucher entries", () => {
    expect(parseCachedVoucherDetail({ ...base, state: "stolen" })).toBeNull();
    expect(parseCachedVoucherDetail({ ...base, voucherId: "" })).toBeNull();
    expect(parseCachedVoucherDetail({ ...base, faceValueMinor: "100" })).toBeNull();
    expect(parseCachedVoucherDetail({ ...base, location: { name: "x" } })).toBeNull();
    expect(parseCachedVoucherDetail(null)).toBeNull();
  });

  it("validates a resume position the way the schema did", () => {
    const ok = { campaignId: "c", positionSeconds: 42, updatedAt: "2026-09-30T01:02:03.000Z" };
    expect(parseResumePosition({ ...ok, extra: 1 })).toEqual(ok);
    expect(parseResumePosition({ ...ok, positionSeconds: -1 })).toBeNull();
    expect(parseResumePosition({ ...ok, updatedAt: "yesterday" })).toBeNull();
    expect(parseResumePosition({ ...ok, campaignId: "" })).toBeNull();
  });
});
