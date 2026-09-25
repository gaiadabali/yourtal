import { describe, expect, it } from "vitest";
import { createInMemorySimOutboxStore } from "../sim-outbox";
import { createSimulatedEmail } from "./email";

describe("email", () => {
  it("sends a message and records it to the outbox", async () => {
    const store = createInMemorySimOutboxStore();
    const driver = createSimulatedEmail(store);

    const result = await driver.send({
      idempotencyKey: "key-1",
      to: "person@example.test",
      region: "AU",
      category: "email_verification",
      subject: "Verify your email",
      body: "Click the link.",
    });

    expect(result.isOk()).toBe(true);

    const recorded = await store.record({
      boundary: "email",
      region: "AU",
      recipient: "person@example.test",
      category: "email_verification",
      subject: "Verify your email",
      body: "Click the link.",
      idempotencyKey: "key-1",
    });
    // `store.record` with the same idempotencyKey replays the row the
    // driver's own send already created, proving the driver actually wrote
    // through to the shared store rather than keeping its own state.
    expect(recorded.id).toBe(result._unsafeUnwrap().id);
  });

  it("a replayed idempotency key returns the ORIGINAL send, not a second one", async () => {
    const driver = createSimulatedEmail();
    const first = (
      await driver.send({
        idempotencyKey: "key-1",
        to: "person@example.test",
        region: "AU",
        category: "email_verification",
        subject: "Verify your email",
        body: "first",
      })
    )._unsafeUnwrap();

    const replay = (
      await driver.send({
        idempotencyKey: "key-1",
        to: "someone-else@example.test",
        region: "ID",
        category: "password_reset",
        subject: "Reset your password",
        body: "second",
      })
    )._unsafeUnwrap();

    expect(replay).toStrictEqual(first);
  });

  it("a fault plan turns a send into a boundary failure, not an exception", async () => {
    const driver = createSimulatedEmail(undefined, { kind: "decline" });
    const result = await driver.send({
      idempotencyKey: "key-1",
      to: "person@example.test",
      region: "AU",
      category: "email_verification",
      subject: "Verify your email",
      body: "body",
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().kind).toBe("declined");
  });
});
