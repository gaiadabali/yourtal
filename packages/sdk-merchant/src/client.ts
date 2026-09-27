import { generateIdempotencyKey } from "./idempotency-key";
import { IDEMPOTENCY_HEADER, SIGNATURE_HEADER, signRequest } from "./signing";
import {
  MerchantApiError,
  MerchantNetworkError,
  MerchantUnparseableErrorResponse,
  isRetryable,
} from "./errors";
import { parseRetryAfterMs, withRetry, type RetryOptions } from "./retry";
import type {
  Authorization,
  AuthorizeParams,
  Capture,
  CaptureParams,
  MerchantApiErrorBody,
  RefundParams,
  RefundResult,
  VoidParams,
  VoidResult,
} from "./types";

/** Minimal shape of the global `fetch`, so a caller can inject any compatible implementation without this package depending on `undici`'s types. */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface MerchantClientOptions {
  /** e.g. `https://voucher.yourtal.example` — no trailing slash needed. */
  baseUrl: string;
  keyId: string;
  secret: string | Uint8Array;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Defaults to `() => new Date()`. Test seam, and useful if a caller already has a synced clock. */
  clock?: () => Date;
  retry?: RetryOptions;
}

export interface MerchantClient {
  authorize(params: AuthorizeParams): Promise<Authorization>;
  capture(params: CaptureParams): Promise<Capture>;
  void(params: VoidParams): Promise<VoidResult>;
  refund(params: RefundParams): Promise<RefundResult>;
}

function isErrorBody(value: unknown): value is MerchantApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = value.error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as Record<string, unknown>).type === "string" &&
    typeof (error as Record<string, unknown>).code === "string" &&
    typeof (error as Record<string, unknown>).message === "string"
  );
}

/**
 * camelCase params to the snake_case-on-the-wire body each route expects.
 * Field names below are taken directly from the Go request structs
 * (`services/voucher/internal/redeem/routes.go`'s `authorizeBody`/
 * `captureBody`, `routes_release.go`'s `voidBody`/`refundBody`) — note that
 * Go's own field names are `amount`/`order_total`/`final_amount`, WITHOUT a
 * `_minor` suffix, even though the value is always minor units; only this
 * SDK's own (camelCase) params add that suffix, for clarity on this side of
 * the wire. `undefined` fields are dropped, never sent as `null`.
 */
function authorizeBody(params: AuthorizeParams): Record<string, unknown> {
  return {
    code: params.code,
    amount: params.amountMinor,
    currency: params.currency,
    ...(params.merchantOrderRef !== undefined && { merchant_order_ref: params.merchantOrderRef }),
    ...(params.orderTotalMinor !== undefined && { order_total: params.orderTotalMinor }),
  };
}

function captureBody(params: CaptureParams): Record<string, unknown> {
  return { authorization_id: params.authorizationId, final_amount: params.finalAmountMinor };
}

function voidBody(params: VoidParams): Record<string, unknown> {
  return { authorization_id: params.authorizationId };
}

function refundBody(params: RefundParams): Record<string, unknown> {
  return {
    receipt_id: params.receiptId,
    amount: params.amountMinor,
    reason: params.reason,
    refund_ref: params.refundRef,
  };
}

/**
 * snake_case-on-the-wire responses to this SDK's camelCase result types.
 * Field names mirror the Go response structs exactly (`authorizeResponse`,
 * `captureResponse`, `voidResponse`, `refundResponse` in the same two
 * files) — a name here that doesn't match one there is a bug, not a style
 * choice, since the server will never send the camelCase this SDK returns.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`${path}: response is missing string field "${key}"`);
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string, path: string): number {
  const value = record[key];
  if (typeof value !== "number") {
    throw new Error(`${path}: response is missing number field "${key}"`);
  }
  return value;
}

function requireBoolean(record: Record<string, unknown>, key: string, path: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`${path}: response is missing boolean field "${key}"`);
  }
  return value;
}

function parseAuthorization(body: unknown, path: string): Authorization {
  if (!isRecord(body)) throw new Error(`${path}: response body is not a JSON object`);
  return {
    authorizationId: requireString(body, "authorization_id", path),
    amountAuthorized: requireNumber(body, "amount_authorized", path),
    remainingBalance: requireNumber(body, "remaining_balance", path),
    expiresAt: requireString(body, "expires_at", path),
  };
}

function parseCapture(body: unknown, path: string): Capture {
  if (!isRecord(body)) throw new Error(`${path}: response body is not a JSON object`);
  return {
    receiptId: requireString(body, "receipt_id", path),
    amountCaptured: requireNumber(body, "amount_captured", path),
    remainingBalance: requireNumber(body, "remaining_balance", path),
  };
}

function parseVoidResult(body: unknown, path: string): VoidResult {
  if (!isRecord(body)) throw new Error(`${path}: response body is not a JSON object`);
  return {
    authorizationId: requireString(body, "authorization_id", path),
    voided: requireBoolean(body, "voided", path),
  };
}

function parseRefundResult(body: unknown, path: string): RefundResult {
  if (!isRecord(body)) throw new Error(`${path}: response body is not a JSON object`);
  return {
    receiptId: requireString(body, "receipt_id", path),
    refunded: requireBoolean(body, "refunded", path),
  };
}

/**
 * Creates a signed, retrying client for the voucher service's merchant HMAC
 * API (TASKS.md 8.3.b). Zero runtime dependencies: signing uses `node:crypto`
 * only, and the HTTP call uses whatever `fetch` is injected or ambient.
 *
 * Every call:
 *  - generates ONE Idempotency-Key and reuses it (with the identical body)
 *    on every retry of that call, never a fresh one per attempt;
 *  - signs each attempt fresh against the clock at that moment, so a
 *    signature never falls outside the server's 5-minute replay window
 *    partway through a slow retry sequence — the idempotency key is what
 *    keeps a duplicate arrival safe, not a frozen timestamp;
 *  - retries only a network error, HTTP 429 or HTTP >= 500 (`errors.ts`'s
 *    `isRetryable`), honouring `Retry-After` when the server sends one.
 */
