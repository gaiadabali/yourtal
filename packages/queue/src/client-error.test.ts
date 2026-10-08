import { describe, expect, it, vi } from "vitest";
import { createQueueClient } from "./client";

/**
 * 13.3.t. pg-boss re-emits a dropped Postgres connection as `error`. Node
 * throws an `error` event nobody listens for, which exited the api. These
 * need no database: the client is built but never started.
 */
const URL = "postgres://yourtal_app:unused@127.0.0.1:1/yourtal_test_unit";

describe("createQueueClient error handling", () => {
  it("hands an emitted error to onError instead of throwing", () => {
    const onError = vi.fn();
    const boss = createQueueClient({ databaseUrl: URL, onError });
    const error = new Error("Connection terminated unexpectedly");

    expect(() => boss.emit("error", error)).not.toThrow();
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("logs to console.error by default and does not throw", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const boss = createQueueClient({ databaseUrl: URL });
      expect(() =>
        boss.emit("error", new Error("Connection terminated unexpectedly")),
      ).not.toThrow();
      expect(spy).toHaveBeenCalledOnce();
      expect(String(spy.mock.calls[0]?.[0])).toContain("Connection terminated unexpectedly");
    } finally {
      spy.mockRestore();
    }
  });

  it("survives an onError that itself throws", () => {
    const boss = createQueueClient({
      databaseUrl: URL,
      onError: () => {
        throw new Error("logger is down");
      },
    });
    expect(() => boss.emit("error", new Error("Connection terminated unexpectedly"))).not.toThrow();
  });
});
