import { describe, expect, it, vi, afterEach } from "vitest";
import { ledgerErrorCodeSchema } from "@yourtal/contracts/ledger-internal/ledger-error";
import { HttpLedgerClient } from "./http-ledger-client";
import { parseLedgerRefusal } from "./parse-ledger-refusal";

/**
 * 13.3.j. The Go ledger answers a contract refusal as 409 `{code, message}`
 * and every other refusal as 400 `{error: {type, code: "refused", message}}`
 * (services/ledger/internal/api/routes.go `fail`). No database needed.
 */
describe("parseLedgerRefusal", () => {
  it.each(ledgerErrorCodeSchema.options)("types the flat 409 contract code %s", (code) => {
    expect(parseLedgerRefusal(409, { code, message: "m" })).toEqual({ code, message: "m" });
  });

  it("types the 400 envelope the ledger writes for a points mismatch", () => {
    const body = {
      error: {
        type: "invalid_request_error",
        code: "refused",
        message: "reward: the points are not what the campaign's terms pay",
      },
    };
    expect(parseLedgerRefusal(400, body)).toEqual({
      code: "refused",
      message: "reward: the points are not what the campaign's terms pay",
    });
  });

  it.each([400, 409, 422])("answers an unknown code on %i as refused", (status) => {
    expect(parseLedgerRefusal(status, { code: "something_new", message: "nope" })).toEqual({
      code: "refused",
      message: "nope",
    });
    expect(parseLedgerRefusal(status, { error: { code: "something_new" } })).toEqual({
      code: "refused",
      message: "refused",
    });
    expect(parseLedgerRefusal(status, null)).toEqual({ code: "refused", message: "refused" });
  });

  it("leaves a missing thing and an outage to the caller to throw", () => {
    expect(parseLedgerRefusal(404, { error: { code: "not_found", message: "x" } })).toBeNull();
    expect(parseLedgerRefusal(500, { error: { code: "internal_error", message: "x" } })).toBeNull();
    expect(parseLedgerRefusal(502, null)).toBeNull();
  });
});

describe("HttpLedgerClient on a refused grant", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const grant = {
    campaignId: "c",
    userId: "u",
    region: "AU",
    points: 100,
    trustTier: 1,
    idempotencyKey: "k",
    attestation: {},
    timingSuspicious: false,
  } as never;

  function answer(status: number, body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    return new HttpLedgerClient("http://ledger.invalid", "unit-test-secret", {} as never);
  }

  it("returns a typed refusal for the 400 envelope instead of rejecting", async () => {
    const client = answer(400, {
      error: { type: "invalid_request_error", code: "refused", message: "points mismatch" },
    });
    const result = await client.grantReward(grant);
    expect(result.isErr() && result.error).toEqual({ code: "refused", message: "points mismatch" });
  });

  it("returns a typed refusal for an unknown 409 code", async () => {
    const client = answer(409, { code: "brand_new_code", message: "unknown to us" });
    const result = await client.grantReward(grant);
    expect(result.isErr() && result.error.code).toBe("refused");
  });

  it("still rejects on a 500", async () => {
    const client = answer(500, { error: { code: "internal_error", message: "boom" } });
    await expect(client.grantReward(grant)).rejects.toThrow(/answered 500/);
  });
});
