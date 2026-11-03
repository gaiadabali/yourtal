import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { toMinorUnits } from "@yourtal/contracts/money";
import type { ListingForCheckout } from "../persistence/listing-for-checkout";
import { quoteCheckout, type Buyer } from "./quote-checkout";
import type { SagaDeps } from "./run-saga";

const NOW = new Date("2026-11-01T00:00:00Z");

const quoteSpy = vi.fn(() => okAsync({ quoteId: "q1" }));

function makeDeps(): SagaDeps {
  quoteSpy.mockClear();
  return {
    now: () => NOW,
    ledger: {
      quote: quoteSpy,
      lockQuote: vi.fn(() =>
        okAsync({ quoteId: "q1", pricePoints: 200, expiresAt: "2026-11-01T00:15:00Z" }),
      ),
    },
    sagas: { create: vi.fn(() => Promise.resolve({ id: "saga-1" })) },
  } as unknown as SagaDeps;
}

const listing = (redeemPartnerId: string | null): ListingForCheckout => ({
  id: "l1",
  region: "AU",
  currency: "AUD",
  settlementMinor: toMinorUnits(500),
  audience: "adult",
  channel: "online",
  buyable: true,
  redeemPartnerId,
});

const buyer = (dateOfBirth: string, trustTier: number): Buyer => ({
  userId: "u1",
  region: "AU",
  dateOfBirth,
  trustTier,
});

describe("quoteCheckout: online trust tier", () => {
  it("refuses a tier-0 adult an ordinary online listing", async () => {
    const result = await quoteCheckout(makeDeps(), buyer("1990-01-01", 0), listing(null));
    expect(result._unsafeUnwrapErr()).toMatchObject({ code: "audience_blocked" });
  });

  it("lets a tier-0 adult buy a partner-bound online listing", async () => {
    const result = await quoteCheckout(makeDeps(), buyer("1990-01-01", 0), listing("snap-app"));
    expect(result.isOk()).toBe(true);
  });

  it("still refuses a teen a partner-bound adult listing", async () => {
    const deps = makeDeps();
    const result = await quoteCheckout(deps, buyer("2012-01-01", 3), listing("snap-app"));
    expect(result._unsafeUnwrapErr()).toMatchObject({ code: "audience_blocked" });
    expect(quoteSpy).not.toHaveBeenCalled();
  });

  it("refuses a teen a bound listing even when its audience says all ages", async () => {
    const deps = makeDeps();
    const open = { ...listing("snap-app"), audience: "all_ages" as const };
    const result = await quoteCheckout(deps, buyer("2012-01-01", 3), open);
    expect(result._unsafeUnwrapErr()).toMatchObject({ code: "audience_blocked" });
    expect(quoteSpy).not.toHaveBeenCalled();
  });
});
