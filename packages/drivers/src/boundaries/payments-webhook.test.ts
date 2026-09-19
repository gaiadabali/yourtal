import { describe, expect, it } from "vitest";
import { createSimulatedPayments } from "./payments";
import { createInMemoryWebhookInbox } from "./webhook-inbox";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  REPLAY_TOLERANCE_MS,
  verifyWebhookSignature,
} from "./webhook-signature";

/**
 * Webhook signature verification and replay, against the simulator. YT-0537.
 *
 * A webhook endpoint is unauthenticated by definition — a public URL anyone
 * can POST to — so the signature is the only thing separating a payment
 * confirmation from a stranger claiming one. Every rejection path below is
 * exercised, because a check that has only ever accepted has not been shown
 * to reject.
 */

const NOW = 1_800_000_000_000;

async function chargeAndDeliver(
  driver: ReturnType<typeof createSimulatedPayments>,
  key: string,
  nowMs = NOW,
) {
  const charge = await driver.charge({
    idempotencyKey: key,
    amountMinor: 4_500_000,
    currency: "IDR",
    reference: `ref-${key}`,
  });
  return driver.signedDeliveries(charge._unsafeUnwrap().providerReference, nowMs);
}

describe("a genuine callback", () => {
  it("verifies, and quotes the amount in the processor's own units", async () => {
    const driver = createSimulatedPayments(undefined, { declaredMinorUnitExponent: { IDR: 0 } });
    const deliveries = await chargeAndDeliver(driver, "genuine");

    const first = deliveries[0];
    expect(first).toBeDefined();

    const verified = verifyWebhookSignature({
      body: first?.body ?? "",
      secret: driver.webhookSecret,
      signature: first?.headers[SIGNATURE_HEADER],
      timestamp: first?.headers[TIMESTAMP_HEADER],
      nowMs: NOW,
    });
    expect(verified.isOk()).toBe(true);

    // Rp 45.000 quoted as 45_000 whole Rupiah, not as 4_500_000 sen — a
    // handler comparing this against our stored amount must convert, and
    // quoting our own units here would have hidden that step.
    const payload: unknown = JSON.parse(first?.body ?? "{}");
    expect(payload).toMatchObject({ amount: 45_000, currency: "IDR", status: "pending" });
  });
});

describe("a callback that should be refused", () => {
  it("rejects a tampered body", async () => {
    const driver = createSimulatedPayments();
    const deliveries = await chargeAndDeliver(driver, "tamper");
    const genuine = deliveries[0];

    // The attack this exists for: take a real callback, raise the amount.
    const tampered = (genuine?.body ?? "").replace('"amount":4500000', '"amount":450000000');
    expect(tampered).not.toBe(genuine?.body);

    const verdict = verifyWebhookSignature({
      body: tampered,
      secret: driver.webhookSecret,
      signature: genuine?.headers[SIGNATURE_HEADER],
      timestamp: genuine?.headers[TIMESTAMP_HEADER],
      nowMs: NOW,
    });
    expect(verdict._unsafeUnwrapErr().kind).toBe("bad_signature");
  });

  it("rejects a signature made with the wrong secret", async () => {
    const driver = createSimulatedPayments();
    const deliveries = await chargeAndDeliver(driver, "wrong-secret");
    const genuine = deliveries[0];

    const verdict = verifyWebhookSignature({
      body: genuine?.body ?? "",
      secret: "not-the-secret",
      signature: genuine?.headers[SIGNATURE_HEADER],
      timestamp: genuine?.headers[TIMESTAMP_HEADER],
      nowMs: NOW,
    });
    expect(verdict._unsafeUnwrapErr().kind).toBe("bad_signature");
  });

  const missing = [
    { name: "no signature header", signature: undefined, expected: "missing_signature" },
    { name: "empty signature header", signature: "", expected: "missing_signature" },
  ];
  it.each(missing)("rejects $name", async ({ signature, expected }) => {
    const driver = createSimulatedPayments();
    const deliveries = await chargeAndDeliver(driver, `missing-${expected}${String(signature)}`);

    const verdict = verifyWebhookSignature({
      body: deliveries[0]?.body ?? "",
      secret: driver.webhookSecret,
      signature,
      timestamp: deliveries[0]?.headers[TIMESTAMP_HEADER],
      nowMs: NOW,
    });
    expect(verdict._unsafeUnwrapErr().kind).toBe(expected);
  });

  it("rejects a missing timestamp", async () => {
    const driver = createSimulatedPayments();
    const deliveries = await chargeAndDeliver(driver, "no-timestamp");

    const verdict = verifyWebhookSignature({
      body: deliveries[0]?.body ?? "",
      secret: driver.webhookSecret,
      signature: deliveries[0]?.headers[SIGNATURE_HEADER],
      timestamp: undefined,
      nowMs: NOW,
    });
    expect(verdict._unsafeUnwrapErr().kind).toBe("missing_timestamp");
  });

  it("rejects a callback older than the replay window", async () => {
    // Signed correctly, an hour ago. This is a captured request being
    // resent — the signature is genuine, which is exactly why the timestamp
    // has to be inside it and checked.
    const driver = createSimulatedPayments();
    const oldMs = NOW - REPLAY_TOLERANCE_MS - 1_000;
    const deliveries = await chargeAndDeliver(driver, "stale", oldMs);

    const verdict = verifyWebhookSignature({
      body: deliveries[0]?.body ?? "",
      secret: driver.webhookSecret,
      signature: deliveries[0]?.headers[SIGNATURE_HEADER],
      timestamp: deliveries[0]?.headers[TIMESTAMP_HEADER],
      nowMs: NOW,
    });
    expect(verdict._unsafeUnwrapErr().kind).toBe("stale_timestamp");
  });

  it("rejects a callback dated in the future", async () => {
    // The check has to be two-sided. A one-sided window lets an attacker
    // mint a callback that stays valid for as long as they like.
    const driver = createSimulatedPayments();
    const aheadMs = NOW + REPLAY_TOLERANCE_MS + 1_000;
    const deliveries = await chargeAndDeliver(driver, "future", aheadMs);

    const verdict = verifyWebhookSignature({
      body: deliveries[0]?.body ?? "",
      secret: driver.webhookSecret,
      signature: deliveries[0]?.headers[SIGNATURE_HEADER],
      timestamp: deliveries[0]?.headers[TIMESTAMP_HEADER],
      nowMs: NOW,
    });
    expect(verdict._unsafeUnwrapErr().kind).toBe("future_timestamp");
  });

  it("rejects a non-numeric timestamp without throwing", async () => {
    const driver = createSimulatedPayments();
    const deliveries = await chargeAndDeliver(driver, "garbage-timestamp");

    const verdict = verifyWebhookSignature({
      body: deliveries[0]?.body ?? "",
      secret: driver.webhookSecret,
      signature: deliveries[0]?.headers[SIGNATURE_HEADER],
      timestamp: "not-a-number",
      nowMs: NOW,
    });
    expect(verdict._unsafeUnwrapErr().kind).toBe("malformed_timestamp");
  });

  it("rejects a signature of the wrong length without throwing", () => {
    // `timingSafeEqual` throws on a length mismatch, so the comparison has
    // to check length deliberately. A throw here would become a 500 — and a
    // 500 on a forged signature tells the forger they got the length wrong.
    const verdict = verifyWebhookSignature({
      body: "{}",
      secret: "s",
      signature: "abc",
      timestamp: String(NOW),
      nowMs: NOW,
    });
    expect(verdict._unsafeUnwrapErr().kind).toBe("bad_signature");
  });
});

