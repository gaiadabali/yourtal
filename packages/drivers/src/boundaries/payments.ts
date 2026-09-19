import { type Result, err, ok } from "neverthrow";
import type { Currency } from "@yourtal/contracts/money/currency";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode, Environment } from "../driver-mode";
import { refuseLiveDriver } from "../live-driver";
import { toProviderAmount } from "./provider-amount";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, signWebhook } from "./webhook-signature";

/**
 * Taking money from a user. YT-0535's seam, YT-0537's simulator.
 *
 * ## The money unit is a property of the driver, not a constant
 *
 * `declaredMinorUnitExponent` is on the interface deliberately. YT-0506
 * settled what this platform **stores** — IDR in sen, exponent 2 — and
 * explicitly did not settle what a processor **accepts**: Xendit publishes
 * no amount-unit spec and Adyen flags IDR as diverging from ISO, so two
 * processors in one stack may genuinely want different integers for the same
 * money.
 *
 * A driver that inherited the storage unit would be assuming the answer.
 * Declaring it, and converting through `provider-amount.ts`, turns the open
 * question into a per-adapter conversion — which is the shape the money
 * question has pointed at from the start.
 *
 * **A mis-declared unit fails `payments-parity.test.ts`** rather than
 * settling a merchant 100x wrong. That is what makes deferring the vendor
 * question safe instead of a guess.
 *
 * ## Xendit-shaped
 *
 * The provider payload uses `external_id` / `amount` / `currency`, the shape
 * Xendit's charge API takes, and callbacks arrive as a signed JSON body. The
 * signature scheme is deliberately **stronger** than Xendit's own static
 * `x-callback-token` — see `webhook-signature.ts` for why, and for why the
 * domain never learns which scheme it is living with.
 */

export interface ChargeRequest {
  readonly idempotencyKey: string;
  /** In OUR stored minor units. The driver converts. */
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

/** A callback as it arrives on the wire: a body plus headers to verify. */
export interface SignedDelivery {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** Exactly what the simulator was asked to charge, in PROVIDER units. */
export interface ProviderCharge {
  readonly externalId: string;
  readonly amount: number;
  readonly currency: Currency;
}

export interface PaymentsDriver {
  readonly mode: DriverMode;
  /**
   * The exponent this PROCESSOR speaks, which may differ from the exponent
   * we store. Never derived from `MINOR_UNIT` — that separation is the only
   * reason comparing them means anything.
   */
  readonly declaredMinorUnitExponent: Record<Currency, number>;
  charge(request: ChargeRequest): Promise<Result<ChargeAccepted, BoundaryFailure>>;
  deliveries(providerReference: string): readonly PaymentEvent[];
}

export interface SimulatedPaymentsDriver extends PaymentsDriver {
  /** What the provider received. The parity suite reads this. */
  received(providerReference: string): ProviderCharge | undefined;
  /** Callbacks as they arrive on the wire, signed, faults applied. */
  signedDeliveries(providerReference: string, nowMs: number): readonly SignedDelivery[];
  readonly webhookSecret: string;
}

export interface SimulatedPaymentsOptions {
  /**
   * Override what the processor claims to speak. Exists so a test can build
   * a driver that declares a unit it does not honour — without that, the
   * parity suite could only prove the correct case, which proves nothing
   * about whether it would catch the wrong one.
   */
  readonly declaredMinorUnitExponent?: Partial<Record<Currency, number>>;
  /**
   * Convert amounts before sending. Defaults to true. Setting it false is
   * the mis-declared driver: it *claims* one unit and sends another, which
   * is precisely the 100x bug in its natural habitat.
   */
  readonly convertAmounts?: boolean;
  readonly webhookSecret?: string;
}

const DEFAULT_SECRET = "simulated-webhook-secret";

export function createSimulatedPayments(
  faultPlan?: FaultPlan,
  options: SimulatedPaymentsOptions = {},
): SimulatedPaymentsDriver {
  const engine = new FaultEngine(faultPlan);
  const accepted = new Map<string, ChargeAccepted>();
  const receivedByProvider = new Map<string, ProviderCharge>();

  const exponents: Record<Currency, number> = {
    // Sen and cents. Stated, not inherited.
    IDR: options.declaredMinorUnitExponent?.IDR ?? 2,
    AUD: options.declaredMinorUnitExponent?.AUD ?? 2,
  };
  const convert = options.convertAmounts ?? true;
  const webhookSecret = options.webhookSecret ?? DEFAULT_SECRET;

  return {
    mode: "simulated",
    declaredMinorUnitExponent: exponents,
    webhookSecret,

    charge(request: ChargeRequest): Promise<Result<ChargeAccepted, BoundaryFailure>> {
      const replay = accepted.get(request.idempotencyKey);
      if (replay !== undefined) {
        return Promise.resolve(ok(replay));
      }

      const directive = engine.nextCall();
      if (directive !== "proceed") {
        return Promise.resolve(err(failureFor("payments", directive)));
      }

      // The conversion can legitimately fail: an amount that does not divide
      // into a coarser processor unit would have to be rounded, and rounding
      // here discards money silently. Refusing is the only honest answer.
      const providerAmount = convert
        ? toProviderAmount(request.amountMinor, request.currency, exponents[request.currency])
        : ok(request.amountMinor);

      if (providerAmount.isErr()) {
        return Promise.resolve(
          err({
            kind: "declined",
            boundary: "payments",
            detail: providerAmount.error.detail,
            mayHaveSucceeded: false,
          }),
        );
      }

      const providerReference = `sim_${request.idempotencyKey}`;
      receivedByProvider.set(providerReference, {
        externalId: request.reference,
        amount: providerAmount.value,
        currency: request.currency,
      });

      const charge: ChargeAccepted = { providerReference, status: "pending" };
      accepted.set(request.idempotencyKey, charge);
      return Promise.resolve(ok(charge));
    },

    deliveries(providerReference: string): readonly PaymentEvent[] {
      return engine.shapeDeliveries(paymentEventsFor(providerReference));
    },

    received(providerReference: string): ProviderCharge | undefined {
      return receivedByProvider.get(providerReference);
    },

    signedDeliveries(providerReference: string, nowMs: number): readonly SignedDelivery[] {
      const charge = receivedByProvider.get(providerReference);
      return engine.shapeDeliveries(paymentEventsFor(providerReference)).map((event) => {
        // The amount is quoted in PROVIDER units, as a real callback would —
        // so a handler comparing it against our stored amount has to convert
        // back. Quoting our units here would hide that step and let the
        // comparison pass for the wrong money.
        const body = JSON.stringify({
          id: event.id,
          external_id: charge?.externalId ?? providerReference,
          status: event.status,
          amount: charge?.amount ?? 0,
          currency: charge?.currency ?? "IDR",
        });
        return {
          body,
          headers: {
            [SIGNATURE_HEADER]: signWebhook(body, webhookSecret, nowMs),
            [TIMESTAMP_HEADER]: String(nowMs),
          },
        };
      });
    },
  };
}

function paymentEventsFor(providerReference: string): PaymentEvent[] {
  return [
    { id: `${providerReference}_1`, providerReference, status: "pending", sequence: 1 },
    { id: `${providerReference}_2`, providerReference, status: "settled", sequence: 2 },
  ];
}

export function createPaymentsDriver(
  mode: DriverMode,
  _env: Environment,
  faultPlan?: FaultPlan,
): PaymentsDriver {
  return mode === "simulated" ? createSimulatedPayments(faultPlan) : refuseLiveDriver("payments");
}
