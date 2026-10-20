import { describe, expect, it } from "vitest";
import type { Currency } from "@yourtal/contracts/money/currency";
import { createSimulatedPayments, simulatedProcessorUnits } from "./payments";
import { fromProviderAmount } from "./provider-amount";
import { createStripeMarketplacePayments } from "./stripe/stripe-marketplace";
import { createStripePayments } from "./stripe/stripe-payments";
import { createStripePayoutAccounts } from "./stripe/stripe-payout-accounts";
import { type RecordedCall, formLines, recordingFetch } from "./stripe/stripe-fetch-double";

/**
 * The parity property (see payments-parity.test.ts) for the Stripe drivers: the same real-world amount reaches
 * Stripe, read back through the unit the driver DECLARES. AUD cents go unchanged; IDR, which the Stripe drivers do
 * not declare (F104), is refused before anything is sent.
 */

const A$123_45 = 12_345;
const config = { apiBase: "https://api.stripe.com", secretKey: "sk_test_parity" };

function sentField(call: RecordedCall | undefined, field: string): number {
  const line = formLines(call?.body).find((entry) => entry.startsWith(`${field}=`));
  return Number(line?.slice(field.length + 1));
}

type Send = (
  currency: Currency,
  amountMinor: number,
) => Promise<{ calls: RecordedCall[]; ok: boolean; declared: number | undefined }>;

const answer = (body: Record<string, unknown>) => recordingFetch({ status: 200, body });

const paths: { name: string; field: string; currencyLine: string | null; send: Send }[] = [
  {
    name: "payments.startCheckout",
    currencyLine: "line_items[0][price_data][currency]=aud",
    field: "line_items[0][price_data][unit_amount]",
    send: async (currency, amountMinor) => {
      const double = answer({ id: "cs_1", url: "https://checkout.test/cs_1" });
      const driver = createStripePayments({
        ...config,
        webhookSecret: "whsec",
        fetch: double.fetch,
      });
      const result = await driver.startCheckout({
        idempotencyKey: "k",
        amountMinor,
        currency,
        reference: "r",
        description: "d",
        successUrl: "https://s",
        cancelUrl: "https://c",
      });
      return {
        calls: double.calls,
        ok: result.isOk(),
        declared: driver.declaredMinorUnitExponent[currency],
      };
    },
  },
  {
    name: "payments.chargeSaved",
    currencyLine: "currency=aud",
    field: "amount",
    send: async (currency, amountMinor) => {
      const double = answer({ id: "pi_1", status: "succeeded" });
      const driver = createStripePayments({
        ...config,
        webhookSecret: "whsec",
        fetch: double.fetch,
      });
      const result = await driver.chargeSaved({
        idempotencyKey: "k",
        amountMinor,
        currency,
        customerRef: "cus_1",
        paymentMethodRef: "pm_1",
        reference: "r",
      });
      return {
        calls: double.calls,
        ok: result.isOk(),
        declared: driver.declaredMinorUnitExponent[currency],
      };
    },
  },
  {
    name: "payments.refund",
    currencyLine: null,
    field: "amount",
    send: async (currency, amountMinor) => {
      const double = answer({ id: "re_1", status: "succeeded" });
      const driver = createStripePayments({
        ...config,
        webhookSecret: "whsec",
        fetch: double.fetch,
      });
      const result = await driver.refund({
        idempotencyKey: "k",
        paymentReference: "pi_1",
        currency,
        amountMinor,
        reference: "r",
      });
      return {
        calls: double.calls,
        ok: result.isOk(),
        declared: driver.declaredMinorUnitExponent[currency],
      };
    },
  },
  {
    name: "marketplace.hold",
    currencyLine: "currency=aud",
    field: "amount",
    send: async (currency, amountMinor) => {
      const double = answer({ id: "pi_1", status: "requires_capture" });
      const driver = createStripeMarketplacePayments({ ...config, fetch: double.fetch });
      const result = await driver.hold({
        idempotencyKey: "k",
        amountMinor,
        currency,
        reference: "r",
        customerRef: "cus_1",
        paymentMethodRef: "pm_1",
        destinationReference: "acct_1",
      });
      return {
        calls: double.calls,
        ok: result.isOk(),
        declared: driver.declaredMinorUnitExponent[currency],
      };
    },
  },
  {
    name: "marketplace.capture",
    currencyLine: null,
    field: "amount_to_capture",
    send: async (currency, amountMinor) => {
      const double = answer({
        id: "pi_1",
        status: "succeeded",
        transfer_data: { destination: "acct_1" },
      });
      const driver = createStripeMarketplacePayments({ ...config, fetch: double.fetch });
      const result = await driver.capture({
        idempotencyKey: "k",
        holdReference: "pi_1",
        amountMinor,
        currency,
        destinationReference: "acct_1",
      });
      return {
        calls: double.calls.filter((call) => call.method === "POST"),
        ok: result.isOk(),
        declared: driver.declaredMinorUnitExponent[currency],
      };
    },
  },
  {
    name: "payoutAccounts.transfer",
    currencyLine: "currency=aud",
    field: "amount",
    send: async (currency, amountMinor) => {
      const double = answer({ id: "tr_1" });
      const driver = createStripePayoutAccounts({ ...config, fetch: double.fetch });
      const result = await driver.transfer({
        idempotencyKey: "k",
        amountMinor,
        currency,
        accountRef: "acct_1",
        reference: "r",
      });
      return {
        calls: double.calls,
        ok: result.isOk(),
        declared: driver.declaredMinorUnitExponent[currency],
      };
    },
  },
  {
    name: "payoutAccounts.payout",
    currencyLine: "currency=aud",
    field: "amount",
    send: async (currency, amountMinor) => {
      const double = answer({ id: "po_1", status: "pending" });
      const driver = createStripePayoutAccounts({ ...config, fetch: double.fetch });
      const result = await driver.payout({
        idempotencyKey: "k",
        amountMinor,
        currency,
        accountRef: "acct_1",
        reference: "r",
      });
      return {
        calls: double.calls,
        ok: result.isOk(),
        declared: driver.declaredMinorUnitExponent[currency],
      };
    },
  },
];

