import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fromProviderAmount } from "../provider-amount";
import {
  type Harness,
  URLS,
  onboardedAccount,
  paidPurchase,
  savedCard,
  startHarness,
} from "./paysim-harness";

/**
 * 5.1.c, the parity property against the simulation: for every call that moves or reserves money, what the
 * simulation RECORDED equals what we asked, in Stripe's unit (AUD cents), and reads back through the driver's
 * declared exponent as the same money. IDR, undeclared by the Stripe drivers (F104), never leaves the process.
 */

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

const asked = 12_345; // A$123.45

function readsBack(recordedAmount: unknown): number {
  expect(recordedAmount).toBeTypeOf("number");
  return fromProviderAmount(
    Number(recordedAmount),
    "AUD",
    h.payments.declaredMinorUnitExponent.AUD ?? -1,
  )._unsafeUnwrap();
}

describe("what the simulation recorded is what we asked", () => {
  it("startCheckout: the session total and its PaymentIntent", async () => {
    const { checkoutReference, paymentReference } = await paidPurchase(h, "parity-checkout", asked);
    const session = await h.recorded(checkoutReference);
    expect(session).toMatchObject({ amount_total: asked, currency: "aud" });
    expect(await h.recorded(paymentReference)).toMatchObject({
      amount: asked,
      amount_received: asked,
      currency: "aud",
    });
    expect(readsBack(session.amount_total)).toBe(asked);
  });

  it("chargeSaved, refund (partial and the rest)", async () => {
    const card = await savedCard(h, "parity-saved");
    const charged = (
      await h.payments.chargeSaved({
        idempotencyKey: "parity:charge",
        amountMinor: asked,
        currency: "AUD",
        customerRef: card.customerRef,
        paymentMethodRef: card.paymentMethodRef,
        reference: "parity:charge",
      })
    )._unsafeUnwrap();
    const intent = await h.recorded(charged.paymentReference);
    expect(intent).toMatchObject({ amount: asked, amount_received: asked, currency: "aud" });
    expect(readsBack(intent.amount_received)).toBe(asked);

    const part = (
      await h.payments.refund({
        idempotencyKey: "parity:refund:1",
        paymentReference: charged.paymentReference,
        currency: "AUD",
        amountMinor: 2_345,
        reference: "r1",
      })
    )._unsafeUnwrap();
    const rest = (
      await h.payments.refund({
        idempotencyKey: "parity:refund:2",
        paymentReference: charged.paymentReference,
        currency: "AUD",
        reference: "r2",
      })
    )._unsafeUnwrap();
    expect(await h.recorded(part.refundReference)).toMatchObject({
      amount: 2_345,
      currency: "aud",
    });
    expect(await h.recorded(rest.refundReference)).toMatchObject({
      amount: asked - 2_345,
      currency: "aud",
    });
  });

  it("hold and a partial capture", async () => {
    const charity = await onboardedAccount(h, "parity-charity", "charity");
    const card = await savedCard(h, "parity-bidder");
    const held = (
      await h.marketplace.hold({
        idempotencyKey: "parity:hold",
        amountMinor: asked,
        currency: "AUD",
        reference: "auction:p",
        customerRef: card.customerRef,
        paymentMethodRef: card.paymentMethodRef,
        destinationReference: charity,
      })
    )._unsafeUnwrap();
    expect(await h.recorded(held.holdReference)).toMatchObject({
      amount: asked,
      amount_capturable: asked,
      currency: "aud",
    });

    const captured = (
      await h.marketplace.capture({
        idempotencyKey: "parity:capture",
        holdReference: held.holdReference,
        amountMinor: 12_000,
        currency: "AUD",
        destinationReference: charity,
      })
    )._unsafeUnwrap();
    expect(captured.providerAmount).toBe(12_000);
    expect(await h.recorded(held.holdReference)).toMatchObject({
      amount_received: 12_000,
      status: "succeeded",
    });
  });

  it("transfer and payout", async () => {
    const account = await onboardedAccount(h, "parity-business", "business");
    const transfer = (
      await h.payoutAccounts.transfer({
        idempotencyKey: "parity:transfer",
        amountMinor: asked,
        currency: "AUD",
        accountRef: account,
        reference: "statement:p",
      })
    )._unsafeUnwrap();
    expect(await h.recorded(transfer.transferRef)).toMatchObject({
      amount: asked,
      currency: "aud",
      destination: account,
    });

    const payout = (
      await h.payoutAccounts.payout({
        idempotencyKey: "parity:payout",
        amountMinor: asked,
        currency: "AUD",
        accountRef: account,
        reference: "statement:p",
      })
    )._unsafeUnwrap();
    const recorded = await h.recorded(payout.payoutRef);
    expect(recorded).toMatchObject({ amount: asked, currency: "aud" });
    expect(readsBack(recorded.amount)).toBe(asked);
  });
});

describe("IDR is refused before anything is sent", () => {
  const idr = { currency: "IDR" as const, amountMinor: 45_000 };
  const calls: { name: string; run: () => Promise<{ isErr(): boolean }> }[] = [
    {
      name: "startCheckout",
      run: () =>
        h.payments.startCheckout({
          idempotencyKey: "idr:1",
          reference: "r",
          description: "d",
          ...URLS,
          ...idr,
        }),
    },
    {
      name: "startCardSetup",
      run: () =>
        h.payments.startCardSetup({
          idempotencyKey: "idr:2",
          customerRef: "cus_x",
          reference: "r",
          currency: "IDR",
          ...URLS,
        }),
    },
    {
      name: "chargeSaved",
      run: () =>
        h.payments.chargeSaved({
          idempotencyKey: "idr:3",
          customerRef: "cus_x",
          paymentMethodRef: "pm_x",
          reference: "r",
          ...idr,
        }),
    },
    {
      name: "refund",
      run: () =>
        h.payments.refund({
          idempotencyKey: "idr:4",
          paymentReference: "pi_x",
          currency: "IDR",
          reference: "r",
        }),
    },
    {
      name: "hold",
      run: () =>
        h.marketplace.hold({
          idempotencyKey: "idr:5",
          reference: "r",
          customerRef: "cus_x",
          paymentMethodRef: "pm_x",
          destinationReference: "acct_x",
          ...idr,
        }),
    },
    {
      name: "capture",
      run: () =>
        h.marketplace.capture({
          idempotencyKey: "idr:6",
          holdReference: "pi_x",
          destinationReference: "acct_x",
          ...idr,
        }),
    },
    {
      name: "transfer",
      run: () =>
        h.payoutAccounts.transfer({
          idempotencyKey: "idr:7",
          accountRef: "acct_x",
          reference: "r",
          ...idr,
        }),
    },
    {
      name: "payout",
      run: () =>
        h.payoutAccounts.payout({
          idempotencyKey: "idr:8",
          accountRef: "acct_x",
          reference: "r",
          ...idr,
        }),
    },
  ];

  it.each(calls)("$name", async ({ run }) => {
    const before = h.apiCalls.length;
    expect((await run()).isErr()).toBe(true);
    expect(h.apiCalls.length).toBe(before);
  });
});
