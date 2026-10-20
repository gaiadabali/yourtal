import { type Result, err, ok } from "neverthrow";
import type { Currency } from "@yourtal/contracts/money/currency";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode, Environment } from "../driver-mode";
import { refuseLiveDriver } from "../live-driver";
import { minorUnitExponent } from "@yourtal/contracts/money/minor-unit";
import { fromProviderAmount, toProviderAmount } from "./provider-amount";
import {
  SIGNATURE_HEADER,
  type SignatureFailure,
  TIMESTAMP_HEADER,
  signWebhook,
  verifyWebhookSignature,
} from "./webhook-signature";

/**
 * Taking money from a user. YT-0535's seam, YT-0537's simulator.
 *
 * ## The money unit is a property of the driver, not a constant
 *
 * `declaredMinorUnitExponent` is on the interface deliberately. FOUNDER
 * DECISION T-1 settled what this platform **stores** — IDR in whole Rupiah,
 * exponent 0 — and that happens to now agree with Xendit, but it never
 * settled what a processor **accepts** in general: Adyen flags IDR as
 * diverging from ISO, so a different processor in the same stack may
 * genuinely want a different integer for the same money.
 *
 * A driver that inherited the storage unit would be assuming the answer, so
 * IDR gets **no default** here — AUD's two-decimal unit is unambiguous
 * (Stripe, ISO 4217, cents as legal tender all agree) and keeps one, but a
 * caller must tell this driver what its IDR processor speaks. Declaring it,
 * and converting through `provider-amount.ts`, turns the open question into
 * a per-adapter conversion — which is the shape the money question has
 * pointed at from the start.
 *
 * **A mis-declared unit fails `payments-parity.test.ts`** rather than
 * settling a merchant 100x wrong. That is what makes deferring the vendor
 * question safe instead of a guess. An UNDECLARED IDR unit is refused
 * outright at `charge()` — silently defaulting it was itself a 100x hazard
 * once storage stopped being sen (docs/16-decisions.md, docs/25).
 *
 * ## Xendit-shaped
 *
 * The provider payload uses `external_id` / `amount` / `currency`, the shape
 * Xendit's charge API takes, and callbacks arrive as a signed JSON body. The
 * signature scheme is deliberately **stronger** than Xendit's own static
 * `x-callback-token` — see `webhook-signature.ts` for why, and for why the
 * domain never learns which scheme it is living with.
 *
 * ## The 14.7 seam
 *
 * `startCheckout` / `startCardSetup` / `chargeSaved` / `refund` / `parseWebhook` are what the app moves to: Stripe
 * in AU (`stripe/stripe-payments.ts`), this simulator in ID (F104) and in tests. `charge()` / `deliveries()` stay
 * until the app has migrated, then go.
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

/** One callback of the legacy `charge()` flow. (Was `PaymentEvent`; that name is now the seam's event union.) */
export interface ChargeDelivery {
  readonly id: string;
  readonly providerReference: string;
  readonly status: "pending" | "settled";
  readonly sequence: number;
}

export interface SavedCard {
  readonly brand: string;
  readonly last4: string;
  readonly expMonth: number;
  readonly expYear: number;
}

export interface CustomerRequest {
  readonly idempotencyKey: string;
  readonly reference: string;
  readonly email?: string;
  readonly name?: string;
}

export interface CheckoutRequest {
  readonly idempotencyKey: string;
  /** In OUR stored minor units. */
  readonly amountMinor: number;
  readonly currency: Currency;
  /** Our id for this payment, e.g. "card-purchase:<uuid>". Sent as client_reference_id and metadata.reference. */
  readonly reference: string;
  /** What the buyer sees on the line, e.g. "10,000 YourTal points". */
  readonly description: string;
  readonly customerRef?: string;
  /** May contain {CHECKOUT_SESSION_ID}. */
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly locale?: "en" | "id";
  /** When the checkout page stops taking the payment (Stripe's default is 24 h). */
  readonly expiresAt?: Date;
}

