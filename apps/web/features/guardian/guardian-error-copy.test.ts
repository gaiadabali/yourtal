import { describe, expect, it } from "vitest";
import { guardianErrorKeyFor } from "./guardian-error-copy";

describe("guardianErrorKeyFor", () => {
  it("maps a network failure", () => {
    expect(guardianErrorKeyFor({ kind: "network", message: "x" })).toBe("network");
  });

  it("maps a contract mismatch", () => {
    expect(guardianErrorKeyFor({ kind: "invalid_response", message: "x" })).toBe(
      "invalid_response",
    );
  });

  it("maps the domain 409 (already_revoked)", () => {
    expect(
      guardianErrorKeyFor({ kind: "http", status: 409, code: "already_revoked", message: "x" }),
    ).toBe("already_revoked");
  });

  it("maps a ledger-unavailable 502 and any other 5xx to unavailable", () => {
    expect(
      guardianErrorKeyFor({ kind: "http", status: 502, code: "ledger_unavailable", message: "x" }),
    ).toBe("unavailable");
    expect(guardianErrorKeyFor({ kind: "http", status: 500, code: "http_500", message: "x" })).toBe(
      "unavailable",
    );
  });

  it("falls back to unknown for anything else, e.g. a 429", () => {
    expect(guardianErrorKeyFor({ kind: "http", status: 429, code: "http_429", message: "x" })).toBe(
      "unknown",
    );
  });
});
