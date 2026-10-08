import { describe, expect, it } from "vitest";
import { createApiQueueClient } from "./create-api-queue-client";

/** 13.3.t. The api's pg-boss client must survive an emitted `error`. No database needed. */
describe("createApiQueueClient", () => {
  it("does not throw when pg-boss emits an error", () => {
    const boss = createApiQueueClient(
      "postgres://yourtal_app:unused@127.0.0.1:1/yourtal_test_unit",
    );
    expect(boss.listenerCount("error")).toBeGreaterThan(0);
    expect(() => boss.emit("error", new Error("Connection terminated unexpectedly"))).not.toThrow();
  });
});
