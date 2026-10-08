import { describe, expect, it, vi } from "vitest";
import { createPool } from "./pool";

/** 13.3.t. A worker pool must log, not crash, when an idle client errors. No database needed. */
describe("createPool", () => {
  it("logs an emitted idle-client error instead of throwing", async () => {
    const log = vi.fn();
    const pool = createPool("postgres://yourtal_app:unused@127.0.0.1:1/yourtal_test_unit", {}, log);
    try {
      expect(() =>
        pool.emit("error", new Error("Connection terminated unexpectedly")),
      ).not.toThrow();
      expect(log).toHaveBeenCalledOnce();
      expect(String(log.mock.calls[0]?.[0])).toContain("Connection terminated unexpectedly");
    } finally {
      await pool.end();
    }
  });
});
