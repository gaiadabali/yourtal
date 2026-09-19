import { describe, expect, it } from "vitest";
import { mockCampaigns } from "@yourtal/contracts/campaign/mock";
import { expiredVoucherFixture, expiringWithinHourVoucherFixture } from "@yourtal/contracts/voucher/mock";
import { buildWalletHistory } from "./wallet-history";

// mockCampaigns is a non-empty fixed-length (24) deterministic array — index 0 always exists.
const sampleCampaigns = mockCampaigns.slice(0, 3);
const sampleVouchers = [expiredVoucherFixture, expiringWithinHourVoucherFixture];

describe("buildWalletHistory", () => {
  it("describes earning in plain language, naming the merchant and the points earned", () => {
    const history = buildWalletHistory([], sampleCampaigns);
    const entry = history.find((item) => item.id === `earn-${sampleCampaigns[0]!.id}`);
    expect(entry?.description).toContain(sampleCampaigns[0]!.merchantName);
    expect(entry?.description).toMatch(/poin/);
    expect(entry?.pointsDelta).toBeGreaterThan(0);
  });

  it("describes a voucher redemption as spending points, never as a bare transaction code", () => {
    const history = buildWalletHistory(sampleVouchers, []);
    const entry = history.find((item) => item.id === `spend-${expiredVoucherFixture.id}`);
    expect(entry?.description).toContain(expiredVoucherFixture.merchantName);
    expect(entry?.description).not.toContain(expiredVoucherFixture.code);
    expect(entry?.pointsDelta).toBeLessThan(0);
  });

  it("never leaks a voucher's redemption code into any entry's description", () => {
    const history = buildWalletHistory(sampleVouchers, sampleCampaigns);
    for (const voucher of sampleVouchers) {
      for (const entry of history) {
        expect(entry.description).not.toContain(voucher.code);
      }
    }
  });

  it("sorts entries newest first", () => {
    const history = buildWalletHistory(sampleVouchers, sampleCampaigns);
    const timestamps = history.map((entry) => new Date(entry.occurredAt).getTime());
    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
  });
});
