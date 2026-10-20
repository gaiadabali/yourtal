import type { Ctx } from "../ctx";
import { resourceMissing } from "../errors";
import type { Json, JsonObject, StoredObject } from "../store";

/** Labels as Stripe words them in "No such ...". */
const LABELS: Record<string, string> = {
  customer: "customer",
  "checkout.session": "checkout.session",
  payment_intent: "payment_intent",
  setup_intent: "setupintent",
  payment_method: "PaymentMethod",
  account: "account",
  payout: "payout",
  event: "event",
  charge: "charge",
};

/** Objects the platform key may read whatever the `Stripe-Account` scope. */
const UNSCOPED = new Set(["account"]);

export function label(type: string): string {
  return LABELS[type] ?? type;
}

export interface LoadOpts {
  lock?: boolean;
  /** Name of the request parameter that carried the id, for the error. */
  param?: string;
  /** Skip the `Stripe-Account` scope check (internal lookups). */
  unscoped?: boolean;
}

export async function load(
  ctx: Ctx,
  id: string,
  type: string,
  opts: LoadOpts = {},
): Promise<StoredObject> {
  const o = await ctx.tx.get(id, { forUpdate: opts.lock === true });
  const scoped = opts.unscoped !== true && !UNSCOPED.has(type);
  if (o?.type !== type || (scoped && o.account !== ctx.account)) {
    throw resourceMissing(label(type), id, opts.param);
  }
  return o;
}

export function mk(
  type: string,
  id: string,
  account: string | null,
  data: JsonObject,
  internal: JsonObject = {},
  dueAt: Date | null = null,
): StoredObject {
  return { id, type, account, data, internal, dueAt };
}

export function sv(o: JsonObject, key: string): string {
  const v = o[key];
  return typeof v === "string" ? v : "";
}

export function sn(o: JsonObject, key: string): string | null {
  const v = o[key];
  return typeof v === "string" ? v : null;
}

export function nv(o: JsonObject, key: string): number {
  const v = o[key];
  return typeof v === "number" ? v : 0;
}

export function jo(o: JsonObject, key: string): JsonObject {
  const v: Json | undefined = o[key];
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
}

export function metaJson(m: Record<string, string>): JsonObject {
  return { ...m };
}
