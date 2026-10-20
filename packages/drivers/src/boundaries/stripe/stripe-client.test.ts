import { describe, expect, it } from "vitest";
import {
  STRIPE_API_VERSION,
  STRIPE_TIMEOUT_MS,
  createStripeClient,
  redactSecrets,
  stripeConfigFromEnv,
  stripePath,
} from "./stripe-client";
import { TEST_BASE, TEST_KEY, recordingFetch } from "./stripe-fetch-double";

function clientWith(fetchImpl: typeof fetch, extra: { apiBase?: string; timeoutMs?: number } = {}) {
  return createStripeClient({
    secretKey: TEST_KEY,
    boundary: "payments",
    fetch: fetchImpl,
    ...extra,
  });
}

describe("the Stripe transport", () => {
  it("POSTs a form under the base path prefix with auth, version, idempotency and Stripe-Account", async () => {
    const double = recordingFetch({ status: 200, body: { id: "po_1", object: "payout" } });
    const result = await clientWith(double.fetch, { apiBase: `${TEST_BASE}/` }).post(
      "/v1/payouts",
      { amount: 1250, currency: "aud" },
      { idempotencyKey: "statement-7", stripeAccount: "acct_123" },
    );

    expect(result._unsafeUnwrap()).toStrictEqual({ id: "po_1", object: "payout" });
    expect(double.calls).toStrictEqual([
      {
        url: `${TEST_BASE}/v1/payouts`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_KEY}`,
          "Stripe-Version": STRIPE_API_VERSION,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": "statement-7",
          "Stripe-Account": "acct_123",
        },
        body: "amount=1250&currency=aud",
      },
    ]);
    expect(STRIPE_API_VERSION).toBe("2024-06-20");
  });

  it("GETs with the params in the query string and no idempotency key, defaulting to api.stripe.com", async () => {
    const double = recordingFetch({ status: 200, body: { id: "cs_1" } });
    const session = await clientWith(double.fetch).get(stripePath("checkout", "sessions", "cs_1"), {
      expand: ["setup_intent"],
    });
    expect(session.isOk()).toBe(true);
    const [call] = double.calls;
    expect(call?.url).toBe(
      "https://api.stripe.com/v1/checkout/sessions/cs_1?expand[]=setup_intent",
    );
    expect(call?.method).toBe("GET");
    expect(call?.body).toBeUndefined();
    expect(call?.headers).toStrictEqual({
      Authorization: `Bearer ${TEST_KEY}`,
      "Stripe-Version": STRIPE_API_VERSION,
    });
  });

  it("escapes an id segment so it cannot rewrite the path", () => {
    expect(stripePath("payment_intents", "pi_1/../../accounts", "capture")).toBe(
      "/v1/payment_intents/pi_1%2F..%2F..%2Faccounts/capture",
    );
  });

  it("refuses a POST without an idempotency key, without calling Stripe", async () => {
    const double = recordingFetch({ status: 200, body: {} });
    const result = await clientWith(double.fetch).post("/v1/refunds", {}, { idempotencyKey: " " });
    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: "declined", mayHaveSucceeded: false });
    expect(double.calls).toHaveLength(0);
  });
});

describe("mapping Stripe's answers onto BoundaryFailure", () => {
  const cases = [
    {
      name: "402 card_error → declined, with the decline code",
      status: 402,
      body: {
        error: {
          type: "card_error",
          code: "card_declined",
          decline_code: "generic_decline",
          message: "Your card was declined.",
        },
      },
      expected: { kind: "declined", mayHaveSucceeded: false },
      detail: "generic_decline",
    },
    {
      name: "400 invalid_request_error → declined with Stripe's message",
      status: 400,
      body: {
        error: {
          type: "invalid_request_error",
          code: "amount_too_small",
          message: "Amount must be at least $0.50 aud",
        },
      },
      expected: { kind: "declined", mayHaveSucceeded: false },
      detail: "Amount must be at least $0.50 aud",
    },
    {
      name: "400 idempotency_error (same key, other params) → declined: our bug, never retried",
      status: 400,
      body: {
        error: {
          type: "idempotency_error",
          message: "Keys for idempotent requests can only be used with the same parameters",
        },
      },
      expected: { kind: "declined", mayHaveSucceeded: false },
      detail: "idempotency_error",
    },
    {
      name: "404 resource_missing → declined",
      status: 404,
      body: {
        error: {
          type: "invalid_request_error",
          code: "resource_missing",
          message: "No such payment_intent: 'pi_x'",
        },
      },
      expected: { kind: "declined", mayHaveSucceeded: false },
      detail: "resource_missing",
    },
    {
      name: "409 idempotency conflict → server_error, may have succeeded",
      status: 409,
      body: {
        error: {
          type: "idempotency_error",
          message: "There is currently another in-progress request using this Idempotent Key",
        },
      },
      expected: { kind: "server_error", mayHaveSucceeded: true },
      detail: "409",
    },
    {
      name: "429 → server_error, may have succeeded",
      status: 429,
      body: { error: { type: "rate_limit_error", message: "Too many requests" } },
      expected: { kind: "server_error", mayHaveSucceeded: true },
      detail: "429",
    },
    {
      name: "500 → server_error, may have succeeded",
      status: 500,
      body: { error: { type: "api_error", message: "Something went wrong" } },
      expected: { kind: "server_error", mayHaveSucceeded: true },
      detail: "500",
    },
    {
      name: "a 2xx that is not an object → server_error, may have succeeded",
      status: 200,
      body: "ok",
      expected: { kind: "server_error", mayHaveSucceeded: true },
      detail: "no object",
    },
  ];

  it.each(cases)("$name", async ({ status, body, expected, detail }) => {
    const double = recordingFetch({ status, body });
    const result = await clientWith(double.fetch).post(
      "/v1/payment_intents",
      {},
      { idempotencyKey: "k" },
    );
    const failure = result._unsafeUnwrapErr();
    expect(failure).toMatchObject({ ...expected, boundary: "payments" });
    expect(failure.detail).toContain(detail);
    expect(failure.detail).not.toContain(TEST_KEY);
  });

  it("a network error → timeout, may have succeeded", async () => {
    const failing = (() =>
      Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    const result = await clientWith(failing).post("/v1/transfers", {}, { idempotencyKey: "k" });
    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: "timeout", mayHaveSucceeded: true });
  });

  it("no answer within the timeout → timeout, may have succeeded", async () => {
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "TimeoutError"));
        });
      })) as unknown as typeof fetch;
    const result = await clientWith(hanging, { timeoutMs: 20 }).post(
      "/v1/transfers",
      {},
      { idempotencyKey: "k" },
    );
    const failure = result._unsafeUnwrapErr();
    expect(failure).toMatchObject({ kind: "timeout", mayHaveSucceeded: true });
    expect(failure.detail).toContain("20 ms");
  });

  it("defaults to a 15 s timeout", () => {
    expect(STRIPE_TIMEOUT_MS).toBe(15_000);
  });

  it("never lets the secret key reach a failure, even when Stripe echoes it", async () => {
    const double = recordingFetch({
      status: 401,
      body: {
        error: { type: "invalid_request_error", message: `Invalid API Key provided: ${TEST_KEY}` },
      },
    });
    const failure = (await clientWith(double.fetch).get("/v1/balance"))._unsafeUnwrapErr();
    expect(failure.kind).toBe("declined");
    expect(failure.detail).not.toContain(TEST_KEY);
    expect(failure.detail).not.toContain("SecretKeyThatMustNeverLeak");
    expect(redactSecrets("key sk_live_abcDEF123 and rk_test_x9", "")).toBe(
      "key sk_live_[redacted] and rk_test_[redacted]",
    );
  });
});

describe("configuration", () => {
  it("reads the key, the webhook secret and the base, defaulting the base to Stripe", () => {
    expect(
      stripeConfigFromEnv({ STRIPE_SECRET_KEY: " sk_test_1 ", STRIPE_WEBHOOK_SECRET: "whsec_1" }),
    ).toStrictEqual({
      apiBase: "https://api.stripe.com",
      secretKey: "sk_test_1",
      webhookSecret: "whsec_1",
    });
    expect(
      stripeConfigFromEnv({ STRIPE_SECRET_KEY: "sk_test_1", STRIPE_API_BASE: TEST_BASE }).apiBase,
    ).toBe(TEST_BASE);
  });

  it("refuses to build a live driver without a key", () => {
    expect(() => stripeConfigFromEnv({ STRIPE_SECRET_KEY: " " })).toThrow(/STRIPE_SECRET_KEY/);
  });
});
