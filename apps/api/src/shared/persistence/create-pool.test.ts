import { describe, expect, it } from "vitest";
import { createPool } from "./create-pool";

/**
 * 13.3.t. A pool with no `error` listener crashes the process when an idle
 * client's connection drops. Needs no database: nothing connects.
 */
describe("createPool", () => {
  it("does not throw when an idle client error is emitted", async () => {
    const pool = createPool("postgres://yourtal_app:unused@127.0.0.1:1/yourtal_test_unit");
    try {
      expect(pool.listenerCount("error")).toBeGreaterThan(0);
      expect(() =>
        pool.emit("error", new Error("Connection terminated unexpectedly")),
      ).not.toThrow();
    } finally {
      await pool.end();
    }
  });

  it("passes pool options through", async () => {
    const pool = createPool("postgres://yourtal_app:unused@127.0.0.1:1/yourtal_test_unit", {
      max: 1,
    });
    try {
      expect(pool.options.max).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
