import { createHash } from "node:crypto";
import { type Result, err, ok } from "neverthrow";
import type { Currency } from "@yourtal/contracts/money/currency";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode, Environment } from "../driver-mode";
import { refuseLiveDriver } from "../live-driver";
import { toProviderAmount } from "./provider-amount";

/**
 * 13.22 (F86): card holds for charity auction bids, captured straight into
 * the charity's own provider account (a destination charge, Stripe Connect
 * or Xendit sub-account style). YourTal is never the settlement account:
 * `capture` takes the charity's `destinationReference` and the provider
 * pays it, so no YourTal balance ever holds the money (red line 8).
 *
 * The simulator is stateless: every reference is derived from the caller's
 * idempotency key, so a hold placed before a restart can still be captured
 * or released after it (auctions run for days). Declared exponents follow
 * T-1: AUD in cents, IDR in whole rupiah.
 */
export interface HoldRequest {
  readonly idempotencyKey: string;
  /** In OUR stored minor units. */
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly reference: string;
}

export interface Hold {
  readonly holdReference: string;
  readonly providerAmount: number;
}

export interface CaptureRequest {
  readonly idempotencyKey: string;
  readonly holdReference: string;
  readonly amountMinor: number;
  readonly currency: Currency;
  /** The charity's own provider account. Never a YourTal account. */
  readonly destinationReference: string;
}

export interface Capture {
  readonly captureReference: string;
  readonly destinationReference: string;
  readonly providerAmount: number;
}

export interface MarketplacePaymentsDriver {
  readonly mode: DriverMode;
  hold(request: HoldRequest): Promise<Result<Hold, BoundaryFailure>>;
  capture(request: CaptureRequest): Promise<Result<Capture, BoundaryFailure>>;
  release(holdReference: string): Promise<Result<void, BoundaryFailure>>;
}

const EXPONENTS: Record<Currency, number> = { AUD: 2, IDR: 0 };

function reference(prefix: string, key: string): string {
  return `${prefix}_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

function convert(amountMinor: number, currency: Currency): Result<number, BoundaryFailure> {
  const converted = toProviderAmount(amountMinor, currency, EXPONENTS[currency]);
  if (converted.isErr()) {
    return err({
      kind: "declined",
      boundary: "payments",
      detail: converted.error.detail,
      mayHaveSucceeded: false,
    });
  }
  return ok(converted.value);
}

/** `faultPlan` shapes `hold` (a declined card) and `capture` (a failed capture). */
export function createSimulatedMarketplacePayments(
  faultPlan?: FaultPlan,
): MarketplacePaymentsDriver {
  const engine = new FaultEngine(faultPlan);
  const proceed = (): Result<void, BoundaryFailure> => {
    const directive = engine.nextCall();
    return directive === "proceed" ? ok(undefined) : err(failureFor("payments", directive));
  };

  return {
    mode: "simulated",
    hold(request) {
      const amount = convert(request.amountMinor, request.currency);
      if (amount.isErr()) return Promise.resolve(err(amount.error));
      const allowed = proceed();
      if (allowed.isErr()) return Promise.resolve(err(allowed.error));
      return Promise.resolve(
        ok({
          holdReference: reference("simhold", request.idempotencyKey),
          providerAmount: amount.value,
        }),
      );
    },
    capture(request) {
      if (request.destinationReference.trim() === "") {
        return Promise.resolve(
          err({
            kind: "declined",
            boundary: "payments",
            detail: "a capture needs the charity's destination account",
            mayHaveSucceeded: false,
          }),
        );
      }
      const amount = convert(request.amountMinor, request.currency);
      if (amount.isErr()) return Promise.resolve(err(amount.error));
      const allowed = proceed();
      if (allowed.isErr()) return Promise.resolve(err(allowed.error));
      return Promise.resolve(
        ok({
          captureReference: reference("simcap", request.idempotencyKey),
          destinationReference: request.destinationReference,
          providerAmount: amount.value,
        }),
      );
    },
    release() {
      return Promise.resolve(ok(undefined));
    },
  };
}

export function createMarketplacePaymentsDriver(
  mode: DriverMode,
  _env: Environment,
  faultPlan?: FaultPlan,
): MarketplacePaymentsDriver {
  return mode === "simulated"
    ? createSimulatedMarketplacePayments(faultPlan)
    : refuseLiveDriver("payments");
}
