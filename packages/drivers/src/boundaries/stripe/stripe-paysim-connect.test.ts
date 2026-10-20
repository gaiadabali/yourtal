import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Harness, onboardedAccount, savedCard, startHarness } from "./paysim-harness";

/** 5.1.c: charity holds and Stripe Connect payouts, the real drivers against the payment simulation. */

let h: Harness;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(async () => {
  await h.close();
});

async function available(account: string): Promise<number> {
  const balance = await h.stripeGet("/v1/balance", account);
  const first = (balance.available as { amount: number; currency: string }[] | undefined)?.[0];
  expect(first?.currency).toBe("aud");
  return first?.amount ?? Number.NaN;
}

async function hold(key: string, charity: string, amountMinor = 12_500) {
  const card = await savedCard(h, key);
  const held = await h.marketplace.hold({
    idempotencyKey: `auction-bid:${key}`,
    amountMinor,
    currency: "AUD",
    reference: "auction:a1",
    customerRef: card.customerRef,
    paymentMethodRef: card.paymentMethodRef,
    destinationReference: charity,
  });
  return held._unsafeUnwrap();
}

describe("charity auction holds", () => {
  it("holds on a saved card, captures into the charity's account, and releases the other bid", async () => {
    const charity = await onboardedAccount(h, "charity1", "charity");
    const winning = await hold("bidder1", charity);
    const losing = await hold("bidder2", charity, 11_000);
    expect(winning.providerAmount).toBe(12_500);
    expect(await h.recorded(winning.holdReference)).toMatchObject({
      status: "requires_capture",
      capture_method: "manual",
      transfer_data: { destination: charity },
      on_behalf_of: charity,
    });

    const captured = await h.marketplace.capture({
      idempotencyKey: "auction-capture:a1",
      holdReference: winning.holdReference,
      amountMinor: 12_000,
      currency: "AUD",
      destinationReference: charity,
    });
    expect(captured._unsafeUnwrap()).toStrictEqual({
      captureReference: winning.holdReference,
      destinationReference: charity,
      providerAmount: 12_000,
    });
    expect(await available(charity)).toBe(12_000);

    expect(
      (
        await h.marketplace.release({
          idempotencyKey: "release:bidder2",
          holdReference: losing.holdReference,
        })
      ).isOk(),
    ).toBe(true);
    expect(await h.recorded(losing.holdReference)).toMatchObject({ status: "canceled" });
    expect(await h.deliver()).toContainEqual(
      expect.objectContaining({
        type: "payment.canceled",
        paymentReference: losing.holdReference,
        reference: "auction:a1",
      }),
    );
  });

  it("refuses to capture towards an account the hold does not pay", async () => {
    const charity = await onboardedAccount(h, "charity2", "charity");
    const other = await onboardedAccount(h, "charity3", "charity");
    const held = await hold("bidder3", charity);
    const captured = await h.marketplace.capture({
      idempotencyKey: "auction-capture:a2",
      holdReference: held.holdReference,
      amountMinor: 12_500,
      currency: "AUD",
      destinationReference: other,
    });
    expect(captured._unsafeUnwrapErr()).toMatchObject({
      kind: "declined",
      mayHaveSucceeded: false,
    });
    expect(await h.recorded(held.holdReference)).toMatchObject({ status: "requires_capture" });
  });

  it("counts a hold the 7-day sweep already canceled as released", async () => {
    const charity = await onboardedAccount(h, "charity4", "charity");
    const held = await hold("bidder4", charity);
    h.advance(7 * 24 * 60 * 60_000 + 1_000);
    expect(await h.deliver()).toContainEqual(
      expect.objectContaining({
        type: "payment.canceled",
        paymentReference: held.holdReference,
        reason: "automatic",
      }),
    );

    const before = h.apiCalls.length;
    expect(
      (
        await h.marketplace.release({
          idempotencyKey: "release:late",
          holdReference: held.holdReference,
        })
      ).isOk(),
    ).toBe(true);
    // The cancel was refused (already canceled), and the driver read the PaymentIntent to see why.
    expect(h.apiCalls.slice(before).map((call) => call.method)).toStrictEqual(["POST", "GET"]);
  });
});

