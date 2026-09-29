import { describe, expect, it } from "vitest";
import { toPoints } from "@yourtal/contracts/money";
import { computeBalanceShortfall } from "../store/store-balance";
import { classifyBalanceEligibility } from "./burn-errors";
import { makeBalanceFixture } from "./burn-test-fixtures";

/**
 * Cross-feature invariant, not a unit test of either feature.
 *
 * `/store/[listingId]` tells the user whether they can afford a listing
 * (`computeBalanceShortfall`), and `/store/[listingId]/redeem` decides
 * whether the checkout is actually allowed to proceed
 * (`classifyBalanceEligibility`). Those are two separate modules, written by
 * two agents, each with its own affordability check. If they ever disagree
 * on the boundary — available points alone covering the price — the user is
 * told "you can afford this", taps through, and is refused, or is told they
 * cannot afford something they can. docs/09's rule, which both modules cite,
 * is "the terms shown here are the terms honoured".
 *
 * Rewritten for 11.6.b: both routes now read the SAME live listing and
 * balance (`store-data.ts`'s `getListing`, `store-balance-data.ts`'s
 * `getCurrentBalance` — the redeem page calls both directly, no separate
 * catalogue to drift out of step with, unlike the mock-era `burn-data.ts`
 * this test used to exercise against a live API). What is left to prove
 * here — the one thing that WOULD still silently disagree if either
 * function's threshold ever moved without the other noticing — is that the
 * two functions agree on exactly where the affordability boundary sits,
 * checked directly against both, with no network involved.
 */
describe("store and burn agree on the affordability boundary", () => {
  const cases: Array<{ pricePoints: number; availablePoints: number; pendingPoints: number }> = [
    { pricePoints: 5_000, availablePoints: 5_000, pendingPoints: 0 },
    { pricePoints: 5_000, availablePoints: 5_001, pendingPoints: 0 },
    { pricePoints: 5_000, availablePoints: 4_999, pendingPoints: 0 },
    { pricePoints: 9_000, availablePoints: 8_400, pendingPoints: 1_200 },
    { pricePoints: 9_600, availablePoints: 8_400, pendingPoints: 1_200 },
    { pricePoints: 1, availablePoints: 0, pendingPoints: 0 },
    { pricePoints: 0, availablePoints: 0, pendingPoints: 0 },
  ];

  for (const { pricePoints, availablePoints, pendingPoints } of cases) {
    it(`price ${pricePoints}, available ${availablePoints}, pending ${pendingPoints}`, () => {
      const balance = makeBalanceFixture({
        availablePoints,
        pendingPoints,
        pendingUnlockAt: pendingPoints > 0 ? "2026-09-22T00:00:00.000Z" : null,
      });

      const shownAsAffordable = computeBalanceShortfall(
        toPoints(pricePoints),
        toPoints(availablePoints),
      ).isAffordable;
      const isEligible = classifyBalanceEligibility(pricePoints, balance) === null;

      // The offer page promising affordability while checkout refuses for
      // lack of points (or vice versa) is the failure this test exists to
      // prevent — both must agree on whether AVAILABLE POINTS ALONE cover
      // the price. `classifyBalanceEligibility` may still refuse with
      // `holdback_blocks` even when this agrees (pending would cover the
      // rest), which is a real, intentional difference — that pending
      // money is not yet spendable — not a disagreement about affordability.
      expect(shownAsAffordable).toBe(isEligible);
    });
  }
});
