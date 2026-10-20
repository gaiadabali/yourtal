import { invalidEnum } from "../errors";
import { int, metadata, oneOf, reqStr, str } from "../params";
import { REFUND_REASONS, createRefund } from "../domain/refunds";
import { load } from "../domain/repo";
import { type Route, ok } from "./common";

export const refundRoutes: Route[] = [
  {
    method: "POST",
    path: "/v1/refunds",
    async run(ctx, { params }) {
      const piId = reqStr(params, "payment_intent");
      const reasonRaw = str(params, "reason");
      const reason = oneOf(reasonRaw, REFUND_REASONS);
      if (reasonRaw !== undefined && reason === undefined) {
        throw invalidEnum("reason", REFUND_REASONS);
      }
      const amount = int(params, "amount");
      const pi = await load(ctx, piId, "payment_intent", {
        param: "payment_intent",
      });
      const refund = await createRefund(ctx, pi, {
        amount,
        reason: reason ?? null,
        metadata: metadata(params, "metadata"),
      });
      return ok(ctx, refund, params);
    },
  },
];
