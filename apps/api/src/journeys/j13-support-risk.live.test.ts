import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  REGIONS,
  available,
  buy,
  fundedViewer,
  live,
  post,
  shop,
  staff,
  startJourney,
  stopJourney,
  type Journey,
} from "./journey-fixtures";

/**
 * Journey 13 (product-intent §2.2), both regions: a voucher that fails at the
 * till gives the viewer their points back at once and exactly once (K13), and
 * an account suspected of fraud is suspended with its balance escrowed, never
 * zeroed, and released whole.
 *   node packages/db/scripts/with-test-db.mjs -- env CHECKOUT_LIVE=1 \
 *     pnpm --filter @yourtal/api exec vitest run src/journeys/j13-support-risk.live.test.ts
 */
let j: Journey | undefined;

beforeAll(async () => {
  if (live) j = await startJourney();
}, 240_000);
afterAll(async () => {
  if (live) await stopJourney(j);
});

describe.skipIf(!live)("J13 support and risk", () => {
  it.each(REGIONS)(
    "%s: a voucher the shop would not honour refunds its points once",
    async (region) => {
      const journey = j!;
      const s = await shop(journey, region);
      const viewer = await fundedViewer(journey, region);
      const before = await available(journey, viewer);
      const { voucherId, pricePoints } = await buy(journey, viewer, s.listingId);
      expect(await available(journey, viewer)).toBe(before - pricePoints);

      const disputed = await post(
        journey,
        viewer.cookie,
        `/api/wallet/vouchers/${voucherId}/dispute`,
        {
          reason: "not_honoured",
        },
      );
      expect(disputed.statusCode, disputed.body).toBe(200);
      expect(disputed.json()).toMatchObject({ outcome: "reinstated", points: pricePoints });
      expect(await available(journey, viewer)).toBe(before);

      // A second report about the same voucher pays nothing more.
      await post(journey, viewer.cookie, `/api/wallet/vouchers/${voucherId}/dispute`, {
        reason: "not_honoured",
      });
      expect(await available(journey, viewer)).toBe(before);
    },
  );

  it.each(REGIONS)(
    "%s: a suspended account's points are escrowed and released whole",
    async (region) => {
      const journey = j!;
      const viewer = await fundedViewer(journey, region);
      const balance = await available(journey, viewer);
      expect(balance).toBeGreaterThan(0);
      const risk = await staff(journey, region, "risk_analyst");

      const suspended = await post(
        journey,
        risk.cookie,
        `/api/staff/users/${viewer.userId}/suspend`,
        {
          reason: "journey 13: suspected farming",
        },
      );
      expect(suspended.statusCode, suspended.body).toBeLessThan(300);
      expect(suspended.json()).toMatchObject({ escrowedPoints: balance });
      expect(suspended.json<{ escrowId: string | null }>().escrowId).not.toBeNull();

      const released = await post(
        journey,
        risk.cookie,
        `/api/staff/users/${viewer.userId}/release`,
      );
      expect(released.statusCode, released.body).toBeLessThan(300);
      expect(released.json()).toMatchObject({ releasedPoints: balance });
      expect(await available(journey, viewer)).toBe(balance);
    },
  );
});
