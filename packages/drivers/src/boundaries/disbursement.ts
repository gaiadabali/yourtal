import { type Result, err, ok } from "neverthrow";
import type { Currency } from "@yourtal/contracts/money/currency";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode, Environment } from "../driver-mode";
import { refuseLiveDriver } from "../live-driver";
import { toProviderAmount } from "./provider-amount";

/**
 * Paying a merchant what their redeemed vouchers settled at.
 *
 * Separated from `payments` rather than folded in as a direction, because
 * the failure consequences are opposite: a failed charge means we did not
 * get paid, and a failed payout means a merchant did not. A payout that
 * silently retries is money leaving twice, so `idempotencyKey` is required
 * here for the same reason it is on `charge`, and the simulator answers a
 * replay instead of paying again.
 *
 * The declared money unit and its conversion work exactly as they do for
 * `payments` (YT-0537). The direction is what makes it worse here: a charge
 * in the wrong unit overcharges a user who will complain, while a payout in
 * the wrong unit sends a merchant a hundred times what they are owed and
 * nobody on the receiving end has any reason to mention it.
 */

export interface PayoutRequest {
  readonly idempotencyKey: string;
  readonly merchantId: string;
  readonly amountMinor: number;
  readonly currency: Currency;
}

export interface PayoutAccepted {
  readonly providerReference: string;
  readonly status: "pending";
}

export interface PayoutEvent {
  readonly id: string;
  readonly providerReference: string;
  readonly status: "pending" | "paid";
  readonly sequence: number;
}

export interface DisbursementDriver {
  readonly mode: DriverMode;
  /**
   * AUD is always present (its unit is unambiguous); IDR is present only
   * once a caller has declared it explicitly — see `payments.ts`'s module
   * doc for why there is no platform-wide IDR default. A payout in the
   * wrong unit sends a merchant a hundred times what they are owed, which is
   * why this is stricter than a bare `Record` here, not more lenient.
   */
  readonly declaredMinorUnitExponent: Partial<Record<Currency, number>>;
  payout(request: PayoutRequest): Promise<Result<PayoutAccepted, BoundaryFailure>>;
  deliveries(providerReference: string): readonly PayoutEvent[];
}

export interface SimulatedDisbursementOptions {
  readonly declaredMinorUnitExponent?: Partial<Record<Currency, number>>;
}

export interface SimulatedDisbursementDriver extends DisbursementDriver {
  /** What the provider was asked to pay, in PROVIDER units. For parity tests. */
  sent(providerReference: string): number | undefined;
}

export function createSimulatedDisbursement(
  faultPlan?: FaultPlan,
  options: SimulatedDisbursementOptions = {},
): SimulatedDisbursementDriver {
  const engine = new FaultEngine(faultPlan);
  const accepted = new Map<string, PayoutAccepted>();
  const sentToProvider = new Map<string, number>();
  const exponents: Partial<Record<Currency, number>> = {
    // See payments.ts for why IDR has no default and why the key is left
    // absent rather than set to `undefined` (`exactOptionalPropertyTypes`).
    AUD: options.declaredMinorUnitExponent?.AUD ?? 2,
    ...(options.declaredMinorUnitExponent?.IDR !== undefined
      ? { IDR: options.declaredMinorUnitExponent.IDR }
      : {}),
  };

  return {
    mode: "simulated",
    declaredMinorUnitExponent: exponents,
    sent: (providerReference: string) => sentToProvider.get(providerReference),

    payout(request: PayoutRequest): Promise<Result<PayoutAccepted, BoundaryFailure>> {
      const replay = accepted.get(request.idempotencyKey);
      if (replay !== undefined) return Promise.resolve(ok(replay));

      const providerExponent = exponents[request.currency];
      if (providerExponent === undefined) {
        // A payout in an undeclared unit is the direction that hides: nobody
        // on the receiving end has a reason to mention it. Refused before
        // any fault is even consulted, same as `payments.ts`.
        return Promise.resolve(
          err({
            kind: "declined",
            boundary: "disbursement",
            detail:
              `No declared minor-unit exponent for ${request.currency}: a driver must be told ` +
              "explicitly what its processor speaks before it can pay out in that currency.",
            mayHaveSucceeded: false,
          }),
        );
      }

      const directive = engine.nextCall();
      if (directive !== "proceed") {
        return Promise.resolve(err(failureFor("disbursement", directive)));
      }

      const providerAmount = toProviderAmount(
        request.amountMinor,
        request.currency,
        providerExponent,
      );
      if (providerAmount.isErr()) {
        return Promise.resolve(
          err({
            kind: "declined",
            boundary: "disbursement",
            detail: providerAmount.error.detail,
            mayHaveSucceeded: false,
          }),
        );
      }
      sentToProvider.set(`simpay_${request.idempotencyKey}`, providerAmount.value);

      const payout: PayoutAccepted = {
        providerReference: `simpay_${request.idempotencyKey}`,
        status: "pending",
      };
      accepted.set(request.idempotencyKey, payout);
      return Promise.resolve(ok(payout));
    },

    deliveries(providerReference: string): readonly PayoutEvent[] {
      return engine.shapeDeliveries([
        { id: `${providerReference}_1`, providerReference, status: "pending", sequence: 1 },
        { id: `${providerReference}_2`, providerReference, status: "paid", sequence: 2 },
      ]);
    },
  };
}

export function createDisbursementDriver(
  mode: DriverMode,
  _env: Environment,
  faultPlan?: FaultPlan,
): DisbursementDriver {
  return mode === "simulated"
    ? createSimulatedDisbursement(faultPlan)
    : refuseLiveDriver("disbursement");
}
