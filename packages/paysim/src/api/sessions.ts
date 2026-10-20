import { unix } from "../ctx";
import { ID_PREFIX, newId } from "../ids";
import { amountTooSmall, invalidEnum, invalidRequest } from "../errors";
import type { ParamObject } from "../form";
import { int, list, metadata, oneOf, reqInt, reqStr, str } from "../params";
import { expireIfDue, expireSession } from "../domain/checkout";
import { load, metaJson, mk, sv } from "../domain/repo";
import type { JsonObject } from "../store";
import { type Route, ok } from "./common";

const MIN_AMOUNT = 50;
const MAX_AMOUNT = 99_999_999;
const MIN_LIFETIME_S = 30 * 60;
const MAX_LIFETIME_S = 24 * 60 * 60;

/** Redirect targets must be absolute http(s) URLs; nothing else is ever followed. */
export function httpUrl(param: string, value: string): string {
  const protocol = URL.canParse(value) ? new URL(value).protocol : "";
  // No whitespace or control characters: the value is later sent as a Location header.
  const clean = !/[\s\p{Cc}]/u.test(value);
  if (!clean || (protocol !== "https:" && protocol !== "http:")) {
    throw invalidRequest(`Invalid URL: ${param} must be an http or https URL.`, { param });
  }
  return value;
}

function paymentLine(params: ParamObject): { name: string; unit: number; quantity: number } {
  const items = list(params, "line_items");
  if (items?.length !== 1) {
    throw invalidRequest("Exactly one line item is supported in this simulation.", {
      param: "line_items",
    });
  }
  const currency = reqStr(params, "line_items", "0", "price_data", "currency");
  if (currency !== "aud") {
    throw invalidRequest("Only the aud currency is supported in this simulation.", {
      param: "line_items[0][price_data][currency]",
    });
  }
  const unit = reqInt(params, "line_items", "0", "price_data", "unit_amount");
  const name = reqStr(params, "line_items", "0", "price_data", "product_data", "name");
  const quantity = int(params, "line_items", "0", "quantity") ?? 1;
  if (quantity < 1) {
    throw invalidRequest("Invalid positive integer", { param: "line_items[0][quantity]" });
  }
  return { name, unit, quantity };
}

export const sessionRoutes: Route[] = [
  {
    method: "POST",
    path: "/v1/checkout/sessions",
    async run(ctx, { params }) {
      const mode = oneOf(reqStr(params, "mode"), ["payment", "setup"] as const);
      if (mode === undefined) throw invalidEnum("mode", ["payment", "setup"]);
      const successUrl = httpUrl("success_url", reqStr(params, "success_url"));
      const cancelRaw = str(params, "cancel_url");
      const cancelUrl = cancelRaw === undefined ? null : httpUrl("cancel_url", cancelRaw);
      const customerId = str(params, "customer");
      if (customerId !== undefined) {
        await load(ctx, customerId, "customer", { param: "customer" });
      }
      const localeRaw = str(params, "locale");
      const locale = oneOf(localeRaw, ["en", "id", "auto"] as const);
      if (localeRaw !== undefined && locale === undefined) {
        throw invalidEnum("locale", ["en", "id", "auto"]);
      }
      const nowS = unix(ctx.now);
      const expiresAt = int(params, "expires_at") ?? nowS + MAX_LIFETIME_S;
      if (expiresAt < nowS + MIN_LIFETIME_S || expiresAt > nowS + MAX_LIFETIME_S) {
        throw invalidRequest(
          "The expires_at timestamp must be between 30 minutes and 24 hours from now.",
          { param: "expires_at" },
        );
      }

      let total: number | null = null;
      const internal: JsonObject = { pending_card: null };
      if (mode === "payment") {
        const line = paymentLine(params);
        total = line.unit * line.quantity;
        if (total < MIN_AMOUNT) {
          throw amountTooSmall(
            "The Checkout Session's total amount due must add up to at least $0.50 aud",
            "line_items",
          );
        }
        if (total > MAX_AMOUNT) {
          throw invalidRequest("The Checkout Session's total amount is too large.", {
            code: "amount_too_large",
            param: "line_items",
          });
        }
        internal["line_item"] = {
          name: line.name,
          unit_amount: line.unit,
          quantity: line.quantity,
        };
        internal["pi_description"] = str(params, "payment_intent_data", "description") ?? null;
        internal["pi_metadata"] = metaJson(metadata(params, "payment_intent_data", "metadata"));
      } else {
        if (customerId === undefined) {
          throw invalidRequest("customer is required in setup mode in this simulation.", {
            code: "parameter_missing",
            param: "customer",
          });
        }
        const currency = str(params, "currency");
        if (currency !== undefined && currency !== "aud") {
          throw invalidRequest("Only the aud currency is supported in this simulation.", {
            param: "currency",
          });
        }
        internal["si_metadata"] = metaJson(metadata(params, "setup_intent_data", "metadata"));
      }

      const id = newId(ID_PREFIX.session);
      const base = ctx.config.publicBaseUrl.replace(/\/+$/, "");
      const session = mk(
        "checkout.session",
        id,
        ctx.account,
        {
          id,
          object: "checkout.session",
          created: nowS,
          livemode: false,
          mode,
          status: "open",
          payment_status: mode === "payment" ? "unpaid" : "no_payment_required",
          url: `${base}/checkout/${id}`,
          amount_total: total,
          amount_subtotal: total,
          currency: "aud",
          customer: customerId ?? null,
          client_reference_id: str(params, "client_reference_id") ?? null,
          metadata: metaJson(metadata(params, "metadata")),
          payment_intent: null,
          setup_intent: null,
          success_url: successUrl,
          cancel_url: cancelUrl,
          expires_at: expiresAt,
          locale: locale ?? null,
        },
        internal,
        new Date(expiresAt * 1000),
      );
      await ctx.tx.put(session);
      return ok(ctx, session, params);
    },
  },
  {
    method: "GET",
    path: "/v1/checkout/sessions/:id",
    async run(ctx, { id, params }) {
      const session = await load(ctx, id, "checkout.session", { lock: true });
      await expireIfDue(ctx, session);
      return ok(ctx, session, params);
    },
  },
  {
    method: "POST",
    path: "/v1/checkout/sessions/:id/expire",
    async run(ctx, { id, params }) {
      const session = await load(ctx, id, "checkout.session", { lock: true });
      if (sv(session.data, "status") !== "open") {
        throw invalidRequest("Only Checkout Sessions with a status in open can be expired.");
      }
      await expireSession(ctx, session);
      return ok(ctx, session, params);
    },
  },
];
