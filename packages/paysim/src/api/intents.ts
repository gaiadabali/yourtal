import { load, sn } from "../domain/repo";
import { type Route, ok } from "./common";

export const intentRoutes: Route[] = [
  {
    method: "GET",
    path: "/v1/setup_intents/:id",
    async run(ctx, { id, params }) {
      return ok(ctx, await load(ctx, id, "setup_intent"), params);
    },
  },
  {
    method: "GET",
    path: "/v1/payment_methods/:id",
    async run(ctx, { id, params }) {
      const method = await load(ctx, id, "payment_method");
      // Deleting a customer deletes its payment methods; a method of a deleted customer reads as detached.
      const owner = sn(method.data, "customer");
      if (owner !== null && (await ctx.tx.get(owner))?.type !== "customer") {
        return ok(ctx, { ...method, data: { ...method.data, customer: null } }, params);
      }
      return ok(ctx, method, params);
    },
  },
  {
    method: "GET",
    path: "/v1/events/:id",
    async run(ctx, { id, params }) {
      return ok(ctx, await load(ctx, id, "event"), params);
    },
  },
];
