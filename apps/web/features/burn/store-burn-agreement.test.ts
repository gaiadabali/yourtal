import { describe, expect, it } from "vitest";

import { computeBalanceShortfall } from "../store/store-balance";
import { getCurrentBalance } from "../store/store-balance-data";
import { getListing, listListings } from "../store/store-data";
import { classifyBurnEligibility } from "./burn-errors";
import { getRedeemData } from "./burn-data";

/**
 * Cross-route invariant, not a unit test of either feature.
 *
 * `/store/[listingId]` tells the user whether they can afford a listing, and
 * `/store/[listingId]/redeem` decides whether the burn is actually allowed.
 * Those are two separate modules, written by two agents, each with its own
 * data access. If they ever disagree, the user is told "you can afford this",
 * taps through, and is refused — or worse, is told they cannot afford
 * something they can. YT-0411's rule, which the store and burn code both
 * cite, is "the terms shown here are the terms honoured".
 *
 * The burn feature deliberately reuses the store's listing catalogue and
 * balance rather than picking its own. This test is what fails if that ever
 * drifts apart — a seam neither feature's own suite can see.
 */
describe("store and burn agree on affordability", () => {
  it("returns the same listing for every id the store catalogue exposes", async () => {
    const listings = await listListings();
    expect(listings.length).toBeGreaterThan(0);

    for (const listing of listings) {
      const redeem = await getRedeemData(listing.id);
      expect(redeem, `no redeem data for listing ${listing.id}`).toBeDefined();
      expect(redeem?.listing).toStrictEqual(listing);
    }
  });

  it("uses the same balance on both routes", async () => {
    const [storeBalance, listings] = await Promise.all([getCurrentBalance(), listListings()]);
    const first = listings[0];
    expect(first).toBeDefined();

    const redeem = await getRedeemData(first!.id);
    expect(redeem?.balance).toStrictEqual(storeBalance);
  });

  it("never says affordable on the offer page and then refuses the burn for lack of points", async () => {
    const [listings, balance] = await Promise.all([listListings(), getCurrentBalance()]);

    for (const listing of listings) {
      const shownAsAffordable = computeBalanceShortfall(
        listing.priceInPoints,
        balance.availablePoints,
      ).isAffordable;

      const redeem = await getRedeemData(listing.id);
      const burnError = classifyBurnEligibility(redeem!.listing, redeem!.balance);
      const refusedForPoints =
        burnError?.type === "insufficient_points" || burnError?.type === "holdback_blocks";

      // The offer page promising affordability while the burn refuses on
      // points is the failure this whole test exists to prevent.
      expect(
        shownAsAffordable && refusedForPoints,
        `listing ${listing.id}: offer page says affordable, burn refuses with ${burnError?.type}`,
      ).toBe(false);
    }
  });

  it("404s on both routes for an id in neither catalogue", async () => {
    const unknownId = "00000000-0000-4000-8000-00000000ffff";
    expect(await getListing(unknownId)).toBeUndefined();
    expect(await getRedeemData(unknownId)).toBeUndefined();
  });
});
