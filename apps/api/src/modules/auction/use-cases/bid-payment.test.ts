import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { createSimulatedMarketplacePayments } from "@yourtal/drivers/marketplace-payments";
import { createStripeMarketplacePayments } from "@yourtal/drivers/stripe/marketplace";
import type { GiftParty } from "../../wallet/gift-party-reader";
import { charityReady, holdTargetFor } from "./bid-payment";

const stripe = createStripeMarketplacePayments({
  apiBase: "http://stripe.test",
  secretKey: "sk_test_unit",
  fetch: () => Promise.reject(new Error("no network in a unit test")),
});
const simulated = createSimulatedMarketplacePayments();

const BIDDER: GiftParty = {
  userId: "6f0e1d1a-3b7e-4c55-9d43-2b1d2d1f0a01",
  region: "AU",
  dateOfBirth: "1990-01-01",
  suspended: false,
  displayName: "Bidder",
  displayLocale: "en-AU",
  email: "bidder@example.test",
};
const CARD = {
  customerRef: "cus_1",
  paymentMethodRef: "pm_1",
  card: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2034 },
};

async function refusedWith(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConflictException);
  return (error as ConflictException).getResponse() as unknown as string;
}

describe("charityReady (5.1.d)", () => {
  it("on Stripe needs the connected account the onboarding stores", () => {
    expect(charityReady(stripe, "acct_1Nabc")).toBe(true);
    expect(charityReady(stripe, "simpayout_12345678")).toBe(false);
    expect(charityReady(stripe, "")).toBe(false);
  });

  it("on the simulated driver takes any reference", () => {
    expect(charityReady(simulated, "simpayout_12345678")).toBe(true);
  });
});

describe("holdTargetFor (5.1.d)", () => {
  it("refuses charity_not_ready on Stripe before it asks for a card", async () => {
    const liveCard = vi.fn();
    const response = await refusedWith(
      holdTargetFor({ accounts: { liveCard } }, stripe, BIDDER, "simpayout_1"),
    );
    expect(response).toMatchObject({ code: "charity_not_ready" });
    expect(liveCard).not.toHaveBeenCalled();
  });

  it("refuses card_required when the bidder has no live card", async () => {
    const liveCard = vi.fn().mockResolvedValue(null);
    const response = await refusedWith(
      holdTargetFor({ accounts: { liveCard } }, stripe, BIDDER, "acct_1Nabc"),
    );
    expect(response).toMatchObject({ code: "card_required" });
    expect(liveCard).toHaveBeenCalledWith({ kind: "user", id: BIDDER.userId, region: "AU" });
  });

  it("names the card and the charity's account for the hold", async () => {
    const liveCard = vi.fn().mockResolvedValue(CARD);
    await expect(
      holdTargetFor({ accounts: { liveCard } }, stripe, BIDDER, "acct_1Nabc"),
    ).resolves.toEqual({
      customerRef: "cus_1",
      paymentMethodRef: "pm_1",
      destinationReference: "acct_1Nabc",
    });
  });

  it("leaves a driver that charges no saved card exactly as it was", async () => {
    const liveCard = vi.fn();
    await expect(
      holdTargetFor({ accounts: { liveCard } }, simulated, BIDDER, "simpayout_1"),
    ).resolves.toEqual({});
    expect(liveCard).not.toHaveBeenCalled();
  });
});
