import { type Result, err, ok } from "neverthrow";
import type { Currency } from "@yourtal/contracts/money/currency";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode, Environment } from "../driver-mode";
import { refuseLiveDriver } from "../live-driver";

/**
 * Taking money from a user. YT-0535's seam; YT-0537 builds the Xendit-shaped
 * simulator behind it.
 *
 * ## The money unit is a property of the driver, not a constant
 *
 * `declaredMinorUnitExponent` is on the interface deliberately. YT-0506
 * settled what this platform **stores** — IDR in sen, exponent 2 — and
 * explicitly did not settle what a processor **accepts**: Xendit publishes
 * no amount-unit spec and Adyen flags IDR as diverging from ISO, so the two
 * genuinely differ between vendors.
 *
 * A driver that inherited the storage unit would be assuming the answer.
 * Declaring it lets a parity test (YT-0539) compare what we store against
 * what the driver speaks, so a mismatch **fails a test** rather than
 * settling a merchant 100x wrong — which is the entire reason YT-0506 could
 * be deferred instead of guessed.
 */

export interface ChargeRequest {
  readonly idempotencyKey: string;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly reference: string;
}

export interface ChargeAccepted {
  readonly providerReference: string;
  readonly status: "pending";
}

export interface PaymentEvent {
  readonly id: string;
  readonly providerReference: string;
  readonly status: "pending" | "settled";
  readonly sequence: number;
}

export interface PaymentsDriver {
  readonly mode: DriverMode;
  /**
   * The exponent this PROCESSOR speaks, which may differ from the exponent
   * we store. See the note above.
   */
  readonly declaredMinorUnitExponent: Record<Currency, number>;
  charge(request: ChargeRequest): Promise<Result<ChargeAccepted, BoundaryFailure>>;
  /** Events as the provider would deliver them, faults included. */
  deliveries(providerReference: string): readonly PaymentEvent[];
}

export function createSimulatedPayments(faultPlan?: FaultPlan): PaymentsDriver {
  const engine = new FaultEngine(faultPlan);
  // Replays are answered from here rather than re-charged, because a
  // simulator that ignores the idempotency key cannot catch a caller that
  // forgot to send one — and `timeout` is the fault that makes that fatal.
  const accepted = new Map<string, ChargeAccepted>();

  return {
    mode: "simulated",
    // Sen and cents. Stated, not inherited: when a real vendor says
    // otherwise, this is the line that changes and the parity test that
    // catches it.
    declaredMinorUnitExponent: { IDR: 2, AUD: 2 },

    charge(request: ChargeRequest): Promise<Result<ChargeAccepted, BoundaryFailure>> {
      const replay = accepted.get(request.idempotencyKey);
      if (replay !== undefined) {
        return Promise.resolve(ok(replay));
      }

      const directive = engine.nextCall();
      if (directive !== "proceed") {
        return Promise.resolve(err(failureFor("payments", directive)));
      }

      const charge: ChargeAccepted = {
        providerReference: `sim_${request.idempotencyKey}`,
        status: "pending",
      };
      accepted.set(request.idempotencyKey, charge);
      return Promise.resolve(ok(charge));
    },

    deliveries(providerReference: string): readonly PaymentEvent[] {
      return engine.shapeDeliveries([
        { id: `${providerReference}_1`, providerReference, status: "pending", sequence: 1 },
        { id: `${providerReference}_2`, providerReference, status: "settled", sequence: 2 },
      ]);
    },
  };
}

export function createPaymentsDriver(
  mode: DriverMode,
  _env: Environment,
  faultPlan?: FaultPlan,
): PaymentsDriver {
  return mode === "simulated" ? createSimulatedPayments(faultPlan) : refuseLiveDriver("payments");
}
