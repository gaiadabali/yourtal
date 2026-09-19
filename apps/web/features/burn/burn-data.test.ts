import { describe, expect, it } from "vitest";
import { mockListings, soldOutListingFixture } from "@yourtal/contracts/listing/mock";
import { mixedStateBalanceFixture } from "@yourtal/contracts/balance/mock";
import { getRedeemData, holdbackDemoListing } from "./burn-data";
import { classifyBurnEligibility } from "./burn-errors";

describe("getRedeemData", () => {
  it("resolves a shared-catalogue listing id to that exact listing, paired with the same current-user balance the offer detail page uses", async () => {
    const data = await getRedeemData(soldOutListingFixture.id);
    expect(data?.listing).toEqual(soldOutListingFixture);
    expect(data?.balance).toEqual(mixedStateBalanceFixture);
  });

  it("resolves any listing from the shared 30-item mock catalogue (features/store's own catalogue)", async () => {
    const first = mockListings[0];
    expect(first).toBeDefined();
    if (!first) {
      return;
    }
    const data = await getRedeemData(first.id);
    expect(data?.listing).toEqual(first);
  });

  it("resolves the dedicated holdback-demo listing, purpose-built to fall inside mixedStateBalanceFixture's holdback band", async () => {
    const data = await getRedeemData(holdbackDemoListing.id);
    expect(data).toBeDefined();
    if (!data) {
      return;
    }
    expect(data.listing).toEqual(holdbackDemoListing);
    expect(classifyBurnEligibility(data.listing, data.balance)).toEqual({
      type: "holdback_blocks",
      unlocksAt: mixedStateBalanceFixture.pendingUnlockAt,
    });
  });

  it("returns undefined for an id outside both the shared catalogue and the holdback demo — mirrors the offer detail page's 404", async () => {
    const data = await getRedeemData("00000000-0000-4000-8000-999999999999");
    expect(data).toBeUndefined();
  });
});