describe("Stripe Connect payout accounts", () => {
  it("onboards with 000123456, then transfers and pays out, with payout.paid after the sweep", async () => {
    const account = await onboardedAccount(h, "business1", "business");
    expect((await h.payoutAccounts.getAccount(account))._unsafeUnwrap()).toStrictEqual({
      accountRef: account,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      bankLast4: "3456",
    });
    expect(await h.deliver()).toContainEqual(
      expect.objectContaining({
        type: "account.updated",
        accountRef: account,
        payoutsEnabled: true,
        bankLast4: "3456",
      }),
    );

    const transfer = (
      await h.payoutAccounts.transfer({
        idempotencyKey: "statement:1:transfer",
        amountMinor: 9_900,
        currency: "AUD",
        accountRef: account,
        reference: "statement:1",
      })
    )._unsafeUnwrap();
    expect(transfer.transferRef).toMatch(/^tr_/);
    expect(await available(account)).toBe(9_900);

    const payout = (
      await h.payoutAccounts.payout({
        idempotencyKey: "statement:1:payout",
        amountMinor: 9_900,
        currency: "AUD",
        accountRef: account,
        reference: "statement:1",
      })
    )._unsafeUnwrap();
    expect(payout.status).toBe("pending");
    expect((await h.deliver()).some((event) => event.type === "payout.paid")).toBe(false);

    h.advance(30_000);
    expect(await h.deliver()).toContainEqual({
      type: "payout.paid",
      eventId: expect.stringMatching(/^evt_/),
      accountRef: account,
      payoutRef: payout.payoutRef,
      reference: "statement:1",
      amountMinor: 9_900,
      currency: "AUD",
      failureCode: null,
    });
  });

  it("a payout to 111111116 fails with no_account, and the money returns to the balance", async () => {
    const account = await onboardedAccount(h, "business2", "business", "111111116");
    (
      await h.payoutAccounts.transfer({
        idempotencyKey: "statement:2:transfer",
        amountMinor: 5_000,
        currency: "AUD",
        accountRef: account,
        reference: "statement:2",
      })
    )._unsafeUnwrap();
    const payout = (
      await h.payoutAccounts.payout({
        idempotencyKey: "statement:2:payout",
        amountMinor: 5_000,
        currency: "AUD",
        accountRef: account,
        reference: "statement:2",
      })
    )._unsafeUnwrap();
    expect(await available(account)).toBe(0);

    h.advance(30_000);
    expect(await h.deliver()).toContainEqual(
      expect.objectContaining({
        type: "payout.failed",
        accountRef: account,
        payoutRef: payout.payoutRef,
        failureCode: "no_account",
        amountMinor: 5_000,
      }),
    );
    expect(await available(account)).toBe(5_000);
  });

  it("refuses a payout beyond the account's balance", async () => {
    const account = await onboardedAccount(h, "business3", "business");
    const payout = await h.payoutAccounts.payout({
      idempotencyKey: "statement:3:payout",
      amountMinor: 100,
      currency: "AUD",
      accountRef: account,
      reference: "statement:3",
    });
    expect(payout._unsafeUnwrapErr()).toMatchObject({
      kind: "declined",
      boundary: "disbursement",
      mayHaveSucceeded: false,
    });
  });

  it("an account not yet onboarded reads as not payable", async () => {
    const created = (
      await h.payoutAccounts.createAccount({
        idempotencyKey: "account:fresh",
        reference: "business:fresh",
        kind: "business",
        payoutSchedule: "daily",
      })
    )._unsafeUnwrap();
    expect((await h.payoutAccounts.getAccount(created.accountRef))._unsafeUnwrap()).toStrictEqual({
      accountRef: created.accountRef,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      bankLast4: null,
    });
    expect(await h.recorded(created.accountRef)).toMatchObject({
      type: "express",
      country: "AU",
      business_type: "company",
      settings: { payouts: { schedule: { interval: "daily" } } },
    });
  });
});
