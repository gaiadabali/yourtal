import { type Ctx, unix } from "../ctx";
import { ID_PREFIX, newId } from "../ids";
import type { JsonObject } from "../store";
import { mk } from "./repo";

/**
 * Records an event and queues its webhook delivery in the caller's
 * transaction, so an event exists exactly when the change it describes does.
 */
export async function emitEvent(
  ctx: Ctx,
  type: string,
  object: JsonObject,
  account: string | null,
): Promise<void> {
  const id = newId(ID_PREFIX.event);
  const event: JsonObject = {
    id,
    object: "event",
    api_version: ctx.apiVersion,
    created: unix(ctx.now),
    type,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: ctx.idempotencyKey },
    data: { object: structuredClone(object) },
    ...(account === null ? {} : { account }),
  };
  await ctx.tx.put(mk("event", id, account, event));
  await ctx.tx.enqueueDelivery({
    id: newId("whd_"),
    eventId: id,
    nextAttemptAt: ctx.now,
    now: ctx.now,
  });
}