describe("the Stripe drivers send the same real-world amount", () => {
  it.each(paths)(
    "$name: AUD cents reach Stripe unchanged, and read back as the same money",
    async ({ field, currencyLine, send }) => {
      const { calls, ok, declared } = await send("AUD", A$123_45);
      expect(ok).toBe(true);
      expect(declared).toBe(2);
      const sent = sentField(calls[0], field);
      expect(sent).toBe(A$123_45);
      expect(fromProviderAmount(sent, "AUD", declared ?? -1)._unsafeUnwrap()).toBe(A$123_45);
      // Stripe takes the currency lowercase; a refund and a capture inherit it from the PaymentIntent.
      if (currencyLine !== null) expect(formLines(calls[0]?.body)).toContain(currencyLine);
    },
  );

  it.each(paths)(
    "$name: IDR is undeclared, so it is refused before anything is sent",
    async ({ send }) => {
      const { calls, ok, declared } = await send("IDR", 45_000);
      expect(declared).toBeUndefined();
      expect(ok).toBe(false);
      expect(calls).toHaveLength(0);
    },
  );
});

describe("the simulated driver records what the new calls were asked, in provider units", () => {
  it.each([
    { currency: "AUD" as const, amountMinor: 4_500 },
    { currency: "IDR" as const, amountMinor: 45_000 },
  ])(
    "startCheckout and chargeSaved send our stored $currency unit",
    async ({ currency, amountMinor }) => {
      const driver = createSimulatedPayments(undefined, {
        declaredMinorUnitExponent: simulatedProcessorUnits(),
      });
      const started = (
        await driver.startCheckout({
          idempotencyKey: `co-${currency}`,
          amountMinor,
          currency,
          reference: "r",
          description: "d",
          successUrl: "s",
          cancelUrl: "c",
        })
      )._unsafeUnwrap();
      if (started.kind !== "paid") throw new Error("the simulated checkout settles at once");
      expect(driver.received(started.paymentReference)).toStrictEqual({
        externalId: "r",
        amount: amountMinor,
        currency,
      });

      const saved = (
        await driver.chargeSaved({
          idempotencyKey: `cs-${currency}`,
          amountMinor,
          currency,
          customerRef: "c",
          paymentMethodRef: "p",
          reference: "r2",
        })
      )._unsafeUnwrap();
      expect(driver.received(saved.paymentReference)?.amount).toBe(amountMinor);
    },
  );

  it("refuses an IDR checkout when the driver was never told what its processor speaks", async () => {
    const bare = createSimulatedPayments();
    const started = await bare.startCheckout({
      idempotencyKey: "k",
      amountMinor: 45_000,
      currency: "IDR",
      reference: "r",
      description: "d",
      successUrl: "s",
      cancelUrl: "c",
    });
    expect(started.isErr()).toBe(true);
  });
});
