import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseResult } from "@yourtal/contracts/billing";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { purchasePointsAction } from "./purchase-points-action";
import { purchasePoints } from "./billing-data";

vi.mock("./billing-data", () => ({ purchasePoints: vi.fn(), startCardSetup: vi.fn() }));
vi.mock("next/navigation", () => ({
  // Like the real one, redirecting never returns.
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const paid: PurchaseResult = {
  status: "paid",
  purchaseId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10",
  checkoutUrl: null,
  allocation: null,
  purchase: {
    purchaseId: "7d9b8a52-6c9a-4b3e-9d0e-0a2f5d3c1b10",
    status: "paid",
    tierKey: "grow",
    points: toPoints(10_000),
    subtotalMinor: toMinorUnits(42_750),
    taxMinor: toMinorUnits(4_275),
    totalMinor: toMinorUnits(47_025),
    taxRateBps: 1_000,
    currency: "AUD",
    allocationId: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    paidAt: null,
  },
};

beforeEach(() => vi.mocked(purchasePoints).mockReset());

describe("purchasePointsAction (14.13)", () => {
  it("buys the chosen tier, keyed so one idempotency key never covers two tiers", async () => {
    vi.mocked(purchasePoints).mockResolvedValue(paid);
    await expect(
      purchasePointsAction(
        form({ businessId: "b1", tierKey: "grow", currency: "AUD", idempotencyKey: "k1" }),
      ),
    ).rejects.toThrow("REDIRECT /studio/billing?business=b1&purchased=1");
    expect(purchasePoints).toHaveBeenCalledWith("b1", "grow", "AUD", "k1:grow");
  });

  it("refuses a points amount in place of a tier", async () => {
    await expect(
      purchasePointsAction(
        form({ businessId: "b1", points: "10000", currency: "AUD", idempotencyKey: "k1" }),
      ),
    ).rejects.toThrow("REDIRECT /studio/billing?error=invalid_purchase");
    expect(purchasePoints).not.toHaveBeenCalled();
  });
});
