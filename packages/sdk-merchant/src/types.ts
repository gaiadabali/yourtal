/**
 * Wire shapes for the voucher service's merchant HMAC API
 * (`services/voucher/internal/redeem/routes.go`,
 * `services/voucher/internal/redeem/routes_release.go`).
 *
 * These are hand-mirrored from the Go JSON structs, not imported from
 * `@yourtal/contracts` — `packages/contracts/src/voucher-internal/redemption.ts`
 * models a DIFFERENT surface (the platform-credential device path, TASKS.md
 * 4.5.c/1.2.b, camelCase field names) and there is no existing TS contract
 * for this merchant-facing, snake_case-on-the-wire HMAC API. If one is added
 * later, prefer it over this file and add a drift test.
 *
 * Amounts are always integer minor units with an explicit currency
 * (AUD exponent 2, IDR exponent 0) — never a float, per the repo-wide rule.
 */

/** The two currencies this platform prices in (`packages/contracts/src/money/currency.ts`). */
export type Currency = "AUD" | "IDR";

/**
 * `authorizeBody` (routes.go). `orderTotalMinor` is the whole basket; a
 * minimum-spend policy is checked against it, not against `amountMinor`
 * (TASKS.md 4.6.c). Omit it and the server treats the order total as equal
 * to `amountMinor`.
 *
 * `code` is the only lookup this SDK sends today. Authorize is meant to
 * also accept a rotating QR token (TASKS.md 4.5.b), but that is not on the
 * server yet — see the package README's "Known gaps" section.
 */
export interface AuthorizeParams {
  code: string;
  amountMinor: number;
  currency: Currency;
  merchantOrderRef?: string;
  orderTotalMinor?: number;
}

/** `authorizeResponse` (routes.go). */
export interface Authorization {
  authorizationId: string;
  amountAuthorized: number;
  remainingBalance: number;
  /** RFC 3339, UTC. */
  expiresAt: string;
}

/** `captureBody` (routes.go). */
export interface CaptureParams {
  authorizationId: string;
  finalAmountMinor: number;
}

/** `captureResponse` (routes.go). */
export interface Capture {
  receiptId: string;
  amountCaptured: number;
  remainingBalance: number;
}

/** `voidBody` (routes_release.go). */
export interface VoidParams {
  authorizationId: string;
}

/** `voidResponse` (routes_release.go). */
export interface VoidResult {
  authorizationId: string;
  voided: boolean;
}

/**
 * `refundBody` (routes_release.go). `refundRef` is the merchant's own
 * reference for this refund and must be unique per capture (TASKS.md
 * 4.6.d) — reusing one that already succeeded is what makes a refund retry
 * safe alongside the Idempotency-Key.
 */
export interface RefundParams {
  receiptId: string;
  amountMinor: number;
  reason: string;
  refundRef: string;
}

/** `refundResponse` (routes_release.go). */
export interface RefundResult {
  receiptId: string;
  refunded: boolean;
}

/**
 * The one error envelope every endpoint uses, >= HTTP 400
 * (`services/voucher/internal/httpx/json.go`, `ErrorEnvelope`).
 */
export interface MerchantApiErrorBody {
  error: {
    type: string;
    code: string;
    message: string;
    param?: string;
  };
}
