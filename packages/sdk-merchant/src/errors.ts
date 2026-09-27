import type { MerchantApiErrorBody } from "./types";

/**
 * Thrown when the server answered with `>= 400` and a parseable
 * `MerchantApiErrorBody` (`services/voucher/internal/httpx/json.go`'s
 * `ErrorEnvelope`). Carries the server's own `type`/`code` rather than
 * collapsing everything to a message string, so a caller can branch on
 * `error.code` (e.g. `"voucher_not_found"` vs `"already_redeemed"`) without
 * parsing prose.
 */
export class MerchantApiError extends Error {
  readonly httpStatus: number;
  readonly type: string;
  readonly code: string;
  readonly param: string | undefined;

  constructor(httpStatus: number, body: MerchantApiErrorBody) {
    super(`${body.error.code}: ${body.error.message}`);
    this.name = "MerchantApiError";
    this.httpStatus = httpStatus;
    this.type = body.error.type;
    this.code = body.error.code;
    this.param = body.error.param;
  }
}

/**
 * Thrown when the response could not be parsed as a `MerchantApiErrorBody`
 * at all (a proxy's plain-text 502, a truncated body) — still an HTTP
 * error, just not one the voucher service itself produced.
 */
export class MerchantUnparseableErrorResponse extends Error {
  readonly httpStatus: number;
  readonly bodyText: string;

  constructor(httpStatus: number, bodyText: string) {
    super(`request failed with HTTP ${httpStatus} and an unparseable error body`);
    this.name = "MerchantUnparseableErrorResponse";
    this.httpStatus = httpStatus;
    this.bodyText = bodyText;
  }
}

/** Thrown when `fetch` itself rejected — no response was ever received. */
export class MerchantNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MerchantNetworkError";
  }
}

/**
 * Whether an error from one attempt is worth retrying, per TASKS.md 8.3.b:
 * "Retry only network errors, 429 and 5xx." Everything else (4xx other than
 * 429, or a successfully parsed 4xx business error) is a fact about the
 * request that a retry cannot change.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof MerchantNetworkError) return true;
  if (error instanceof MerchantApiError) return error.httpStatus === 429 || error.httpStatus >= 500;
  if (error instanceof MerchantUnparseableErrorResponse) {
    return error.httpStatus === 429 || error.httpStatus >= 500;
  }
  return false;
}
