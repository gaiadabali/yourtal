import { load } from "../domain/repo";
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
      return ok(ctx, await load(ctx, id, "payment_method"), params);
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