export type CheckoutStart =
  | { readonly kind: "redirect"; readonly checkoutReference: string; readonly url: string }
  /** The Xendit-shaped simulated driver settles at once: no page, no webhook. */
  | { readonly kind: "paid"; readonly paymentReference: string };

export interface CardSetupRequest {
  readonly idempotencyKey: string;
  readonly customerRef: string;
  readonly reference: string;
  readonly currency: Currency;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly locale?: "en" | "id";
}

export type CardSetupStart =
  | { readonly kind: "redirect"; readonly checkoutReference: string; readonly url: string }
  | { readonly kind: "saved"; readonly paymentMethodRef: string; readonly card: SavedCard };

export interface CardSetupResult {
  readonly customerRef: string;
  readonly paymentMethodRef: string;
  readonly card: SavedCard;
}

export interface SavedChargeRequest {
  readonly idempotencyKey: string;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly customerRef: string;
  readonly paymentMethodRef: string;
  readonly reference: string;
  readonly description?: string;
}

export interface SavedChargeAccepted {
  readonly paymentReference: string;
  readonly status: "succeeded" | "pending";
}

export interface RefundRequest {
  readonly idempotencyKey: string;
  readonly paymentReference: string;
  readonly currency: Currency;
  /** Omitted: refund what is left. */
  readonly amountMinor?: number;
  readonly reference: string;
}

export interface RefundAccepted {
  readonly refundReference: string;
  readonly status: "succeeded" | "pending";
}

/** A verified webhook, in the app's terms. Amounts are converted back to OUR minor units. */
export type PaymentEvent =
  | {
      readonly type: "checkout.completed";
      readonly eventId: string;
      readonly checkoutReference: string;
      readonly mode: "payment" | "setup";
      readonly reference: string | null;
      readonly paymentReference: string | null;
      readonly amountMinor: number | null;
      readonly currency: Currency | null;
      readonly customerRef: string | null;
      readonly paymentMethodRef: string | null;
    }
  | {
      readonly type: "checkout.expired";
      readonly eventId: string;
      readonly checkoutReference: string;
      readonly reference: string | null;
    }
  | {
      readonly type: "payment.succeeded";
      readonly eventId: string;
      readonly paymentReference: string;
      readonly reference: string | null;
      readonly amountMinor: number;
      readonly currency: Currency;
    }
  | {
      readonly type: "payment.failed";
      readonly eventId: string;
      readonly paymentReference: string;
      readonly reference: string | null;
      readonly code: string | null;
    }
  | {
      readonly type: "payment.canceled";
      readonly eventId: string;
      readonly paymentReference: string;
      readonly reference: string | null;
      readonly reason: string | null;
    }
  | {
      readonly type: "refund.succeeded";
      readonly eventId: string;
      readonly refundReference: string;
      readonly paymentReference: string;
      readonly amountMinor: number;
      readonly currency: Currency;
    }
  | {
      readonly type: "account.updated";
      readonly eventId: string;
      readonly accountRef: string;
      readonly chargesEnabled: boolean;
      readonly payoutsEnabled: boolean;
      readonly detailsSubmitted: boolean;
      readonly bankLast4: string | null;
    }
  | {
      readonly type: "payout.paid" | "payout.failed";
      readonly eventId: string;
      readonly accountRef: string;
      readonly payoutRef: string;
      readonly reference: string | null;
      readonly amountMinor: number;
      readonly currency: Currency;
      readonly failureCode: string | null;
    }
  | { readonly type: "ignored"; readonly eventId: string; readonly providerType: string };

