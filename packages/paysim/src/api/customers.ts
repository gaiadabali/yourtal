import { unix } from "../ctx";
import { ID_PREFIX, newId } from "../ids";
import { invalidRequest } from "../errors";
import { metadata, str } from "../params";
import { jo, load, metaJson, mk, sn } from "../domain/repo";
import type { JsonObject } from "../store";
import { type Route, ok } from "./common";

/** `metadata[k]=""` removes the key, as at Stripe. */
export function mergeMetadata(current: JsonObject, change: Record<string, string>): JsonObject {
  const merged: JsonObject = { ...current, ...change };
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== ""));
}

export const customerRoutes: Route[] = [
  {
    method: "POST",
    path: "/v1/customers",
    async run(ctx, { params }) {
      const id = newId(ID_PREFIX.customer);
      const customer = mk("customer", id, ctx.account, {
        id,
        object: "customer",
        created: unix(ctx.now),
        livemode: false,
        email: str(params, "email") ?? null,
        name: str(params, "name") ?? null,
        metadata: metaJson(metadata(params, "metadata")),
        invoice_settings: { default_payment_method: null },
      });
      await ctx.tx.put(customer);
      return ok(ctx, customer, params);
    },
  },
  {
    method: "GET",
    path: "/v1/customers/:id",
    async run(ctx, { id, params }) {
      return ok(ctx, await load(ctx, id, "customer"), params);
    },
  },
  {
    method: "POST",
    path: "/v1/customers/:id",
    async run(ctx, { id, params }) {
      const customer = await load(ctx, id, "customer", { lock: true });
      const email = str(params, "email");
      const name = str(params, "name");
      if (email !== undefined) customer.data["email"] = email;
      if (name !== undefined) customer.data["name"] = name;
      customer.data["metadata"] = mergeMetadata(
        jo(customer.data, "metadata"),
        metadata(params, "metadata"),
      );
      const pmId = str(params, "invoice_settings", "default_payment_method");
      if (pmId !== undefined) {
        const pm = await load(ctx, pmId, "payment_method", {
          param: "invoice_settings[default_payment_method]",
        });
        if (sn(pm.data, "customer") !== id) {
          throw invalidRequest(
            `The customer does not have a payment method with the ID ${pmId}. The payment method must be attached to the customer.`,
            { param: "invoice_settings[default_payment_method]" },
          );
        }
        customer.data["invoice_settings"] = { default_payment_method: pmId };
      }
      await ctx.tx.put(customer);
      return ok(ctx, customer, params);
    },
  },
];
