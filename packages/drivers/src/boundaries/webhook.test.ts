import { describe, expect, it } from "vitest";
import { createInMemorySimOutboxStore } from "../sim-outbox";
import { createSimulatedWebhook } from "./webhook";

describe("webhook", () => {
  it("sends a delivery and records it to the outbox as its JSON body", async () => {
    const store = createInMemorySimOutboxStore();
    const driver = createSimulatedWebhook(store);

    const result = await driver.send({
      idempotencyKey: "key-1",
      url: "https://partner.example.test/webhooks/yourtal",
      region: "AU",
      event: "voucher.captured",
      payload: { voucherId: "v_1", pointsBurned: 900 },
    });

    expect(result.isOk()).toBe(true);

    const recorded = await store.record({
      boundary: "webhook",
      region: "AU",
      recipient: "https://partner.example.test/webhooks/yourtal",
      category: "voucher.captured",
      body: JSON.stringify({ voucherId: "v_1", pointsBurned: 900 }),
      idempotencyKey: "key-1",
    });
    expect(recorded.id).toBe(result._unsafeUnwrap().id);
  });

  it("a replayed idempotency key returns the ORIGINAL send, not a second one", async () => {
    const driver = createSimulatedWebhook();
    const first = (
      await driver.send({
        idempotencyKey: "key-1",
        url: "https://partner.example.test/webhooks/yourtal",
        region: "AU",
        event: "voucher.captured",
        payload: { a: 1 },
      })
    )._unsafeUnwrap();

    const replay = (
      await driver.send({
        idempotencyKey: "key-1",
        url: "https://a-different-partner.example.test/hook",
        region: "ID",
        event: "voucher.refunded",
        payload: { b: 2 },
      })
    )._unsafeUnwrap();

    expect(replay).toStrictEqual(first);
  });

  it("a fault plan turns a send into a boundary failure, not an exception", async () => {
    const driver = createSimulatedWebhook(undefined, { kind: "transient_5xx_then_success" });
    const result = await driver.send({
      idempotencyKey: "key-1",
      url: "https://partner.example.test/webhooks/yourtal",
      region: "AU",
      event: "voucher.captured",
      payload: {},
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe("server_error");
  });
});