export interface WebhookDelivery {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

/** SignatureFailure from webhook-signature.ts, or a body that is not an event. */
export type WebhookRefusal =
  SignatureFailure | { readonly kind: "malformed_event"; readonly detail: string };

/** A header by name, whatever case the HTTP layer delivered it in. */
export function webhookHeader(delivery: WebhookDelivery, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(delivery.headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
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
   * reason comparing them means anything. AUD is always present (its unit is
   * unambiguous); IDR is present only once a caller has declared it — see
   * the module doc for why there is no platform-wide IDR default.
   */
  readonly declaredMinorUnitExponent: Partial<Record<Currency, number>>;
  readonly provider: "stripe" | "simulated";
  /**
   * The smallest amount, in OUR minor units, the processor will charge (Stripe AUD: 50). Smaller boost-day charges
   * accumulate in the app until they reach it.
   */
  readonly minimumChargeMinor: Partial<Record<Currency, number>>;
  /** Stripe: boosts and bids charge a card saved beforehand. The simulated driver needs none. */
  readonly needsSavedCard: boolean;
  /** Legacy (Xendit-shaped). Stays until the app migrates to the calls below. */
  charge(request: ChargeRequest): Promise<Result<ChargeAccepted, BoundaryFailure>>;
  /** Legacy, with `charge()`. */
  deliveries(providerReference: string): readonly ChargeDelivery[];
  createCustomer(
    request: CustomerRequest,
  ): Promise<Result<{ readonly customerRef: string }, BoundaryFailure>>;
  startCheckout(request: CheckoutRequest): Promise<Result<CheckoutStart, BoundaryFailure>>;
  startCardSetup(request: CardSetupRequest): Promise<Result<CardSetupStart, BoundaryFailure>>;
  /**
   * What a completed setup-mode checkout saved. Stripe's checkout.session.completed carries only the SetupIntent
   * id, so the app calls this on that event (session -> setup_intent -> payment_method).
   */
  cardSetupResult(checkoutReference: string): Promise<Result<CardSetupResult, BoundaryFailure>>;
  chargeSaved(request: SavedChargeRequest): Promise<Result<SavedChargeAccepted, BoundaryFailure>>;
  refund(request: RefundRequest): Promise<Result<RefundAccepted, BoundaryFailure>>;
  /** Verifies and normalises one delivery. Never throws. */
  parseWebhook(delivery: WebhookDelivery, nowMs: number): Result<PaymentEvent, WebhookRefusal>;
}

/** The card every simulated setup saves. */
export const SIMULATED_CARD: SavedCard = {
  brand: "visa",
  last4: "4242",
  expMonth: 12,
  expYear: 2034,
};

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
  const receivedByProvider = new Map<string, ProviderCharge>();

  const exponents: Partial<Record<Currency, number>> = {
    // AUD's cents are unambiguous, so it keeps a default. IDR does not get
    // one: whether the declared value came from the caller or from guessing
    // is exactly the distinction that makes the parity suite meaningful. The
    // key is left absent rather than set to `undefined` — under
    // `exactOptionalPropertyTypes`, those are different types.
    AUD: options.declaredMinorUnitExponent?.AUD ?? 2,
    ...(options.declaredMinorUnitExponent?.IDR !== undefined
      ? { IDR: options.declaredMinorUnitExponent.IDR }
      : {}),
  };
  const convert = options.convertAmounts ?? true;
  const webhookSecret = options.webhookSecret ?? DEFAULT_SECRET;
  // One minor unit in every currency it declares: the simulator has no minimum charge.
  const minimumChargeMinor: Partial<Record<Currency, number>> = {
    AUD: 1,
    ...(exponents.IDR !== undefined ? { IDR: 1 } : {}),
  };

  /**
   * The amount to send, in provider units. Order matters: an undeclared unit is refused before any fault is
   * consulted (a construction mistake, not a provider answer), and a fault comes before the conversion.
   */
  function sendable(amountMinor: number, currency: Currency): Result<number, BoundaryFailure> {
    const providerExponent = exponents[currency];
    if (providerExponent === undefined) {
      // Guessing here is exactly the 100x hazard removing the IDR default exists to stop.
      return err({
        kind: "declined",
        boundary: "payments",
        detail:
          `No declared minor-unit exponent for ${currency}: a driver must be told ` +
          "explicitly what its processor speaks before it can charge in that currency.",
        mayHaveSucceeded: false,
      });
    }
    const directive = engine.nextCall();
    if (directive !== "proceed") return err(failureFor("payments", directive));

    // Rounding into a coarser processor unit would discard money silently, so an inexact amount is refused.
    const providerAmount = convert
      ? toProviderAmount(amountMinor, currency, providerExponent)
      : ok(amountMinor);
    if (providerAmount.isErr()) {
      return err({
        kind: "declined",
        boundary: "payments",
        detail: providerAmount.error.detail,
        mayHaveSucceeded: false,
      });
    }
    return ok(providerAmount.value);
  }

  /** Answers a replayed idempotency key with the first answer, as a real processor does. */
  function idempotent<Request extends { readonly idempotencyKey: string }, Answer>(
    run: (request: Request) => Result<Answer, BoundaryFailure>,
  ): (request: Request) => Promise<Result<Answer, BoundaryFailure>> {
    const answers = new Map<string, Answer>();
    return (request) => {
      const replay = answers.get(request.idempotencyKey);
      if (replay !== undefined) return Promise.resolve(ok(replay));
      const result = run(request);
      if (result.isOk()) answers.set(request.idempotencyKey, result.value);
      return Promise.resolve(result);
    };
  }

  function take(
    paymentReference: string,
    request: {
      readonly amountMinor: number;
      readonly currency: Currency;
      readonly reference: string;
    },
  ): Result<string, BoundaryFailure> {
    return sendable(request.amountMinor, request.currency).map((amount) => {
      receivedByProvider.set(paymentReference, {
        externalId: request.reference,
        amount,
        currency: request.currency,
      });
      return paymentReference;
    });
  }

  return {
    mode: "simulated",
    provider: "simulated",
    declaredMinorUnitExponent: exponents,
    minimumChargeMinor,
    needsSavedCard: false,
    webhookSecret,

    charge: idempotent<ChargeRequest, ChargeAccepted>((request) =>
      take(`sim_${request.idempotencyKey}`, request).map((providerReference) => ({
        providerReference,
        status: "pending" as const,
      })),
    ),

    deliveries(providerReference: string): readonly ChargeDelivery[] {
      return engine.shapeDeliveries(paymentEventsFor(providerReference));
    },

    received(providerReference: string): ProviderCharge | undefined {
      return receivedByProvider.get(providerReference);
    },

    signedDeliveries(providerReference: string, nowMs: number): readonly SignedDelivery[] {
      const charge = receivedByProvider.get(providerReference);
      if (charge === undefined) {
        // No currency or amount to quote — inventing one (IDR, say) would be
        // the same silent guess removing the IDR default exists to prevent.
        throw new Error(
          `signedDeliveries called for "${providerReference}", which was never charged.`,
        );
      }
      return engine.shapeDeliveries(paymentEventsFor(providerReference)).map((event) => {
        // The amount is quoted in PROVIDER units, as a real callback would —
        // so a handler comparing it against our stored amount has to convert
        // back. Quoting our units here would hide that step and let the
        // comparison pass for the wrong money.
        const body = JSON.stringify({
          id: event.id,
          external_id: charge.externalId,
          provider_reference: providerReference,
          status: event.status,
          amount: charge.amount,
          currency: charge.currency,
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

    createCustomer: idempotent<CustomerRequest, { readonly customerRef: string }>((request) =>
      ok({ customerRef: `simcus_${request.idempotencyKey}` }),
    ),

    // The Xendit-shaped simulator settles at once: no page, no webhook.
    startCheckout: idempotent<CheckoutRequest, CheckoutStart>((request) =>
      take(`simcs_${request.idempotencyKey}`, request).map((paymentReference) => ({
        kind: "paid" as const,
        paymentReference,
      })),
    ),

    startCardSetup: idempotent<CardSetupRequest, CardSetupStart>((request) =>
      exponents[request.currency] === undefined
        ? err({
            kind: "declined",
            boundary: "payments",
            detail: `No declared minor-unit exponent for ${request.currency}.`,
            mayHaveSucceeded: false,
          })
        : ok({
            kind: "saved" as const,
            paymentMethodRef: `simpm_${request.idempotencyKey}`,
            card: SIMULATED_CARD,
          }),
    ),

    cardSetupResult(checkoutReference: string) {
      // startCardSetup never redirects here, so there is no checkout to read; reaching this is an app bug.
      return Promise.resolve(
        err({
          kind: "declined",
          boundary: "payments",
          detail: `The simulated driver saves cards at once; "${checkoutReference}" is not a setup checkout.`,
          mayHaveSucceeded: false,
        }),
      );
    },

    chargeSaved: idempotent<SavedChargeRequest, SavedChargeAccepted>((request) =>
      take(`simpi_${request.idempotencyKey}`, request).map((paymentReference) => ({
        paymentReference,
        status: "succeeded" as const,
      })),
    ),

    refund: idempotent<RefundRequest, RefundAccepted>((request) =>
      sendable(request.amountMinor ?? 0, request.currency).map(() => ({
        refundReference: `simre_${request.idempotencyKey}`,
        status: "succeeded" as const,
      })),
    ),

    parseWebhook(delivery: WebhookDelivery, nowMs: number) {
      return parseSimulatedWebhook(delivery, nowMs, webhookSecret, exponents);
    },
  };
}

/** The simulator's own signed callback (x-yourtal-signature) as a seam event. Never throws. */
function parseSimulatedWebhook(
  delivery: WebhookDelivery,
  nowMs: number,
  secret: string,
  exponents: Partial<Record<Currency, number>>,
): Result<PaymentEvent, WebhookRefusal> {
  const verified = verifyWebhookSignature({
    body: delivery.rawBody,
    secret,
    signature: webhookHeader(delivery, SIGNATURE_HEADER),
    timestamp: webhookHeader(delivery, TIMESTAMP_HEADER),
    nowMs,
  });
  if (verified.isErr()) return err(verified.error);

  const malformed = (detail: string) => err({ kind: "malformed_event" as const, detail });
  let parsed: unknown;
  try {
    parsed = JSON.parse(delivery.rawBody);
  } catch {
    return malformed("The body is not JSON.");
  }
  const body: Readonly<Record<string, unknown>> =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const { id, status, amount, currency } = body;
  const paymentReference = body.provider_reference;
  const reference = body.external_id;
  if (typeof id !== "string" || typeof status !== "string") return malformed("No id or status.");
  if (status !== "settled") return ok({ type: "ignored", eventId: id, providerType: status });

  if (typeof paymentReference !== "string" || (currency !== "AUD" && currency !== "IDR")) {
    return malformed("A settled callback needs provider_reference and a known currency.");
  }
  const exponent = exponents[currency];
  const amountMinor =
    typeof amount === "number" && exponent !== undefined
      ? fromProviderAmount(amount, currency, exponent)
      : undefined;
  if (amountMinor === undefined || amountMinor.isErr()) {
    return malformed(`The amount cannot be read back in ${currency}.`);
  }
  return ok({
    type: "payment.succeeded",
    eventId: id,
    paymentReference,
    reference: typeof reference === "string" ? reference : null,
    amountMinor: amountMinor.value,
    currency,
  });
}

function paymentEventsFor(providerReference: string): ChargeDelivery[] {
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
  // Live stays refused here: the Stripe driver cannot serve the legacy charge() the app still calls, so wiring it
  // in would boot and then fail per request. Live AU payments come from createPaymentProviders.
  return mode === "simulated"
    ? createSimulatedPayments(faultPlan, { declaredMinorUnitExponent: simulatedProcessorUnits() })
    : refuseLiveDriver("payments");
}

/**
 * What the simulated processor speaks: our storage unit (AUD cents, IDR whole
 * Rupiah, T-1), which is also what Xendit takes. Declared here, in the
 * factory, rather than defaulted inside `createSimulatedPayments`: the parity
 * suite still builds that one bare to prove an undeclared IDR unit is refused.
 * A live adapter must declare the unit its own processor speaks.
 */
export function simulatedProcessorUnits(): Record<Currency, number> {
  return { AUD: minorUnitExponent("AUD"), IDR: minorUnitExponent("IDR") };
}
