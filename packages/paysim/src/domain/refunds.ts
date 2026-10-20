import { type Ctx, unix } from "../ctx";
import { ID_PREFIX, newId } from "../ids";
import { invalidRequest } from "../errors";
import type { StoredObject } from "../store";
import { emitEvent } from "./events";
import { adjustPlatform, aud } from "./money";
import { load, metaJson, mk, nv, sv } from "./repo";

export interface RefundParams {
  amount: number | undefined;
  reason: string | null;
  metadata: Record<string, string>;
}

export const REFUND_REASONS = ["duplicate", "fraudulent", "requested_by_customer"] as const;

/** Refunds a captured charge, whole or in part. The platform bears it. */
export async function createRefund(
  ctx: Ctx,
  pi: StoredObject,
  p: RefundParams,
): Promise<StoredObject> {
  const chargeId = sv(pi.data, "latest_charge");
  const charge = chargeId === "" ? undefined : await load(ctx, chargeId, "charge", { lock: true });
  if (charge === undefined || charge.data["captured"] !== true) {
    throw invalidRequest(
      `The PaymentIntent ${pi.id} has no captured charge, so there is nothing to refund.`,
      { param: "payment_intent" },
    );
  }
  const remaining = nv(charge.data, "amount_captured") - nv(charge.data, "amount_refunded");
  if (remaining === 0) {
    throw invalidRequest(`Charge ${charge.id} has already been refunded.`, {
      code: "charge_already_refunded",
    });
  }
  const amount = p.amount ?? remaining;
  if (amount < 1) {
    throw invalidRequest("Invalid positive integer", { param: "amount" });
  }
  if (amount > remaining) {
    throw invalidRequest(
      `Refund amount (${aud(amount)}) is greater than unrefunded amount on charge (${aud(remaining)})`,
      { param: "amount" },
    );
  }
  charge.data["amount_refunded"] = nv(charge.data, "amount_refunded") + amount;
  charge.data["refunded"] = amount === remaining;
  await ctx.tx.put(charge);
  await adjustPlatform(ctx, -amount);

  const id = newId(ID_PREFIX.refund);
  const refund = mk("refund", id, pi.account, {
    id,
    object: "refund",
    created: unix(ctx.now),
    livemode: false,
    amount,
    currency: "aud",
    payment_intent: pi.id,
    charge: charge.id,
    status: "succeeded",
    reason: p.reason,
    metadata: metaJson(p.metadata),
  });
  await ctx.tx.put(refund);
  await emitEvent(ctx, "refund.created", refund.data, pi.account);
  await emitEvent(ctx, "charge.refunded", charge.data, pi.account);
  return refund;
}