describe("replay is a separate defence from the signature", () => {
  it("admits a duplicate delivery's signature but processes it once", async () => {
    // At-least-once is the normal guarantee. Both copies are genuinely from
    // the provider and both signatures are valid — the signature cannot help
    // here, and a handler that credits on each arrival credits twice.
    const driver = createSimulatedPayments({ kind: "duplicate_webhook" });
    const deliveries = await chargeAndDeliver(driver, "dupe");
    expect(deliveries).toHaveLength(4);

    const inbox = createInMemoryWebhookInbox();
    const outcomes: string[] = [];

    for (const delivery of deliveries) {
      const verified = verifyWebhookSignature({
        body: delivery.body,
        secret: driver.webhookSecret,
        signature: delivery.headers[SIGNATURE_HEADER],
        timestamp: delivery.headers[TIMESTAMP_HEADER],
        nowMs: NOW,
      });
      // Every copy verifies. That is the point.
      expect(verified.isOk()).toBe(true);

      const payload: { id?: string } = JSON.parse(delivery.body) as { id?: string };
      outcomes.push(inbox.admit(payload.id ?? ""));
    }

    expect(outcomes).toStrictEqual([
      "process",
      "already_processed",
      "process",
      "already_processed",
    ]);
    expect(inbox.admittedCount).toBe(2);
  });

  it("still verifies when events arrive out of order", async () => {
    // Ordering is not something a signature speaks to, and a handler that
    // rejected an out-of-order callback would drop real traffic. Applying
    // them in the wrong ORDER is the bug, and that is the handler's problem
    // to solve with the sequence number — not the verifier's.
    const driver = createSimulatedPayments({ kind: "out_of_order_webhook" });
    const deliveries = await chargeAndDeliver(driver, "ooo");

    for (const delivery of deliveries) {
      const verified = verifyWebhookSignature({
        body: delivery.body,
        secret: driver.webhookSecret,
        signature: delivery.headers[SIGNATURE_HEADER],
        timestamp: delivery.headers[TIMESTAMP_HEADER],
        nowMs: NOW,
      });
      expect(verified.isOk()).toBe(true);
    }

    const statuses = deliveries.map(
      (delivery) => (JSON.parse(delivery.body) as { status?: string }).status,
    );
    expect(statuses).toStrictEqual(["settled", "pending"]);
  });
});

describe("charge idempotency", () => {
  it("returns the original charge for a replayed key, and charges once", async () => {
    // Paired with the `timeout` fault, which says the far side may have
    // succeeded: the only safe retry is one carrying the same key.
    const driver = createSimulatedPayments();
    const request = {
      idempotencyKey: "same-key",
      amountMinor: 4_500_000,
      currency: "IDR" as const,
      reference: "ref",
    };

    const first = await driver.charge(request);
    const second = await driver.charge(request);

    expect(second._unsafeUnwrap().providerReference).toBe(first._unsafeUnwrap().providerReference);
    expect(driver.received(first._unsafeUnwrap().providerReference)?.amount).toBe(4_500_000);
  });
});