export function createMerchantClient(options: MerchantClientOptions): MerchantClient {
  // `@types/node` declares the global `fetch` as always present, which is
  // true of every runtime this SDK targets EXCEPT the one this file's own
  // test deliberately simulates (an old Node, or a stripped-down runtime
  // with none). `Partial<>` says so honestly, rather than asserting a
  // non-optional type past what can actually be guaranteed at runtime.
  const ambientFetch = (globalThis as Partial<{ fetch: FetchLike }>).fetch;
  const maybeFetch = options.fetch ?? ambientFetch;
  if (!maybeFetch) {
    throw new Error(
      "createMerchantClient: no `fetch` available. Pass one explicitly (e.g. from `undici` on old Node), or run on a runtime with a global fetch.",
    );
  }
  // Rebound to a definitely-typed `const`: a nested `function` declaration
  // below does not carry the `if (!maybeFetch) throw` narrowing across its
  // own boundary (a known TS limitation for hoisted function declarations,
  // unlike arrow closures), so `doFetch` gives it something already typed
  // as non-optional rather than fighting the narrowing a second time.
  const doFetch: FetchLike = maybeFetch;
  const clock = options.clock ?? (() => new Date());
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  async function call<T>(
    path: string,
    wireBody: Record<string, unknown>,
    parseResponse: (body: unknown, path: string) => T,
  ): Promise<T> {
    const idempotencyKey = generateIdempotencyKey();
    const body = JSON.stringify(wireBody);

    return withRetry(options.retry, isRetryable, retryAfterOf, async () => {
      const signature = signRequest({
        secret: options.secret,
        keyId: options.keyId,
        method: "POST",
        pathAndQuery: path,
        idempotencyKey,
        body,
        timestamp: clock(),
      });

      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await doFetch(`${baseUrl}${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [IDEMPOTENCY_HEADER]: idempotencyKey,
            [SIGNATURE_HEADER]: signature,
          },
          body,
        });
      } catch (cause) {
        throw new MerchantNetworkError(`request to ${path} failed before a response arrived`, {
          cause,
        });
      }

      if (response.ok) return parseResponse(await response.json(), path);

      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        const text = await response.text().catch(() => "");
        throw withRetryAfter(
          new MerchantUnparseableErrorResponse(response.status, text),
          retryAfterMs,
        );
      }
      if (!isErrorBody(parsed)) {
        throw withRetryAfter(
          new MerchantUnparseableErrorResponse(response.status, JSON.stringify(parsed)),
          retryAfterMs,
        );
      }
      throw withRetryAfter(new MerchantApiError(response.status, parsed), retryAfterMs);
    });
  }

  return {
    authorize: (params) =>
      call("/v1/vouchers/authorize", authorizeBody(params), parseAuthorization),
    capture: (params) => call("/v1/vouchers/capture", captureBody(params), parseCapture),
    void: (params) => call("/v1/vouchers/void", voidBody(params), parseVoidResult),
    refund: (params) => call("/v1/vouchers/refund", refundBody(params), parseRefundResult),
  };
}

// A `Retry-After` value travels on the thrown error itself (a WeakMap keeps
// it off the error classes' own public shape, which stays a pure server
// mirror) so `retry.ts` can read it back without either side importing HTTP
// concepts into the other.
const retryAfterByError = new WeakMap<object, number>();

function withRetryAfter<E extends object>(error: E, retryAfterMs: number | undefined): E {
  if (retryAfterMs !== undefined) retryAfterByError.set(error, retryAfterMs);
  return error;
}

function retryAfterOf(error: unknown): number | undefined {
  return typeof error === "object" && error !== null ? retryAfterByError.get(error) : undefined;
}
