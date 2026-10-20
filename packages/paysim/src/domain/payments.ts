import { type Ctx, unix } from "../ctx";
import { ID_PREFIX, newId } from "../ids";
import { invalidRequest, unexpectedState } from "../errors";
import type { JsonObject, StoredObject } from "../store";
import { emitEvent } from "./events";
import { adjustPlatform, aud } from "./money";
import { jo, metaJson, mk, nv, sn, sv } from "./repo";
import { createTransfer } from "./transfers";

/** An uncaptured hold is released by the sweep after this long. */
export const HOLD_MS = 7 * 24 * 60 * 60 * 1000;

export interface NewIntent {
  amount: number;
  customer: string | null;
  description: string | null;
  metadata: Record<string, string>;
  captureMethod: "automatic" | "manual";
  destination: string | null;
  onBehalfOf: string | null;
  account: string | null;
}

export function newPaymentIntent(ctx: Ctx, n: NewIntent): StoredObject {
  const id = newId(ID_PREFIX.paymentIntent);
  return mk("payment_intent", id, n.account, {
    id,
    object: "payment_intent",
    created: unix(ctx.now),
    livemode: false,
    amount: n.amount,
    amount_capturable: 0,
    amount_received: 0,
    currency: "aud",
    status: "requires_payment_method",
    capture_method: n.captureMethod,
    customer: n.customer,
    payment_method: null,
    latest_charge: null,
    description: n.description,
    metadata: metaJson(n.metadata),
    transfer_data: n.destination === null ? null : { destination: n.destination },
    on_behalf_of: n.onBehalfOf,
    canceled_at: null,
    cancellation_reason: null,
    last_payment_error: null,
    next_action: null,
  });
}

/** Funds reach the platform; a destination charge passes them on. */
async function captureFunds(
  ctx: Ctx,
  pi: StoredObject,
  chargeId: string,
  amount: number,
): Promise<void> {
  await adjustPlatform(ctx, amount);
  const destination = sn(jo(pi.data, "transfer_data"), "destination");
  if (destination === null) return;
  await createTransfer(ctx, {
    amount,
    destination,
    transferGroup: `group_${pi.id}`,
    description: null,
    metadata: {},
    sourceTransaction: chargeId,
  });
}

/** Charges the saved or entered card: a hold, or the money. */
export async function confirmIntent(ctx: Ctx, pi: StoredObject, pm: StoredObject): Promise<void> {
  const amount = nv(pi.data, "amount");
  const manual = sv(pi.data, "capture_method") === "manual";
  const chargeId = newId(ID_PREFIX.charge);
  const charge = mk("charge", chargeId, pi.account, {
    id: chargeId,
    object: "charge",
    created: unix(ctx.now),
    livemode: false,
    amount,
    amount_captured: manual ? 0 : amount,
    amount_refunded: 0,
    currency: "aud",
    captured: !manual,
    paid: true,
    refunded: false,
    status: "succeeded",
    payment_intent: pi.id,
    payment_method: pm.id,
    customer: sn(pi.data, "customer"),
    description: sn(pi.data, "description"),
    metadata: jo(pi.data, "metadata"),
    payment_method_details: { type: "card", card: jo(pm.data, "card") },
  });
  await ctx.tx.put(charge);
  pi.data["payment_method"] = pm.id;
  pi.data["latest_charge"] = chargeId;
  pi.data["last_payment_error"] = null;
  pi.data["next_action"] = null;
  if (manual) {
    pi.data["status"] = "requires_capture";
    pi.data["amount_capturable"] = amount;
    pi.dueAt = new Date(ctx.now.getTime() + HOLD_MS);
    await ctx.tx.put(pi);
    await emitEvent(ctx, "payment_intent.amount_capturable_updated", pi.data, pi.account);
    return;
  }
  pi.data["status"] = "succeeded";
  pi.data["amount_received"] = amount;
  pi.data["amount_capturable"] = 0;
  pi.dueAt = null;
  await ctx.tx.put(pi);
  await captureFunds(ctx, pi, chargeId, amount);
  await emitEvent(ctx, "payment_intent.succeeded", pi.data, pi.account);
}

export async function captureIntent(
  ctx: Ctx,
  pi: StoredObject,
  amountToCapture: number | undefined,
): Promise<void> {
  const status = sv(pi.data, "status");
  if (status !== "requires_capture") {
    throw unexpectedState(
      `This PaymentIntent could not be captured because it has a status of ${status}. Only a PaymentIntent with one of the following statuses may be captured: requires_capture.`,
    );
  }
  const capturable = nv(pi.data, "amount_capturable");
  const amount = amountToCapture ?? capturable;
  if (amount < 1 || amount > capturable) {
    throw invalidRequest(
      `The amount_to_capture must be between 1 and ${aud(capturable)}, the amount that can be captured.`,
      { param: "amount_to_capture" },
    );
  }
  const chargeId = sv(pi.data, "latest_charge");
  const charge = await ctx.tx.get(chargeId, { forUpdate: true });
  if (charge !== undefined) {
    charge.data["captured"] = true;
    charge.data["amount_captured"] = amount;
    await ctx.tx.put(charge);
  }
  pi.data["status"] = "succeeded";
  pi.data["amount_received"] = amount;
  pi.data["amount_capturable"] = 0;
  pi.dueAt = null;
  await ctx.tx.put(pi);
  await captureFunds(ctx, pi, chargeId, amount);
  await emitEvent(ctx, "payment_intent.succeeded", pi.data, pi.account);
}

const CANCELABLE = [
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "requires_capture",
];
export const CANCEL_REASONS = [
  "duplicate",
  "fraudulent",
  "requested_by_customer",
  "abandoned",
] as const;

export async function cancelIntent(
  ctx: Ctx,
  pi: StoredObject,
  reason: string | null,
): Promise<void> {
  const status = sv(pi.data, "status");
  if (!CANCELABLE.includes(status)) {
    throw unexpectedState(
      `You cannot cancel this PaymentIntent because it has a status of ${status}. A PaymentIntent object can be canceled when it is one of the following statuses: ${CANCELABLE.join(", ")}.`,
    );
  }
  pi.data["status"] = "canceled";
  pi.data["canceled_at"] = unix(ctx.now);
  pi.data["cancellation_reason"] = reason;
  pi.data["amount_capturable"] = 0;
  pi.data["next_action"] = null;
  pi.dueAt = null;
  await ctx.tx.put(pi);
  await emitEvent(ctx, "payment_intent.canceled", pi.data, pi.account);
}

/** A failed attempt: the intent goes back to asking for a payment method. */
export async function failIntent(ctx: Ctx, pi: StoredObject, error: JsonObject): Promise<void> {
  pi.data["status"] = "requires_payment_method";
  pi.data["last_payment_error"] = error;
  pi.data["payment_method"] = null;
  pi.data["next_action"] = null;
  await ctx.tx.put(pi);
  await emitEvent(ctx, "payment_intent.payment_failed", pi.data, pi.account);
}

export const DECLINE_ERROR: JsonObject = {
  type: "card_error",
  code: "card_declined",
  decline_code: "generic_decline",
  message: "Your card was declined.",
};

export const AUTH_ERROR: JsonObject = {
  type: "invalid_request_error",
  code: "payment_intent_authentication_failure",
  message:
    "The provided PaymentMethod has failed authentication. You can provide payment_method_data or a new PaymentMethod to attempt to fulfill this PaymentIntent again.",
};
