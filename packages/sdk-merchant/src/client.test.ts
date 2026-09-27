import { describe, expect, it, vi } from "vitest";
import { createMerchantClient, type FetchLike } from "./client";
import { MerchantApiError, MerchantNetworkError } from "./errors";
import { IDEMPOTENCY_HEADER, SIGNATURE_HEADER } from "./signing";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

// Full response shapes, matching the Go structs exactly
// (`services/voucher/internal/redeem/routes.go`/`routes_release.go`) — a
// mock that only sent `authorization_id` would let a bug in this SDK's
// response-parsing silently fill in `undefined` for every other field.
function authorizeResponseBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    authorization_id: "auth_1",
    amount_authorized: 500,
    remaining_balance: 2500,
    expires_at: "2026-09-27T00:05:00Z",
    ...overrides,
  };
}

function captureResponseBody(overrides: Partial<Record<string, unknown>> = {}) {
  return { receipt_id: "rcpt_1", amount_captured: 400, remaining_balance: 100, ...overrides };
}

function voidResponseBody(overrides: Partial<Record<string, unknown>> = {}) {
  return { authorization_id: "auth_1", voided: true, ...overrides };
}

function refundResponseBody(overrides: Partial<Record<string, unknown>> = {}) {
  return { receipt_id: "rcpt_1", refunded: true, ...overrides };
}

const NOOP_SLEEP = () => Promise.resolve();

