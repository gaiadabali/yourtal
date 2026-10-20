import { type Ctx, unix } from "../ctx";
import { ID_PREFIX, newId } from "../ids";
import type { Json, JsonObject, StoredObject } from "../store";
import { type CardInfo, type CardScenario, createPaymentMethod } from "./cards";
import { emitEvent } from "./events";
import { AUTH_ERROR, DECLINE_ERROR, confirmIntent, failIntent, newPaymentIntent } from "./payments";
import { jo, mk, nv, sn, sv } from "./repo";

export type AttemptResult = "complete" | "declined" | "needs_3ds";

const isPayment = (s: StoredObject): boolean => sv(s.data, "mode") === "payment";

export async function expireSession(ctx: Ctx, s: StoredObject): Promise<void> {
  s.data["status"] = "expired";
  s.data["url"] = null;
  s.dueAt = null;
  s.internal["pending_card"] = null;
  await ctx.tx.put(s);
  await emitEvent(ctx, "checkout.session.expired", s.data, s.account);
}

/** An open session past `expires_at` is expired, whoever notices first. */
export async function expireIfDue(ctx: Ctx, s: StoredObject): Promise<boolean> {
  const due = sv(s.data, "status") === "open" && nv(s.data, "expires_at") <= unix(ctx.now);
  if (due) await expireSession(ctx, s);
  return sv(s.data, "status") === "expired";
}

function newSetupIntent(ctx: Ctx, s: StoredObject): StoredObject {
  const id = newId(ID_PREFIX.setupIntent);
  return mk("setup_intent", id, s.account, {
    id,
    object: "setup_intent",
    created: unix(ctx.now),
    livemode: false,
    status: "requires_payment_method",
    customer: sn(s.data, "customer"),
    payment_method: null,
    usage: "off_session",
    metadata: jo(s.internal, "si_metadata"),
    last_setup_error: null,
    next_action: null,
  });
}

/** The intent behind the session, created on the first card attempt. */
async function ensureIntent(ctx: Ctx, s: StoredObject): Promise<StoredObject> {
  const field = isPayment(s) ? "payment_intent" : "setup_intent";
  const existing = sn(s.data, field);
  if (existing !== null) {
    const found = await ctx.tx.get(existing, { forUpdate: true });
    if (found !== undefined) return found;
  }
  const intent = isPayment(s)
    ? newPaymentIntent(ctx, {
        amount: nv(s.data, "amount_total"),
        customer: sn(s.data, "customer"),
        description: sn(s.internal, "pi_description"),
        metadata: stringMap(jo(s.internal, "pi_metadata")),
        captureMethod: "automatic",
        destination: null,
        onBehalfOf: null,
        account: s.account,
      })
    : newSetupIntent(ctx, s);
  await ctx.tx.put(intent);
  s.data[field] = intent.id;
  await ctx.tx.put(s);
  return intent;
}

function stringMap(o: JsonObject): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === "string") out[k] = v;
  return out;
}

async function completeWithCard(
  ctx: Ctx,
  s: StoredObject,
  intent: StoredObject,
  card: CardInfo,
): Promise<void> {
  s.internal["pending_card"] = null;
  s.data["status"] = "complete";
  s.data["url"] = null;
  s.dueAt = null;
  if (isPayment(s)) {
    const pm = createPaymentMethod(ctx, card, null, s.account);
    await ctx.tx.put(pm);
    await confirmIntent(ctx, intent, pm);
    s.data["payment_status"] = "paid";
  } else {
    const pm = createPaymentMethod(ctx, card, sn(s.data, "customer"), s.account);
    await ctx.tx.put(pm);
    intent.data["status"] = "succeeded";
    intent.data["payment_method"] = pm.id;
    intent.data["next_action"] = null;
    intent.data["last_setup_error"] = null;
    await ctx.tx.put(intent);
    await emitEvent(ctx, "setup_intent.succeeded", intent.data, s.account);
    s.data["payment_status"] = "no_payment_required";
  }
  await ctx.tx.put(s);
  await emitEvent(ctx, "checkout.session.completed", s.data, s.account);
}

async function failSetup(ctx: Ctx, intent: StoredObject, error: JsonObject): Promise<void> {
  intent.data["status"] = "requires_payment_method";
  intent.data["last_setup_error"] = error;
  intent.data["next_action"] = null;
  await ctx.tx.put(intent);
}

/** A card has been entered on the page: pay, decline, or ask for 3-D Secure. */
export async function attemptCard(
  ctx: Ctx,
  s: StoredObject,
  scenario: CardScenario,
  card: CardInfo,
): Promise<AttemptResult> {
  const intent = await ensureIntent(ctx, s);
  if (scenario === "declined") {
    if (isPayment(s)) await failIntent(ctx, intent, DECLINE_ERROR);
    else await failSetup(ctx, intent, DECLINE_ERROR);
    return "declined";
  }
  if (scenario === "threeds") {
    intent.data["status"] = "requires_action";
    intent.data["next_action"] = { type: "use_stripe_sdk" };
    s.internal["pending_card"] = {
      brand: card.brand,
      last4: card.last4,
      exp_month: card.expMonth,
      exp_year: card.expYear,
    } satisfies Json;
    await ctx.tx.put(intent);
    await ctx.tx.put(s);
    return "needs_3ds";
  }
  await completeWithCard(ctx, s, intent, card);
  return "complete";
}

export function pendingCard(s: StoredObject): CardInfo | null {
  const c = jo(s.internal, "pending_card");
  if (Object.keys(c).length === 0) return null;
  return {
    brand: "visa",
    last4: sv(c, "last4"),
    expMonth: nv(c, "exp_month"),
    expYear: nv(c, "exp_year"),
  };
}

/** The shopper pressed Complete or Fail on the 3-D Secure challenge. */
export async function resolveThreeDS(
  ctx: Ctx,
  s: StoredObject,
  outcome: "complete" | "fail",
): Promise<"complete" | "failed"> {
  const card = pendingCard(s);
  const intent = await ensureIntent(ctx, s);
  if (card === null) return "failed";
  if (outcome === "complete") {
    await completeWithCard(ctx, s, intent, card);
    return "complete";
  }
  s.internal["pending_card"] = null;
  await ctx.tx.put(s);
  if (isPayment(s)) await failIntent(ctx, intent, AUTH_ERROR);
  else await failSetup(ctx, intent, AUTH_ERROR);
  return "failed";
}
