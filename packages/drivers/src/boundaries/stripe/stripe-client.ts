import { type Result, err, ok } from "neverthrow";
import type { BoundaryFailure } from "../../fault-engine";
import type { Environment } from "../../driver-mode";
import { type StripeParams, encodeStripeForm } from "./stripe-form";
import { type StripeObject, asObject, obj, str } from "./stripe-object";

/**
 * Stripe's REST API over plain `fetch` (no SDK, so the same code reaches api.stripe.com and the payment simulation
 * on staging, F106). Answers map onto `BoundaryFailure`:
 *
 * | answer                         | kind         | mayHaveSucceeded |
 * | 402 card_error                 | declined     | false            |
 * | 409 (idempotency conflict), 429| server_error | true             |
 * | any other 4xx                  | declined     | false            |
 * | 5xx, unreadable 2xx            | server_error | true             |
 * | network error, timeout         | timeout      | true             |
 *
 * The secret key never appears in a failure: Stripe's own messages are scrubbed of anything key-shaped.
 */

export const STRIPE_API_VERSION = "2024-06-20";
export const STRIPE_DEFAULT_API_BASE = "https://api.stripe.com";
export const STRIPE_TIMEOUT_MS = 15_000;

export interface StripeClientConfig {
  /** May carry a path prefix, e.g. http://127.0.0.1:26301/api/paysim. */
  readonly apiBase?: string;
  readonly secretKey: string;
  /** Which boundary failures are attributed to ("payments" | "disbursement"). */
  readonly boundary: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface StripePostOptions {
  readonly idempotencyKey: string;
  /** Makes the call on a connected account. */
  readonly stripeAccount?: string;
}

export interface StripeGetOptions {
  readonly stripeAccount?: string;
}

export interface StripeClient {
  post(
    path: string,
    params: StripeParams,
    options: StripePostOptions,
  ): Promise<Result<StripeObject, BoundaryFailure>>;
  get(
    path: string,
    query?: StripeParams,
    options?: StripeGetOptions,
  ): Promise<Result<StripeObject, BoundaryFailure>>;
  /** DELETE has no body and needs no idempotency key: repeating it is answered 404, which callers read as "gone". */
  delete(path: string, options?: StripeGetOptions): Promise<Result<StripeObject, BoundaryFailure>>;
}

/** Whether a failure is Stripe's 404 `resource_missing` (the object does not exist, or no longer does). */
export function isResourceMissing(failure: BoundaryFailure): boolean {
  return /^Stripe 404 \S+ \(resource_missing\) on /.test(failure.detail);
}

/** `/v1/payment_intents/pi_x/capture`, with each id segment escaped. */
export function stripePath(...segments: readonly string[]): string {
  return `/v1/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

export interface StripeEnvConfig {
  readonly apiBase: string;
  readonly secretKey: string;
  readonly webhookSecret: string | undefined;
}

export function stripeConfigFromEnv(env: Environment): StripeEnvConfig {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  // Defence in depth: `resolveDriverMode` already refuses a live boot without it.
  if (secretKey === undefined || secretKey === "") {
    throw new Error("A live Stripe driver requires STRIPE_SECRET_KEY.");
  }
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  return {
    apiBase: env.STRIPE_API_BASE?.trim() || STRIPE_DEFAULT_API_BASE,
    secretKey,
    webhookSecret: webhookSecret === "" ? undefined : webhookSecret,
  };
}

/** A 2xx whose body is not what Stripe documents. The call went through, so the far side may have acted. */
export function unexpectedAnswer(boundary: string, detail: string): BoundaryFailure {
  return { kind: "server_error", boundary, detail, mayHaveSucceeded: true };
}

/** Removes the key, and anything shaped like a Stripe key, from text that may reach a log. */
export function redactSecrets(text: string, secretKey: string): string {
  const scrubbed = secretKey === "" ? text : text.split(secretKey).join("[redacted]");
  return scrubbed.replace(/\b(sk|rk)_(test|live)_[A-Za-z0-9*]+/g, "$1_$2_[redacted]");
}

export function createStripeClient(config: StripeClientConfig): StripeClient {
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? STRIPE_TIMEOUT_MS;
  const base = (config.apiBase ?? STRIPE_DEFAULT_API_BASE).replace(/\/+$/, "");
  const fail = (kind: BoundaryFailure["kind"], detail: string, mayHaveSucceeded: boolean) =>
    err<never, BoundaryFailure>({
      kind,
      boundary: config.boundary,
      detail: redactSecrets(detail, config.secretKey),
      mayHaveSucceeded,
    });

  async function send(
    method: "GET" | "POST" | "DELETE",
    path: string,
    params: StripeParams,
    idempotencyKey: string | undefined,
    stripeAccount: string | undefined,
  ): Promise<Result<StripeObject, BoundaryFailure>> {
    const form = encodeStripeForm(params);
    const url = method === "GET" && form !== "" ? `${base}${path}?${form}` : `${base}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.secretKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
    };
    if (method === "POST") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      if (idempotencyKey !== undefined) headers["Idempotency-Key"] = idempotencyKey;
    }
    if (stripeAccount !== undefined) headers["Stripe-Account"] = stripeAccount;
    const call = `${method} ${path}`;

    const signal = AbortSignal.timeout(timeoutMs);
    let status: number;
    let text: string;
    try {
      const response = await doFetch(url, {
        method,
        headers,
        ...(method === "POST" ? { body: form } : {}),
        signal,
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      const name = error instanceof Error ? error.name : "unknown";
      return signal.aborted
        ? fail("timeout", `Stripe did not answer ${call} within ${String(timeoutMs)} ms.`, true)
        : fail("timeout", `The request ${call} to Stripe failed (${name}).`, true);
    }

    let body: StripeObject | undefined;
    try {
      body = asObject(JSON.parse(text));
    } catch {
      body = undefined;
    }

    if (status >= 200 && status < 300) {
      return body === undefined
        ? fail(
            "server_error",
            `Stripe answered ${call} with ${String(status)} and no object.`,
            true,
          )
        : ok(body);
    }

    const error = obj(body, "error");
    const type = str(error, "type") ?? "unknown";
    const code = str(error, "decline_code") ?? str(error, "code");
    const message = (str(error, "message") ?? "no message").slice(0, 300);
    const summary = `Stripe ${String(status)} ${type}${code === undefined ? "" : ` (${code})`} on ${call}: ${message}`;

    if (status === 402)
      return fail("declined", `Card declined: ${code ?? "unknown"}. ${summary}`, false);
    if (status === 409 || status === 429 || status >= 500)
      return fail("server_error", summary, true);
    return fail("declined", summary, false);
  }

  return {
    post(path, params, options) {
      if (options.idempotencyKey.trim() === "") {
        return Promise.resolve(fail("declined", `POST ${path} needs an Idempotency-Key.`, false));
      }
      return send("POST", path, params, options.idempotencyKey, options.stripeAccount);
    },
    get(path, query = {}, options = {}) {
      return send("GET", path, query, undefined, options.stripeAccount);
    },
    delete(path, options = {}) {
      return send("DELETE", path, {}, undefined, options.stripeAccount);
    },
  };
}
