import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Result } from "neverthrow";
import { type PaySimBrowser, createBrowser } from "@yourtal/paysim/browser";
import { type PaySimServer, startPaySimServer } from "@yourtal/paysim/server";
import type { MarketplacePaymentsDriver } from "../marketplace-payments";
import type { PaymentEvent, PaymentsDriver } from "../payments";
import type { PayoutAccountsDriver } from "../payout-accounts";
import { createStripeMarketplacePayments } from "./stripe-marketplace";
import { createStripePayments } from "./stripe-payments";
import { createStripePayoutAccounts } from "./stripe-payout-accounts";

/**
 * Test-only: the real Stripe drivers against YourTal's payment simulation over HTTP. The simulation runs on an
 * injected clock and delivers webhooks to a real local receiver; every delivery goes through the driver's own
 * parseWebhook, and every API call the drivers make is recorded.
 */

export const CARD_OK = { number: "4242 4242 4242 4242", expiry: "12 / 34", cvc: "123" };
export const CARD_DECLINED = { number: "4000 0000 0000 0002", expiry: "12 / 34", cvc: "123" };
export const CARD_3DS = { number: "4000 0025 0000 3155", expiry: "12 / 34", cvc: "123" };
export const URLS = {
  successUrl: "https://app.test/ok?s={CHECKOUT_SESSION_ID}",
  cancelUrl: "https://app.test/no",
};

export interface ApiCall {
  readonly method: string;
  readonly url: string;
  readonly body: string | undefined;
}

export interface Harness {
  readonly sim: PaySimServer;
  readonly browser: PaySimBrowser;
  readonly payments: PaymentsDriver;
  readonly marketplace: MarketplacePaymentsDriver;
  readonly payoutAccounts: PayoutAccountsDriver;
  /** Every request the drivers sent to the simulation's API. */
  readonly apiCalls: ApiCall[];
  /** Every event delivered so far, normalised by payments.parseWebhook. */
  readonly events: PaymentEvent[];
  now(): Date;
  advance(ms: number): void;
  /** Runs the simulation's sweep and delivery once, then returns the events delivered by it. */
  deliver(): Promise<PaymentEvent[]>;
  /** The object as the simulation stored it. */
  recorded(id: string): Promise<Readonly<Record<string, unknown>>>;
  /** A raw GET against the simulation's API, optionally on a connected account. */
  stripeGet(path: string, account?: string): Promise<Readonly<Record<string, unknown>>>;
  close(): Promise<void>;
}

interface Received {
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
}

async function startReceiver(received: Received[]): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const headers: Record<string, string | undefined> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        headers[name] = Array.isArray(value) ? value.join(",") : value;
      }
      received.push({ headers, body: Buffer.concat(chunks).toString("utf8") });
      response.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${String(port)}/webhooks/stripe` };
}

export function unwrap<T, E>(result: Result<T, E>, what: string): T {
  if (result.isErr()) throw new Error(`${what} failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

