import { type Result, err, ok } from "neverthrow";
import type { BoundaryFailure } from "../../fault-engine";
import type { Environment } from "../../driver-mode";
import { type PaymentsDriver, type SavedCard, webhookHeader } from "../payments";
import {
  type StripeClient,
  createStripeClient,
  isResourceMissing,
  stripeConfigFromEnv,
  stripePath,
  unexpectedAnswer,
} from "./stripe-client";
import { normaliseStripeEvent } from "./stripe-events";
import {
  STRIPE_EXPONENTS,
  STRIPE_MINIMUM_CHARGE_MINOR,
  checkMinimumCharge,
  stripeCurrency,
  toStripeAmount,
} from "./stripe-money";
import { type StripeObject, bool, idOf, int, obj, str } from "./stripe-object";
import { STRIPE_SIGNATURE_HEADER, verifyStripeSignature } from "./stripe-signature";

/**
 * Taking money in AU through Stripe: hosted Checkout for one-off purchases and for saving a card, then
 * off-session PaymentIntents on the saved card (boosts), refunds, and the signed webhook. Written against Stripe's
 * real API; on staging STRIPE_API_BASE points it at the payment simulation (F106).
 */

const BOUNDARY = "payments";

export interface StripePaymentsConfig {
  readonly apiBase?: string;
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

function declined(detail: string): BoundaryFailure {
  return { kind: "declined", boundary: BOUNDARY, detail, mayHaveSucceeded: false };
}

function cardOf(paymentMethod: StripeObject): SavedCard | undefined {
  const card = obj(paymentMethod, "card");
  const brand = str(card, "brand");
  const last4 = str(card, "last4");
  const expMonth = int(card, "exp_month");
  const expYear = int(card, "exp_year");
  return brand === undefined ||
    last4 === undefined ||
    expMonth === undefined ||
    expYear === undefined
    ? undefined
    : { brand, last4, expMonth, expYear };
}

async function cardSetupResult(client: StripeClient, checkoutReference: string) {
  const session = await client.get(stripePath("checkout", "sessions", checkoutReference), {
    expand: ["setup_intent"],
  });
  if (session.isErr()) return err(session.error);
  if (str(session.value, "mode") !== "setup" || str(session.value, "status") !== "complete") {
    return err(declined(`Checkout ${checkoutReference} is not a completed card setup.`));
  }

  let setupIntent = obj(session.value, "setup_intent");
  if (setupIntent === undefined) {
    // Not expanded: fetch it by id.
    const setupId = str(session.value, "setup_intent");
    if (setupId === undefined)
      return err(unexpectedAnswer(BOUNDARY, "A completed setup with no SetupIntent."));
    const fetched = await client.get(stripePath("setup_intents", setupId));
    if (fetched.isErr()) return err(fetched.error);
    setupIntent = fetched.value;
  }
  if (str(setupIntent, "status") !== "succeeded") {
    return err(declined(`The SetupIntent of ${checkoutReference} has not succeeded.`));
  }
  const paymentMethodRef = idOf(setupIntent, "payment_method");
  const customerRef = idOf(session.value, "customer") ?? idOf(setupIntent, "customer");
  if (paymentMethodRef === undefined || customerRef === undefined) {
    return err(unexpectedAnswer(BOUNDARY, "A succeeded SetupIntent without its card or customer."));
  }

  const method = await client.get(stripePath("payment_methods", paymentMethodRef));
  if (method.isErr()) return err(method.error);
  const card = cardOf(method.value);
  return card === undefined
    ? err(unexpectedAnswer(BOUNDARY, `Payment method ${paymentMethodRef} has no card details.`))
    : ok({ customerRef, paymentMethodRef, card });
}

export function createStripePayments(config: StripePaymentsConfig): PaymentsDriver {
  const client = createStripeClient({ ...config, boundary: BOUNDARY });

  return {
    mode: "live",
    provider: "stripe",
    declaredMinorUnitExponent: STRIPE_EXPONENTS,
    minimumChargeMinor: STRIPE_MINIMUM_CHARGE_MINOR,
    needsSavedCard: true,

    charge() {
      return Promise.resolve(
        err(
          declined(
            "The Stripe driver does not take the legacy charge(); use startCheckout or chargeSaved.",
          ),
        ),
      );
    },
    deliveries() {
      return [];
    },

    async createCustomer(request) {
      const created = await client.post(
        "/v1/customers",
        { email: request.email, name: request.name, metadata: { reference: request.reference } },
        { idempotencyKey: request.idempotencyKey },
      );
      if (created.isErr()) return err(created.error);
      const customerRef = str(created.value, "id");
      return customerRef === undefined
        ? err(unexpectedAnswer(BOUNDARY, "Stripe created a customer without an id."))
        : ok({ customerRef });
    },

    async deleteCustomer(customerRef) {
      if (customerRef.trim() === "") return err(declined("A customer reference is required."));
      // Stripe deletes the customer's payment methods with it. A 404 means it is already gone: a retry succeeds.
      const deleted = await client.delete(stripePath("customers", customerRef));
      if (deleted.isErr())
        return isResourceMissing(deleted.error) ? ok(undefined) : err(deleted.error);
      return str(deleted.value, "id") === customerRef && bool(deleted.value, "deleted") === true
        ? ok(undefined)
        : err(
            unexpectedAnswer(BOUNDARY, `Stripe did not confirm deleting customer ${customerRef}.`),
          );
    },

    async startCheckout(request) {
      const amount = toStripeAmount(BOUNDARY, request.amountMinor, request.currency).andThen(
        (value) =>
          checkMinimumCharge(BOUNDARY, request.amountMinor, request.currency).map(() => value),
      );
      if (amount.isErr()) return err(amount.error);
      const session = await client.post(
        "/v1/checkout/sessions",
        {
          mode: "payment",
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
          client_reference_id: request.reference,
          customer: request.customerRef,
          locale: request.locale,
          expires_at:
            request.expiresAt === undefined
              ? undefined
              : Math.floor(request.expiresAt.getTime() / 1_000),
          metadata: { reference: request.reference },
          line_items: [
            {
              price_data: {
                currency: stripeCurrency(request.currency),
                unit_amount: amount.value,
                product_data: { name: request.description },
              },
              quantity: 1,
            },
          ],
          payment_intent_data: {
            metadata: { reference: request.reference },
            description: request.description,
          },
        },
        { idempotencyKey: request.idempotencyKey },
      );
      return session.andThen(redirectOf);
    },

    async startCardSetup(request) {
      const declared = toStripeAmount(BOUNDARY, 0, request.currency);
      if (declared.isErr()) return err(declared.error);
      const session = await client.post(
        "/v1/checkout/sessions",
        {
          mode: "setup",
          customer: request.customerRef,
          currency: stripeCurrency(request.currency),
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
          client_reference_id: request.reference,
          locale: request.locale,
          metadata: { reference: request.reference },
          setup_intent_data: { metadata: { reference: request.reference } },
        },
        { idempotencyKey: request.idempotencyKey },
      );
      return session.andThen(redirectOf);
    },

    cardSetupResult(checkoutReference) {
      return cardSetupResult(client, checkoutReference);
    },

    async chargeSaved(request) {
      const amount = toStripeAmount(BOUNDARY, request.amountMinor, request.currency).andThen(
        (value) =>
          checkMinimumCharge(BOUNDARY, request.amountMinor, request.currency).map(() => value),
      );
      if (amount.isErr()) return err(amount.error);
      const intent = await client.post(
        "/v1/payment_intents",
        {
          amount: amount.value,
          currency: stripeCurrency(request.currency),
          customer: request.customerRef,
          payment_method: request.paymentMethodRef,
          confirm: true,
          // The buyer is not there to answer 3-D Secure; Stripe then fails rather than waiting for them.
          off_session: true,
          capture_method: "automatic",
          description: request.description,
          metadata: { reference: request.reference },
        },
        { idempotencyKey: request.idempotencyKey },
      );
      if (intent.isErr()) return err(intent.error);
      const paymentReference = str(intent.value, "id");
      const status = str(intent.value, "status");
      if (paymentReference === undefined)
        return err(unexpectedAnswer(BOUNDARY, "A PaymentIntent without an id."));
      if (status === "succeeded") return ok({ paymentReference, status: "succeeded" as const });
      if (status === "processing") return ok({ paymentReference, status: "pending" as const });
      return err(
        declined(
          `The saved card was not charged (PaymentIntent ${paymentReference} is ${status ?? "unknown"}).`,
        ),
      );
    },

    async refund(request) {
      const amount =
        request.amountMinor === undefined
          ? toStripeAmount(BOUNDARY, 0, request.currency).map(() => undefined)
          : toStripeAmount(BOUNDARY, request.amountMinor, request.currency);
      if (amount.isErr()) return err(amount.error);
      const refund = await client.post(
        "/v1/refunds",
        {
          payment_intent: request.paymentReference,
          amount: amount.value,
          metadata: { reference: request.reference },
        },
        { idempotencyKey: request.idempotencyKey },
      );
      if (refund.isErr()) return err(refund.error);
      const refundReference = str(refund.value, "id");
      const status = str(refund.value, "status");
      if (refundReference === undefined)
        return err(unexpectedAnswer(BOUNDARY, "A refund without an id."));
      if (status === "succeeded") return ok({ refundReference, status: "succeeded" as const });
      if (status === "pending" || status === "requires_action") {
        return ok({ refundReference, status: "pending" as const });
      }
      return err(declined(`Refund ${refundReference} is ${status ?? "unknown"}.`));
    },

    parseWebhook(delivery, nowMs) {
      const verified = verifyStripeSignature({
        rawBody: delivery.rawBody,
        header: webhookHeader(delivery, STRIPE_SIGNATURE_HEADER),
        secret: config.webhookSecret,
        nowMs,
      });
      if (verified.isErr()) return err(verified.error);
      return normaliseStripeEvent(delivery.rawBody);
    },
  };
}

function redirectOf(
  session: StripeObject,
): Result<
  { readonly kind: "redirect"; readonly checkoutReference: string; readonly url: string },
  BoundaryFailure
> {
  const checkoutReference = str(session, "id");
  const url = str(session, "url");
  return checkoutReference === undefined || url === undefined
    ? err(unexpectedAnswer(BOUNDARY, "Stripe created a Checkout Session without an id or url."))
    : ok({ kind: "redirect", checkoutReference, url });
}

export function createStripePaymentsFromEnv(
  env: Environment,
  fetchImpl?: typeof fetch,
): PaymentsDriver {
  const config = stripeConfigFromEnv(env);
  if (config.webhookSecret === undefined) {
    throw new Error("A live Stripe payments driver requires STRIPE_WEBHOOK_SECRET.");
  }
  return createStripePayments({
    apiBase: config.apiBase,
    secretKey: config.secretKey,
    webhookSecret: config.webhookSecret,
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
}
