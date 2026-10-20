import { describe, expect, it } from "vitest";
import { createSimulatedPayments, simulatedProcessorUnits } from "@yourtal/drivers/payments";
import type { PaymentsDriver } from "@yourtal/drivers/payments";
import type { PaymentProviders } from "@yourtal/drivers/payment-providers";
import { createStripePayments } from "@yourtal/drivers/stripe/payments";
import type { RegionPaymentProviders } from "../../shared/drivers/payment-providers.module";
import { PaymentEventHandlers } from "./payment-event-handlers";
import { PaymentAccountsService } from "./payment-accounts.service";
import { memoryPaymentAccounts } from "./testing/memory-payment-accounts";
import { stripeRouteFetch } from "./testing/stripe-route-fetch";

const AU = {
  kind: "business" as const,
  id: "6f0e1d1a-3b7e-4c55-9d43-2b1d2d1f0a01",
  region: "AU" as const,
};

function regions(au: PaymentsDriver): RegionPaymentProviders {
  const sim = createSimulatedPayments(undefined, {
    declaredMinorUnitExponent: simulatedProcessorUnits(),
  });
  const rest = { marketplace: {}, payoutAccounts: {} } as Omit<PaymentProviders, "payments">;
  return { AU: { payments: au, ...rest }, ID: { payments: sim, ...rest } };
}

function stripeWith(routes: Parameters<typeof stripeRouteFetch>[0]) {
  const double = stripeRouteFetch(routes);
  const driver = createStripePayments({
    apiBase: "http://stripe.test",
    secretKey: "sk_test_unit",
    webhookSecret: "whsec_unit",
    fetch: double.fetch,
  });
  return { driver, calls: double.calls };
}

const SESSION = {
  id: "cs_test_setup",
  object: "checkout.session",
  url: "http://pay.test/cs_test_setup",
};