export async function startHarness(): Promise<Harness> {
  let time = new Date("2026-10-20T00:00:00Z");
  const received: Received[] = [];
  const receiver = await startReceiver(received);
  const sim = await startPaySimServer({ now: () => new Date(time), webhookUrl: receiver.url });

  const apiCalls: ApiCall[] = [];
  const recording = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    apiCalls.push({
      method: init?.method ?? "GET",
      url,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return fetch(input, init);
  };
  const config = { apiBase: sim.baseUrl, secretKey: sim.secretKey, fetch: recording };
  const payments = createStripePayments({ ...config, webhookSecret: sim.webhookSecret });
  const events: PaymentEvent[] = [];
  let parsed = 0;

  async function stripeGet(path: string, account?: string) {
    const response = await fetch(`${sim.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${sim.secretKey}`,
        ...(account === undefined ? {} : { "Stripe-Account": account }),
      },
    });
    return (await response.json()) as Readonly<Record<string, unknown>>;
  }

  return {
    sim,
    browser: createBrowser(sim.config.publicBaseUrl),
    payments,
    marketplace: createStripeMarketplacePayments(config),
    payoutAccounts: createStripePayoutAccounts(config),
    apiCalls,
    events,
    now: () => new Date(time),
    advance(ms) {
      time = new Date(time.getTime() + ms);
    },
    async deliver() {
      await sim.tick();
      const fresh: PaymentEvent[] = [];
      for (const delivery of received.slice(parsed)) {
        const event = payments.parseWebhook(
          { rawBody: delivery.body, headers: delivery.headers },
          time.getTime(),
        );
        // A delivery the driver refuses is a disagreement between the two, never something to skip.
        fresh.push(unwrap(event, `parseWebhook(${delivery.body.slice(0, 120)})`));
      }
      parsed = received.length;
      events.push(...fresh);
      return fresh;
    },
    async recorded(id) {
      const found = (await sim.store.listObjects()).find((object) => object.id === id);
      if (found === undefined) throw new Error(`the simulation has no ${id}`);
      return found.data;
    },
    stripeGet,
    async close() {
      await sim.close();
      await new Promise<void>((resolve) => receiver.server.close(() => resolve()));
    },
  };
}

/** A customer with a card saved through setup-mode Checkout. */
export async function savedCard(h: Harness, key: string) {
  const { customerRef } = unwrap(
    await h.payments.createCustomer({
      idempotencyKey: `customer:${key}`,
      reference: `user:${key}`,
    }),
    "createCustomer",
  );
  const setup = unwrap(
    await h.payments.startCardSetup({
      idempotencyKey: `setup:${key}`,
      customerRef,
      reference: `card-setup:${key}`,
      currency: "AUD",
      ...URLS,
    }),
    "startCardSetup",
  );
  if (setup.kind !== "redirect") throw new Error("Stripe card setup redirects");
  await h.browser.submitCheckout(setup.checkoutReference, CARD_OK);
  const result = unwrap(
    await h.payments.cardSetupResult(setup.checkoutReference),
    "cardSetupResult",
  );
  return { ...result, checkoutReference: setup.checkoutReference };
}

/** A connected account onboarded through the simulation's page with the given test bank account. */
export async function onboardedAccount(
  h: Harness,
  key: string,
  kind: "business" | "charity",
  bankAccount = "000123456",
): Promise<string> {
  const { accountRef } = unwrap(
    await h.payoutAccounts.createAccount({
      idempotencyKey: `account:${key}`,
      reference: `${kind}:${key}`,
      kind,
      email: `${key}@example.test`,
      payoutSchedule: "manual",
    }),
    "createAccount",
  );
  const link = unwrap(
    await h.payoutAccounts.onboardingLink({
      accountRef,
      returnUrl: "https://app.test/payouts/done",
      refreshUrl: "https://app.test/payouts/again",
      purpose: "onboarding",
    }),
    "onboardingLink",
  );
  const token = new URL(link.url).pathname.split("/").pop() ?? "";
  const page = await h.browser.completeOnboarding(token, { bsb: "110000", account: bankAccount });
  if (page.status !== 303) throw new Error(`onboarding answered ${String(page.status)}`);
  return accountRef;
}

/** A purchase paid with 4242 through Checkout; returns its checkout and PaymentIntent references. */
export async function paidPurchase(h: Harness, key: string, amountMinor: number) {
  const started = unwrap(
    await h.payments.startCheckout({
      idempotencyKey: `purchase:${key}`,
      amountMinor,
      currency: "AUD",
      reference: `card-purchase:${key}`,
      description: "YourTal points",
      ...URLS,
    }),
    "startCheckout",
  );
  if (started.kind !== "redirect") throw new Error("Stripe checkout redirects");
  await h.browser.submitCheckout(started.checkoutReference, CARD_OK);
  const session = await h.stripeGet(`/v1/checkout/sessions/${started.checkoutReference}`);
  return {
    checkoutReference: started.checkoutReference,
    paymentReference: String(session.payment_intent),
  };
}
