import { describe, expect, it } from "vitest";
import { createInMemorySimOutboxStore } from "./sim-outbox";

describe("createInMemorySimOutboxStore", () => {
  it("records a message and assigns it an id and a timestamp", async () => {
    const store = createInMemorySimOutboxStore();
    const record = await store.record({
      boundary: "email",
      region: "AU",
      recipient: "person@example.test",
      category: "email_verification",
      subject: "Verify your email",
      body: "Click the link.",
      idempotencyKey: "key-1",
    });

    expect(record.id).toEqual(expect.any(String));
    expect(record.createdAt).toBeInstanceOf(Date);
    expect(record.recipient).toBe("person@example.test");
  });

  it("a replayed (boundary, idempotencyKey) returns the ORIGINAL record, not a second one", async () => {
    const store = createInMemorySimOutboxStore();
    const first = await store.record({
      boundary: "email",
      region: "AU",
      recipient: "person@example.test",
      category: "email_verification",
      body: "first",
      idempotencyKey: "key-1",
    });

    const replay = await store.record({
      boundary: "email",
      region: "AU",
      // Different body on the replay: if this created a second row, the
      // returned record would carry it, and this assertion would catch that.
      recipient: "someone-else@example.test",
      category: "password_reset",
      body: "second",
      idempotencyKey: "key-1",
    });

    expect(replay).toStrictEqual(first);
  });

  it("the same idempotencyKey under a DIFFERENT boundary is a distinct message", async () => {
    const store = createInMemorySimOutboxStore();
    const email = await store.record({
      boundary: "email",
      region: "AU",
      recipient: "person@example.test",
      category: "email_verification",
      body: "an email",
      idempotencyKey: "shared-key",
    });
    const push = await store.record({
      boundary: "push",
      region: "AU",
      recipient: "device-token",
      category: "points_unlocked",
      body: "a push",
      idempotencyKey: "shared-key",
    });

    expect(push.id).not.toBe(email.id);
  });
});
