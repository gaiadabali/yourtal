import { describe, expect, it } from "vitest";
import { createStripePayments } from "@yourtal/drivers/stripe/payments";
import { signStripePayload } from "@yourtal/drivers/stripe/signature";
import type { PaymentEvent } from "@yourtal/drivers/payments";
import { PaymentEventHandlers } from "../payment-event-handlers";
import { receiveWebhook } from "./receive-webhook.use-case";

const SECRET = "whsec_unit_receive";
const NOW = 1_800_000_000_000;
const driver = createStripePayments({
  apiBase: "http://stripe.test",
  secretKey: "sk_test_unit",
  webhookSecret: SECRET,
  fetch: () => Promise.reject(new Error("no calls expected")),
});

function memoryInbox() {
  const processed = new Map<string, boolean>();
  return {
    processed,
    claim: (eventId: string) => {
      if (!processed.has(eventId)) processed.set(eventId, false);
      return Promise.resolve(processed.get(eventId) === true);
    },
    markProcessed: (eventId: string) => {
      processed.set(eventId, true);
      return Promise.resolve();
    },
  };
}

function delivery(event: unknown, secret = SECRET) {
  const rawBody = JSON.stringify(event);
  return {
    rawBody,
    headers: { "stripe-signature": signStripePayload(rawBody, secret, Math.floor(NOW / 1000)) },
  };
}

const expired = (id: string) => ({
  id,
  object: "event",
  type: "checkout.session.expired",
  data: {
    object: { id: "cs_test_1", object: "checkout.session", client_reference_id: "card-purchase:x" },
  },
});

describe("receiveWebhook", () => {
  it("refuses a bad signature and a body that is not an event", async () => {
    const deps = { driver, events: memoryInbox(), handlers: new PaymentEventHandlers() };
    expect(
      await receiveWebhook(deps, delivery(expired("evt_1"), "whsec_wrong"), NOW),
    ).toMatchObject({
      kind: "refused",
    });
    expect(await receiveWebhook(deps, delivery({ hello: "world" }), NOW)).toEqual({
      kind: "refused",
      reason: "malformed_event",
    });
    expect(deps.events.processed.size).toBe(0);
  });

  it("runs the handlers once per event id, and answers a replay as a duplicate", async () => {
    const seen: PaymentEvent[] = [];
    const handlers = new PaymentEventHandlers();
    handlers.on("checkout.expired", (event) => {
      seen.push(event);
      return Promise.resolve();
    });
    const deps = { driver, events: memoryInbox(), handlers };
    expect(await receiveWebhook(deps, delivery(expired("evt_2")), NOW)).toMatchObject({
      kind: "handled",
      handlers: 1,
    });
    expect(await receiveWebhook(deps, delivery(expired("evt_2")), NOW)).toEqual({
      kind: "duplicate",
      eventId: "evt_2",
    });
    expect(seen).toHaveLength(1);
  });

  it("leaves a failed event open so the sender's retry runs it again", async () => {
    let failures = 1;
    const handlers = new PaymentEventHandlers();
    handlers.on("checkout.expired", () =>
      failures-- > 0 ? Promise.reject(new Error("database away")) : Promise.resolve(),
    );
    const deps = { driver, events: memoryInbox(), handlers };
    await expect(receiveWebhook(deps, delivery(expired("evt_3")), NOW)).rejects.toThrow(
      "database away",
    );
    expect(deps.events.processed.get("evt_3")).toBe(false);
    expect(await receiveWebhook(deps, delivery(expired("evt_3")), NOW)).toMatchObject({
      kind: "handled",
    });
    expect(deps.events.processed.get("evt_3")).toBe(true);
  });

  it("records a type the app does not act on and answers it", async () => {
    const deps = { driver, events: memoryInbox(), handlers: new PaymentEventHandlers() };
    const outcome = await receiveWebhook(
      deps,
      delivery({
        id: "evt_4",
        object: "event",
        type: "transfer.created",
        data: { object: { id: "tr_1" } },
      }),
      NOW,
    );
    expect(outcome).toEqual({
      kind: "handled",
      eventId: "evt_4",
      type: "transfer.created",
      handlers: 0,
    });
  });
});
