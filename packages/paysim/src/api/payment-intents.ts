import { amountTooSmall, invalidEnum, invalidRequest, missingParam } from "../errors";
import { bool, int, metadata, oneOf, reqInt, reqStr, str } from "../params";
import {
  CANCEL_REASONS,
  cancelIntent,
  captureIntent,
  confirmIntent,
  newPaymentIntent,
} from "../domain/payments";
import { load, sn } from "../domain/repo";
import { type Route, ok } from "./common";

const MIN_AMOUNT = 50;
const MAX_AMOUNT = 99_999_999;

export const paymentIntentRoutes: Route[] = [
  {
    method: "POST",
    path: "/v1/payment_intents",
    async run(ctx, { params }) {
      const amount = reqInt(params, "amount");
      if (amount < MIN_AMOUNT) {
        throw amountTooSmall("Amount must be at least $0.50 aud", "amount");
      }
      if (amount > MAX_AMOUNT) {
        throw invalidRequest("Amount must be no more than $999,999.99 aud", {
          code: "amount_too_large",
          param: "amount",
        });
      }
      if (reqStr(params, "currency") !== "aud") {
        throw invalidRequest("Only the aud currency is supported in this simulation.", {
          param: "currency",
        });
      }
      const customer = str(params, "customer");
      if (customer !== undefined) await load(ctx, customer, "customer", { param: "customer" });
      const pmId = str(params, "payment_method");
      let pm = null;
      if (pmId !== undefined) {
        pm = await load(ctx, pmId, "payment_method", { param: "payment_method" });
        if (customer === undefined || sn(pm.data, "customer") !== customer) {
          throw invalidRequest(
            `The customer does not have a payment method with the ID ${pmId}. The payment method must be attached to the customer.`,
            { param: "payment_method" },
          );
        }
      }
      const captureRaw = str(params, "capture_method");
      const captureMethod = oneOf(captureRaw ?? "automatic", ["automatic", "manual"] as const);
      if (captureMethod === undefined) throw invalidEnum("capture_method", ["automatic", "manual"]);
      const destination = str(params, "transfer_data", "destination");
      if (destination !== undefined) {
        const acct = await load(ctx, destination, "account", {
          param: "transfer_data[destination]",
        });
        if (acct.data["charges_enabled"] !== true) {
          throw invalidRequest(
            `The account ${destination} cannot be the destination of a charge: it has not finished onboarding (charges_enabled is false).`,
            { param: "transfer_data[destination]" },
          );
        }
      }
      const onBehalfOf = str(params, "on_behalf_of");
      if (onBehalfOf !== undefined) {
        await load(ctx, onBehalfOf, "account", { param: "on_behalf_of" });
      }
      const confirm = bool(params, "confirm") === true;
      if (confirm && pm === null) throw missingParam("payment_method");

      const pi = newPaymentIntent(ctx, {
        amount,
        customer: customer ?? null,
        description: str(params, "description") ?? null,
        metadata: metadata(params, "metadata"),
        captureMethod,
        destination: destination ?? null,
        onBehalfOf: onBehalfOf ?? null,
        account: ctx.account,
      });
      if (pm !== null) {
        pi.data["payment_method"] = pm.id;
        pi.data["status"] = "requires_confirmation";
      }
      await ctx.tx.put(pi);
      if (confirm && pm !== null) await confirmIntent(ctx, pi, pm);
      return ok(ctx, pi, params);
    },
  },
  {
    method: "GET",
    path: "/v1/payment_intents/:id",
    async run(ctx, { id, params }) {
      return ok(ctx, await load(ctx, id, "payment_intent"), params);
    },
  },
  {
    method: "POST",
    path: "/v1/payment_intents/:id/capture",
    async run(ctx, { id, params }) {
      const pi = await load(ctx, id, "payment_intent", { lock: true });
      await captureIntent(ctx, pi, int(params, "amount_to_capture"));
      return ok(ctx, pi, params);
    },
  },
  {
    method: "POST",
    path: "/v1/payment_intents/:id/cancel",
    async run(ctx, { id, params }) {
      const raw = str(params, "cancellation_reason");
      const reason = oneOf(raw, CANCEL_REASONS);
      if (raw !== undefined && reason === undefined) {
        throw invalidEnum("cancellation_reason", CANCEL_REASONS);
      }
      const pi = await load(ctx, id, "payment_intent", { lock: true });
      await cancelIntent(ctx, pi, reason ?? null);
      return ok(ctx, pi, params);
    },
  },
];
