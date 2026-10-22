import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingAllocation } from "@yourtal/contracts/billing";
import { toPoints } from "@yourtal/contracts/money";
import { BillingScreen } from "./billing-screen";
import { mockPackages } from "./billing-mock-packages";

vi.mock("./purchase-points-action", () => ({ purchasePointsAction: vi.fn() }));

// The machine's own zone must not decide the day: pin it to UTC, where the region zone is what makes these pass.
beforeEach(() => vi.stubEnv("TZ", "UTC"));
afterEach(() => vi.unstubAllEnvs());

const allocation = (createdAt: string): BillingAllocation => ({
  allocationId: "alloc_1",
  region: "AU",
  funderType: "partner",
  totalPoints: toPoints(10_000),
  remainingPoints: toPoints(4_000),
  programme: null,
  createdAt,
});

function show(createdAt: string, region: "AU" | "ID") {
  render(
    <BillingScreen
      businessId="b1"
      balance={{
        totalPoints: toPoints(10_000),
        remainingPoints: toPoints(4_000),
        allocations: [allocation(createdAt)],
      }}
      packages={mockPackages(region === "AU" ? "AUD" : "IDR")}
      alerts={[]}
      canPurchase
      idempotencyKey="k"
      locale="en-AU"
      region={region}
    />,
  );
}

describe("BillingScreen purchase history dates", () => {
  // 16:30 UTC on the 20th is the 21st in Sydney but still the 20th in Jakarta;
  // 18:00 UTC is the 21st in Jakarta. Each is the wrong day when formatted in UTC.
  it.each([
    ["AU", "2026-10-20T16:30:00.000Z", "21 Oct 2026"],
    ["ID", "2026-10-20T16:30:00.000Z", "20 Oct 2026"],
    ["ID", "2026-10-20T18:00:00.000Z", "21 Oct 2026"],
  ] as const)("writes a purchase on the day it was in %s (%s)", (region, createdAt, day) => {
    show(createdAt, region);
    expect(screen.getByText(day)).toBeInTheDocument();
  });
});