describe("PaymentAccountsService", () => {
  it("creates a customer once per owner, keyed on the owner", async () => {
    const { driver, calls } = stripeWith({
      "POST /v1/customers": { id: "cus_1", object: "customer" },
    });
    const service = new PaymentAccountsService(
      regions(driver),
      memoryPaymentAccounts(),
      "https://web.test",
    );
    expect((await service.ensureCustomer(AU))._unsafeUnwrap()).toBe("cus_1");
    expect((await service.ensureCustomer(AU))._unsafeUnwrap()).toBe("cus_1");
    expect(calls.map((c) => [c.path, c.idempotencyKey])).toEqual([
      ["/v1/customers", `customer:business:${AU.id}`],
    ]);
  });

  it("saves a card at once on the simulated driver, and needs none there", async () => {
    const store = memoryPaymentAccounts();
    const service = new PaymentAccountsService(
      regions(createSimulatedPayments()),
      store,
      "https://web.test",
    );
    expect(await service.cardRequired(AU)).toBe(false);
    const answer = (await service.startCardSetup(AU, "/studio/billing?business=x"))._unsafeUnwrap();
    expect(answer).toEqual({ kind: "saved", card: expect.objectContaining({ last4: "4242" }) });
    expect((await service.liveCard(AU))?.card.last4).toBe("4242");
    expect([...store.setups.values()].map((s) => s.status)).toEqual(["saved"]);
  });

  it("opens Stripe's page, then stores the card when the setup checkout completes", async () => {
    const store = memoryPaymentAccounts();
    const { driver, calls } = stripeWith({
      "POST /v1/customers": { id: "cus_1", object: "customer" },
      "POST /v1/checkout/sessions": SESSION,
      "GET /v1/checkout/sessions/cs_test_setup": {
        ...SESSION,
        mode: "setup",
        status: "complete",
        customer: "cus_1",
        setup_intent: {
          id: "seti_1",
          object: "setup_intent",
          status: "succeeded",
          payment_method: "pm_1",
        },
      },
      "GET /v1/payment_methods/pm_1": {
        id: "pm_1",
        object: "payment_method",
        card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2031 },
      },
    });
    const service = new PaymentAccountsService(regions(driver), store, "https://web.test");
    const handlers = new PaymentEventHandlers();
    service.registerHandlers(handlers);
    expect(await service.cardRequired(AU)).toBe(true);

    const answer = (await service.startCardSetup(AU, "/studio/billing?business=x"))._unsafeUnwrap();
    expect(answer).toEqual({ kind: "redirect", checkoutUrl: SESSION.url });
    const created = calls.find((c) => c.path === "/v1/checkout/sessions");
    expect(created?.body.get("mode")).toBe("setup");
    expect(created?.body.get("success_url")).toBe(
      "https://web.test/studio/billing?business=x&card=saved",
    );
    const setup = [...store.setups.values()][0];
    expect(setup?.checkoutRef).toBe("cs_test_setup");

    const completed = {
      type: "checkout.completed" as const,
      eventId: "evt_1",
      checkoutReference: "cs_test_setup",
      mode: "setup" as const,
      reference: `card-setup:${setup?.id ?? ""}`,
      paymentReference: null,
      amountMinor: null,
      currency: null,
      customerRef: "cus_1",
      paymentMethodRef: null,
    };
    await handlers.dispatch(completed);
    await handlers.dispatch(completed); // a second delivery changes nothing
    expect((await service.liveCard(AU))?.card).toEqual({
      brand: "visa",
      last4: "4242",
      expMonth: 4,
      expYear: 2031,
    });
    expect(store.cards.get(`business:${AU.id}:stripe`)).toHaveLength(1);
    expect(store.setups.get(setup?.id ?? "")?.status).toBe("saved");
    expect(await service.cardRequired(AU)).toBe(false);
  });

  it("refuses a completed setup that saved a card for another customer", async () => {
    const store = memoryPaymentAccounts();
    const { driver } = stripeWith({
      "POST /v1/customers": { id: "cus_1", object: "customer" },
      "POST /v1/checkout/sessions": SESSION,
      "GET /v1/checkout/sessions/cs_test_setup": {
        ...SESSION,
        mode: "setup",
        status: "complete",
        customer: "cus_someone_else",
        setup_intent: {
          id: "seti_1",
          object: "setup_intent",
          status: "succeeded",
          payment_method: "pm_1",
        },
      },
      "GET /v1/payment_methods/pm_1": {
        id: "pm_1",
        card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2031 },
      },
    });
    const service = new PaymentAccountsService(regions(driver), store, "https://web.test");
    const handlers = new PaymentEventHandlers();
    service.registerHandlers(handlers);
    await service.startCardSetup(AU, "/studio/billing");
    await expect(
      handlers.dispatch({
        type: "checkout.completed",
        eventId: "evt_2",
        checkoutReference: "cs_test_setup",
        mode: "setup",
        reference: null,
        paymentReference: null,
        amountMinor: null,
        currency: null,
        customerRef: "cus_someone_else",
        paymentMethodRef: null,
      }),
    ).rejects.toThrow(/different customer/);
    expect(await service.liveCard(AU)).toBeNull();
  });

  it("marks a setup expired when its checkout lapses", async () => {
    const store = memoryPaymentAccounts();
    const { driver } = stripeWith({
      "POST /v1/customers": { id: "cus_1" },
      "POST /v1/checkout/sessions": SESSION,
    });
    const service = new PaymentAccountsService(regions(driver), store, "https://web.test");
    const handlers = new PaymentEventHandlers();
    service.registerHandlers(handlers);
    await service.startCardSetup(AU, "/studio/billing");
    await handlers.dispatch({
      type: "checkout.expired",
      eventId: "evt_3",
      checkoutReference: "cs_test_setup",
      reference: null,
    });
    expect([...store.setups.values()].map((s) => s.status)).toEqual(["expired"]);
  });

  it("refuses a return path off the web app", async () => {
    const service = new PaymentAccountsService(
      regions(createSimulatedPayments()),
      memoryPaymentAccounts(),
      "https://web.test",
    );
    await expect(service.startCardSetup(AU, "//evil.test/x")).rejects.toThrow();
  });
});
