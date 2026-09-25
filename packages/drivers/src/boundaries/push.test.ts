import { describe, expect, it } from "vitest";
import { createInMemorySimOutboxStore } from "../sim-outbox";
import { createSimulatedPush } from "./push";

describe("push", () => {
  it("sends a message and records it to the outbox", async () => {
    const store = createInMemorySimOutboxStore();
    const driver = createSimulatedPush(store);

    const result = await driver.send({
      idempotencyKey: "key-1",
      to: "device-token-1",
      region: "AU",
      category: "points_unlocked",
      title: "Points unlocked",
      body: "Your 100 pts are now available.",
    });

    expect(result.isOk()).toBe(true);

    const recorded = await store.record({
      boundary: "push",
      region: "AU",
      recipient: "device-token-1",
      category: "points_unlocked",
      subject: "Points unlocked",
      body: "Your 100 pts are now available.",
      idempotencyKey: "key-1",
    });
    expect(recorded.id).toBe(result._unsafeUnwrap().id);
  });

  it("a replayed idempotency key returns the ORIGINAL send, not a second one", async () => {
    const driver = createSimulatedPush();
    const first = (
      await driver.send({
        idempotencyKey: "key-1",
        to: "device-token-1",
        region: "AU",
        category: "points_unlocked",
        title: "first",
        body: "first",
      })
    )._unsafeUnwrap();

    const replay = (
      await driver.send({
        idempotencyKey: "key-1",
        to: "device-token-2",
        region: "ID",
        category: "streak_reminder",
        title: "second",
        body: "second",
      })
    )._unsafeUnwrap();

    expect(replay).toStrictEqual(first);
  });

  it("a fault plan turns a send into a boundary failure, not an exception", async () => {
    const driver = createSimulatedPush(undefined, { kind: "timeout" });
    const result = await driver.send({
      idempotencyKey: "key-1",
      to: "device-token-1",
      region: "AU",
      category: "points_unlocked",
      title: "title",
      body: "body",
    });
    expect(result.isErr()).toBe(true);
    const failure = result._unsafeUnwrapErr();
    expect(failure.kind).toBe("timeout");
    expect(failure.mayHaveSucceeded).toBe(true);
  });
});
