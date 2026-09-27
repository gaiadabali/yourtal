import { describe, expect, it } from "vitest";
import { errorCopyFor } from "./merchant-redemption-error-copy";

describe("errorCopyFor", () => {
  it("resolves each known code, in the given locale", () => {
    expect(errorCopyFor({ code: "voucher_not_found" }, "en-AU", "AUD").heading).toMatch(
      /not found/i,
    );
    expect(errorCopyFor({ code: "voucher_not_found" }, "id-ID", "AUD").heading).toMatch(
      /tidak ditemukan/i,
    );
    expect(errorCopyFor({ code: "already_redeemed" }, "en-AU", "AUD").heading).toMatch(/already/i);
    expect(errorCopyFor({ code: "amount_not_positive" }, "en-AU", "AUD").body).toMatch(
      /greater than zero/i,
    );
  });

  it("interpolates the remaining value into amount-related copy", () => {
    const copy = errorCopyFor(
      { code: "amount_exceeds_remaining_value", remainingValueMinor: 500 },
      "en-AU",
      "AUD",
    );
    expect(copy.body).toContain("$5.00");
  });

  it("formats the expiry date when given, and degrades gracefully without one", () => {
    const withDate = errorCopyFor(
      { code: "expired", expiresAt: "2026-01-01T00:00:00.000Z" },
      "en-AU",
      "AUD",
    );
    expect(withDate.body).toMatch(/2026/);
    expect(() => errorCopyFor({ code: "expired" }, "en-AU", "AUD")).not.toThrow();
  });

  it("falls back to the server's own message for an unmapped code", () => {
    const copy = errorCopyFor(
      { code: "some_future_server_code", fallbackMessage: "a brand-new refusal" },
      "en-AU",
      "AUD",
    );
    expect(copy.body).toBe("a brand-new refusal");
  });

  it("falls back to a generic network-error message when there is no server message either", () => {
    const copy = errorCopyFor({ code: "some_future_server_code" }, "en-AU", "AUD");
    expect(copy.body.length).toBeGreaterThan(0);
  });
});