describe("createMerchantClient", () => {
  it("signs, calls the right path, and maps the snake_case response to camelCase", async () => {
    const fetchMock = vi.fn<FetchLike>(() =>
      Promise.resolve(jsonResponse(200, authorizeResponseBody())),
    );
    const client = createMerchantClient({
      baseUrl: "https://voucher.example",
      keyId: "key_live_1",
      secret: "shh",
      fetch: fetchMock,
      clock: () => new Date("2026-09-27T00:00:00.000Z"),
    });

    const result = await client.authorize({ code: "ABC123", amountMinor: 500, currency: "AUD" });

    expect(result).toEqual({
      authorizationId: "auth_1",
      amountAuthorized: 500,
      remainingBalance: 2500,
      expiresAt: "2026-09-27T00:05:00Z",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://voucher.example/v1/vouchers/authorize");
    expect(init.method).toBe("POST");
    expect(init.headers[SIGNATURE_HEADER]).toMatch(/^t=\d+,k=key_live_1,v1=[0-9a-f]{64}$/);
    expect(init.headers[IDEMPOTENCY_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
    // Field names as the Go request struct's own JSON tags name them
    // (`amount`/`currency`, no `_minor` suffix on the wire) — see
    // `client.ts`'s `authorizeBody` doc comment.
    expect(JSON.parse(init.body)).toEqual({ code: "ABC123", amount: 500, currency: "AUD" });
  });

  it("drops undefined optional fields rather than sending them as null", async () => {
    const fetchMock = vi.fn<FetchLike>(() =>
      Promise.resolve(jsonResponse(200, authorizeResponseBody())),
    );
    const client = createMerchantClient({
      baseUrl: "https://voucher.example",
      keyId: "k",
      secret: "s",
      fetch: fetchMock,
    });
    await client.authorize({ code: "ABC", amountMinor: 1, currency: "IDR" });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body) as Record<string, unknown>;
    expect(body).not.toHaveProperty("merchant_order_ref");
    expect(body).not.toHaveProperty("order_total");
  });

  it("sends orderTotalMinor as the wire's order_total when given", async () => {
    const fetchMock = vi.fn<FetchLike>(() =>
      Promise.resolve(jsonResponse(200, authorizeResponseBody())),
    );
    const client = createMerchantClient({
      baseUrl: "https://v.example",
      keyId: "k",
      secret: "s",
      fetch: fetchMock,
    });
    await client.authorize({
      code: "ABC",
      amountMinor: 300,
      currency: "AUD",
      merchantOrderRef: "ORDER-1",
      orderTotalMinor: 500,
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body) as Record<string, unknown>;
    expect(body).toEqual({
      code: "ABC",
      amount: 300,
      currency: "AUD",
      merchant_order_ref: "ORDER-1",
      order_total: 500,
    });
  });

  it("maps capture/void/refund to their own routes and wire bodies, and parses their responses", async () => {
    const fetchMock = vi.fn<FetchLike>((url) => {
      if (url.endsWith("/capture"))
        return Promise.resolve(jsonResponse(200, captureResponseBody()));
      if (url.endsWith("/void")) return Promise.resolve(jsonResponse(200, voidResponseBody()));
      return Promise.resolve(jsonResponse(200, refundResponseBody()));
    });
    const client = createMerchantClient({
      baseUrl: "https://v.example",
      keyId: "k",
      secret: "s",
      fetch: fetchMock,
    });

    const capture = await client.capture({ authorizationId: "auth_1", finalAmountMinor: 400 });
    const voidResult = await client.void({ authorizationId: "auth_1" });
    const refund = await client.refund({
      receiptId: "rcpt_1",
      amountMinor: 100,
      reason: "customer_request",
      refundRef: "R-1",
    });

    expect(capture).toEqual({ receiptId: "rcpt_1", amountCaptured: 400, remainingBalance: 100 });
    expect(voidResult).toEqual({ authorizationId: "auth_1", voided: true });
    expect(refund).toEqual({ receiptId: "rcpt_1", refunded: true });

    const [captureUrl, captureInit] = fetchMock.mock.calls[0]!;
    expect(captureUrl).toBe("https://v.example/v1/vouchers/capture");
    expect(JSON.parse(captureInit.body)).toEqual({ authorization_id: "auth_1", final_amount: 400 });

    const [voidUrl, voidInit] = fetchMock.mock.calls[1]!;
    expect(voidUrl).toBe("https://v.example/v1/vouchers/void");
    expect(JSON.parse(voidInit.body)).toEqual({ authorization_id: "auth_1" });

    const [refundUrl, refundInit] = fetchMock.mock.calls[2]!;
    expect(refundUrl).toBe("https://v.example/v1/vouchers/refund");
    expect(JSON.parse(refundInit.body)).toEqual({
      receipt_id: "rcpt_1",
      amount: 100,
      reason: "customer_request",
      refund_ref: "R-1",
    });
  });

  it("throws a clear error when the response is missing a field this SDK's type requires", async () => {
    const fetchMock = vi.fn<FetchLike>(() =>
      Promise.resolve(
        jsonResponse(200, { authorization_id: "auth_1" /* missing everything else */ }),
      ),
    );
    const client = createMerchantClient({
      baseUrl: "https://v.example",
      keyId: "k",
      secret: "s",
      fetch: fetchMock,
    });
    await expect(
      client.authorize({ code: "ABC", amountMinor: 1, currency: "AUD" }),
    ).rejects.toThrow(/amount_authorized/);
  });

  it("reuses the SAME Idempotency-Key and body across every retry", async () => {
    let attempt = 0;
    const fetchMock = vi.fn<FetchLike>(() => {
      attempt += 1;
      if (attempt < 3) {
        return Promise.resolve(
          jsonResponse(503, { error: { type: "api_error", code: "unavailable", message: "down" } }),
        );
      }
      return Promise.resolve(
        jsonResponse(200, authorizeResponseBody({ authorization_id: "auth_ok" })),
      );
    });
    const client = createMerchantClient({
      baseUrl: "https://v.example",
      keyId: "k",
      secret: "s",
      fetch: fetchMock,
      retry: { maxAttempts: 5, sleep: NOOP_SLEEP, random: () => 0 },
    });

    const result = await client.authorize({ code: "ABC", amountMinor: 1, currency: "AUD" });
    expect(result.authorizationId).toBe("auth_ok");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const idempotencyKeys = fetchMock.mock.calls.map((call) => call[1].headers[IDEMPOTENCY_HEADER]);
    expect(new Set(idempotencyKeys).size).toBe(1);
    const bodies = fetchMock.mock.calls.map((call) => call[1].body);
    expect(new Set(bodies).size).toBe(1);
  });

  it("retries a network error (fetch rejecting) and eventually succeeds", async () => {
    let attempt = 0;
    const fetchMock = vi.fn<FetchLike>(() => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error("ECONNRESET"));
      return Promise.resolve(jsonResponse(200, authorizeResponseBody()));
    });
    const client = createMerchantClient({
      baseUrl: "https://v.example",
      keyId: "k",
      secret: "s",
      fetch: fetchMock,
      retry: { sleep: NOOP_SLEEP },
    });
    const result = await client.authorize({ code: "ABC", amountMinor: 1, currency: "AUD" });
    expect(result.authorizationId).toBe("auth_1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws MerchantNetworkError (wrapping the cause) when every attempt fails on the network", async () => {
    const fetchMock = vi.fn<FetchLike>(() => Promise.reject(new Error("ECONNRESET")));
    const client = createMerchantClient({
      baseUrl: "https://v.example",
      keyId: "k",
      secret: "s",
      fetch: fetchMock,
      retry: { maxAttempts: 2, sleep: NOOP_SLEEP },
    });
    await expect(
      client.authorize({ code: "ABC", amountMinor: 1, currency: "AUD" }),
    ).rejects.toThrow(MerchantNetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404 voucher_not_found, and surfaces it as a typed MerchantApiError", async () => {
    const fetchMock = vi.fn<FetchLike>(() =>
      Promise.resolve(
        jsonResponse(404, {
          error: {
            type: "invalid_request_error",
            code: "voucher_not_found",
            message: "no such voucher",
          },
        }),
      ),
    );
    const client = createMerchantClient({
      baseUrl: "https://v.example",
      keyId: "k",
      secret: "s",
      fetch: fetchMock,
      retry: { maxAttempts: 5, sleep: NOOP_SLEEP },
    });

    const rejection = client.authorize({ code: "ABC", amountMinor: 1, currency: "AUD" });
    await expect(rejection).rejects.toThrow(MerchantApiError);
    await expect(rejection).rejects.toMatchObject({ code: "voucher_not_found", httpStatus: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops retrying a persistent 500 once maxAttempts is spent", async () => {
    const fetchMock = vi.fn<FetchLike>(() =>
      Promise.resolve(
        jsonResponse(500, {
          error: { type: "api_error", code: "internal_error", message: "oops" },
        }),
      ),
    );
    const client = createMerchantClient({
      baseUrl: "https://v.example",
      keyId: "k",
      secret: "s",
      fetch: fetchMock,
      retry: { maxAttempts: 3, sleep: NOOP_SLEEP },
    });
    await expect(
      client.authorize({ code: "ABC", amountMinor: 1, currency: "AUD" }),
    ).rejects.toMatchObject({
      httpStatus: 500,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("honours a 429's Retry-After header", async () => {
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    let attempt = 0;
    const fetchMock = vi.fn<FetchLike>(() => {
      attempt += 1;
      if (attempt === 1) {
        return Promise.resolve(
          jsonResponse(
            429,
            { error: { type: "rate_limit_error", code: "rate_limited", message: "slow down" } },
            { "retry-after": "7" },
          ),
        );
      }
      return Promise.resolve(jsonResponse(200, authorizeResponseBody()));
    });
    const client = createMerchantClient({
      baseUrl: "https://v.example",
      keyId: "k",
      secret: "s",
      fetch: fetchMock,
      retry: { sleep },
    });
    await client.authorize({ code: "ABC", amountMinor: 1, currency: "AUD" });
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it("throws when no fetch is injected and none is ambient", () => {
    const originalFetch = globalThis.fetch;
    // @ts-expect-error deliberately removing it for this one assertion
    delete globalThis.fetch;
    try {
      expect(() =>
        createMerchantClient({ baseUrl: "https://v.example", keyId: "k", secret: "s" }),
      ).toThrow(/no `fetch` available/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
