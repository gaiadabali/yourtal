import { describe, expect, it } from "vitest";
import { walletHistoryEntrySchema } from "./wallet-history";
import {
  adjustmentHistoryFixture,
  expiryHistoryFixture,
  generateWalletHistory,
  reversalHistoryFixture,
} from "./wallet-history.mock";
import { mockCampaigns } from "../campaign/campaign.mock";
import { mockVouchers } from "../voucher/voucher.mock";

const validEntry = {
  id: "wh_earn_1",
  kind: "earn",
  occurredAt: "2026-09-01T00:00:00.000Z",
  description: "Menyelesaikan video Kopi Kenangan — dapat 2.400 poin",
  points: 2_400,
  direction: "credit",
};

describe("walletHistoryEntrySchema", () => {
  it("round-trips a valid entry", () => {
    const parsed = walletHistoryEntrySchema.parse(validEntry);
    expect(parsed.description).toContain("2.400 poin");
  });

  const rejectionTable: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "invalid kind enum value", overrides: { kind: "cashout" } },
    { name: "invalid direction enum value", overrides: { direction: "sideways" } },
    { name: "negative points", overrides: { points: -1 } },
    { name: "empty description", overrides: { description: "" } },
    { name: "non-datetime occurredAt", overrides: { occurredAt: "yesterday" } },
    { name: "an earn entry marked as a debit", overrides: { direction: "debit" } },
    { name: "a burn entry marked as a credit", overrides: { kind: "burn", direction: "credit" } },
    {
      name: "an expiry entry marked as a credit",
      overrides: { kind: "expiry", direction: "credit" },
    },
  ];

  it.each(rejectionTable)("rejects $name", ({ overrides }) => {
    const candidate = { ...validEntry, ...overrides };
    expect(walletHistoryEntrySchema.safeParse(candidate).success).toBe(false);
  });

  it.each(["reversal", "adjustment"])("%s may be either direction", (kind) => {
    expect(
      walletHistoryEntrySchema.safeParse({ ...validEntry, kind, direction: "credit" }).success,
    ).toBe(true);
    expect(
      walletHistoryEntrySchema.safeParse({ ...validEntry, kind, direction: "debit" }).success,
    ).toBe(true);
  });
});

describe("generateWalletHistory", () => {
  const history = generateWalletHistory(mockCampaigns.slice(0, 5), mockVouchers.slice(0, 5));

  it("derives one entry per campaign and per voucher, from real mock records", () => {
    expect(history).toHaveLength(10);
    const relatedIds = new Set(history.map((entry) => entry.relatedId));
    for (const campaign of mockCampaigns.slice(0, 5)) {
      expect(relatedIds.has(campaign.id)).toBe(true);
    }
    for (const voucher of mockVouchers.slice(0, 5)) {
      expect(relatedIds.has(voucher.id)).toBe(true);
    }
  });

  it("is sorted newest first", () => {
    for (let index = 1; index < history.length; index += 1) {
      const previous = new Date(history[index - 1]?.occurredAt ?? 0).getTime();
      const current = new Date(history[index]?.occurredAt ?? 0).getTime();
      expect(previous).toBeGreaterThanOrEqual(current);
    }
  });

  it("never emits a bare transaction code — every description is prose", () => {
    for (const entry of history) {
      expect(entry.description).not.toMatch(/^[A-Z_]+$/);
    }
  });
});

describe("awkward fixtures", () => {
  it("covers expiry, reversal and adjustment, the kinds a campaign/voucher pair cannot produce", () => {
    expect(expiryHistoryFixture.kind).toBe("expiry");
    expect(reversalHistoryFixture.kind).toBe("reversal");
    expect(adjustmentHistoryFixture.kind).toBe("adjustment");
  });
});
