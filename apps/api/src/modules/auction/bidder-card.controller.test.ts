import { HttpException, NotFoundException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { createSimulatedPayments, simulatedProcessorUnits } from "@yourtal/drivers/payments";
import type { PaymentsDriver } from "@yourtal/drivers/payments";
import type { PaymentProviders } from "@yourtal/drivers/payment-providers";
import { createStripePayments } from "@yourtal/drivers/stripe/payments";
import type { PrincipalService } from "../../shared/authz/principal.service";
import type { RegionPaymentProviders } from "../../shared/drivers/payment-providers.module";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";
import { PaymentAccountsService } from "../payments/payment-accounts.service";
import { memoryPaymentAccounts } from "../payments/testing/memory-payment-accounts";
import { stripeRouteFetch } from "../payments/testing/stripe-route-fetch";
import { BidderCardController } from "./bidder-card.controller";

const USER = "6f0e1d1a-3b7e-4c55-9d43-2b1d2d1f0a01";
const AUCTION = "0b5f1c9e-2f43-4d8e-9a55-7a1c2d3e4f50";
const request = {} as FastifyRequest;

const sim = () =>
  createSimulatedPayments(undefined, { declaredMinorUnitExponent: simulatedProcessorUnits() });

function setup(options: { au: PaymentsDriver; region?: "AU" | "ID" | null; routes?: object }) {
  const rest = { marketplace: {}, payoutAccounts: {} } as Omit<PaymentProviders, "payments">;
  const providers: RegionPaymentProviders = {
    AU: { payments: options.au, ...rest },
    ID: { payments: sim(), ...rest },
  };
  const store = memoryPaymentAccounts();
  const accounts = new PaymentAccountsService(providers, store, "https://web.test");
  const region = options.region === undefined ? "AU" : options.region;
  const controller = new BidderCardController(
    { resolve: () => Promise.resolve({ id: USER }) } as unknown as PrincipalService,
    accounts,
    {
      findByUserId: () => Promise.resolve(region === null ? null : { region }),
    } as unknown as UserProfileRepository,
  );
  return { controller, store };
}

function stripeWith(routes: Record<string, unknown>) {
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

describe("GET and POST /api/me/payment-card (5.1.d)", () => {
  it("on Stripe says a card is required, and opens the processor's page that returns to the auction", async () => {
    const { driver, calls } = stripeWith({
      "POST /v1/customers": { id: "cus_1", object: "customer" },
      "POST /v1/checkout/sessions": SESSION,
    });
    const { controller } = setup({ au: driver });
    expect(await controller.card(request)).toEqual({ card: null, required: true });

    const started = await controller.startSetup(request, { auctionId: AUCTION });
    expect(started).toEqual({ checkoutUrl: "http://pay.test/cs_test_setup", card: null });
    const session = calls.find((c) => c.path === "/v1/checkout/sessions");
    expect(session?.body.get("success_url")).toBe(
      `https://web.test/auctions/${AUCTION}?card=saved`,
    );
    expect(session?.body.get("cancel_url")).toBe(
      `https://web.test/auctions/${AUCTION}?card=cancelled`,
    );
    // Owner kind user: the customer is the bidder's, keyed on them.
    expect(calls.find((c) => c.path === "/v1/customers")?.idempotencyKey).toBe(
      `customer:user:${USER}`,
    );
  });

  it("returns to the auction list when no auction is named", async () => {
    const { driver, calls } = stripeWith({
      "POST /v1/customers": { id: "cus_1", object: "customer" },
      "POST /v1/checkout/sessions": SESSION,
    });
    await setup({ au: driver }).controller.startSetup(request, {});
    const session = calls.find((c) => c.path === "/v1/checkout/sessions");
    expect(session?.body.get("success_url")).toBe("https://web.test/auctions?card=saved");
  });

  it("saves a card at once where the processor charges none, and requires none", async () => {
    const { controller, store } = setup({ au: sim(), region: "ID" });
    expect(await controller.card(request)).toEqual({ card: null, required: false });
    const started = await controller.startSetup(request, {});
    expect(started.checkoutUrl).toBeNull();
    expect(started.card).toMatchObject({ last4: "4242" });
    expect(await controller.card(request)).toMatchObject({
      card: { last4: "4242" },
      required: false,
    });
    // The row belongs to the user, not to a business.
    expect([...store.cards.keys()][0]).toMatch(/^user:/);
  });

  it("answers 404 for an account with no profile", async () => {
    const { controller } = setup({ au: sim(), region: null });
    await expect(controller.card(request)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("answers 402 when the processor refuses the request, without its detail", async () => {
    const { driver } = stripeWith({});
    const error = await setup({ au: driver })
      .controller.startSetup(request, {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(402);
    expect(JSON.stringify((error as HttpException).getResponse())).not.toContain(
      "resource_missing",
    );
  });

  it("answers 503 when the processor is down", async () => {
    const down = createStripePayments({
      apiBase: "http://stripe.test",
      secretKey: "sk_test_unit",
      webhookSecret: "whsec_unit",
      fetch: () => Promise.resolve(new Response("{}", { status: 500 })),
    });
    const error = await setup({ au: down })
      .controller.startSetup(request, {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
  });
});
