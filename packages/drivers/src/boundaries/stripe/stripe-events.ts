import { type Result, err, ok } from "neverthrow";
import type { Currency } from "@yourtal/contracts/money/currency";
import type { PaymentEvent, WebhookRefusal } from "../payments";
import { currencyFromStripe, fromStripeAmount } from "./stripe-money";
import { type StripeObject, asObject, bankLast4, bool, idOf, int, obj, str } from "./stripe-object";

/**
 * A verified Stripe event in the app's terms. Amounts come back to OUR minor units; our reference travels as
 * `client_reference_id` / `metadata.reference` and comes back out. Types the app does not act on are `ignored`
 * (setup_intent.succeeded is read through cardSetupResult, charge.refunded duplicates refund.*, a transfer is
 * known from its synchronous answer).
 */

type Refusal = Extract<WebhookRefusal, { kind: "malformed_event" }>;
const malformed = (detail: string): Result<never, Refusal> =>
  err({ kind: "malformed_event", detail });

function referenceOf(object: StripeObject): string | null {
  return str(object, "client_reference_id") ?? str(obj(object, "metadata"), "reference") ?? null;
}

function money(
  object: StripeObject,
  amountKey: string,
): Result<{ amountMinor: number; currency: Currency }, Refusal> {
  const currency = currencyFromStripe(str(object, "currency"));
  const amount = int(object, amountKey);
  if (currency === undefined)
    return malformed(`Currency "${str(object, "currency") ?? ""}" is not one this driver speaks.`);
  if (amount === undefined) return malformed(`No integer ${amountKey}.`);
  const amountMinor = fromStripeAmount(amount, currency);
  return amountMinor === undefined
    ? malformed(`${amountKey} cannot be read back in ${currency}.`)
    : ok({ amountMinor, currency });
}

function checkoutCompleted(
  eventId: string,
  session: StripeObject,
  id: string,
): Result<PaymentEvent, Refusal> {
  const raw = str(session, "mode");
  if (raw !== "payment" && raw !== "setup")
    return malformed(`Unknown checkout mode "${raw ?? ""}".`);
  const mode: "payment" | "setup" = raw;
  const common = {
    type: "checkout.completed" as const,
    eventId,
    checkoutReference: id,
    mode,
    reference: referenceOf(session),
    customerRef: idOf(session, "customer") ?? null,
  };
  if (mode === "setup") {
    // The SetupIntent arrives as an id; the card is read with cardSetupResult. Expanded, it names the card here.
    const paymentMethodRef = idOf(obj(session, "setup_intent"), "payment_method") ?? null;
    return ok({
      ...common,
      paymentReference: null,
      amountMinor: null,
      currency: null,
      paymentMethodRef,
    });
  }
  // "unpaid" means a delayed method has not settled yet: the money is not ours until it reports paid.
  if (str(session, "payment_status") !== "paid") {
    return ok({ type: "ignored", eventId, providerType: "checkout.session.completed" });
  }
  const total = money(session, "amount_total");
  if (total.isErr()) return err(total.error);
  return ok({
    ...common,
    paymentReference: idOf(session, "payment_intent") ?? null,
    amountMinor: total.value.amountMinor,
    currency: total.value.currency,
    paymentMethodRef: null,
  });
}

const HANDLED = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "refund.created",
  "refund.updated",
  "account.updated",
  "payout.paid",
  "payout.failed",
]);

function fromObject(
  eventId: string,
  type: string,
  event: StripeObject,
  object: StripeObject,
): Result<PaymentEvent, Refusal> {
  const id = str(object, "id");
  if (id === undefined) return malformed(`The ${type} object has no id.`);
  const reference = str(obj(object, "metadata"), "reference") ?? null;

  switch (type) {
    case "checkout.session.completed":
      return checkoutCompleted(eventId, object, id);
    case "checkout.session.expired":
      return ok({
        type: "checkout.expired",
        eventId,
        checkoutReference: id,
        reference: referenceOf(object),
      });
    case "payment_intent.succeeded":
      return money(object, "amount_received").map((paid) => ({
        type: "payment.succeeded" as const,
        eventId,
        paymentReference: id,
        reference,
        ...paid,
      }));
    case "payment_intent.payment_failed": {
      const error = obj(object, "last_payment_error");
      const code = str(error, "decline_code") ?? str(error, "code") ?? null;
      return ok({ type: "payment.failed", eventId, paymentReference: id, reference, code });
    }
    case "payment_intent.canceled":
      return ok({
        type: "payment.canceled",
        eventId,
        paymentReference: id,
        reference,
        reason: str(object, "cancellation_reason") ?? null,
      });
    case "refund.created":
    case "refund.updated": {
      // A pending refund says nothing yet; Stripe follows it with refund.updated once it succeeds.
      if (str(object, "status") !== "succeeded")
        return ok({ type: "ignored", eventId, providerType: type });
      const paymentReference = idOf(object, "payment_intent");
      if (paymentReference === undefined) return malformed("A refund without its payment_intent.");
      return money(object, "amount").map((refunded) => ({
        type: "refund.succeeded" as const,
        eventId,
        refundReference: id,
        paymentReference,
        ...refunded,
      }));
    }
    case "account.updated":
      return ok({
        type: "account.updated",
        eventId,
        accountRef: id,
        chargesEnabled: bool(object, "charges_enabled") ?? false,
        payoutsEnabled: bool(object, "payouts_enabled") ?? false,
        detailsSubmitted: bool(object, "details_submitted") ?? false,
        bankLast4: bankLast4(object),
      });
    case "payout.paid":
    case "payout.failed": {
      const accountRef = str(event, "account");
      if (accountRef === undefined)
        return malformed(`A ${type} event without its connected account.`);
      return money(object, "amount").map((paid) => ({
        type,
        eventId,
        accountRef,
        payoutRef: id,
        reference,
        ...paid,
        failureCode: str(object, "failure_code") ?? null,
      }));
    }
    default:
      return ok({ type: "ignored", eventId, providerType: type });
  }
}

/** A raw (already signature-verified) body to a seam event. Never throws. */
export function normaliseStripeEvent(rawBody: string): Result<PaymentEvent, Refusal> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return malformed("The body is not JSON.");
  }
  const event = asObject(parsed);
  const eventId = str(event, "id");
  const type = str(event, "type");
  const object = obj(obj(event, "data"), "object");
  if (
    event === undefined ||
    str(event, "object") !== "event" ||
    eventId === undefined ||
    type === undefined
  ) {
    return malformed("The body is not a Stripe event.");
  }
  if (!HANDLED.has(type)) return ok({ type: "ignored", eventId, providerType: type });
  if (object === undefined) return malformed("The event has no data.object.");
  return fromObject(eventId, type, event, object);
}
