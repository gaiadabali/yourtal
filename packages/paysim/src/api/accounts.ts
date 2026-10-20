import { unix } from "../ctx";
import { newToken } from "../ids";
import { invalidEnum, invalidRequest } from "../errors";
import { bool, metadata, oneOf, reqStr, str } from "../params";
import { newAccount } from "../domain/connect";
import { load, mk } from "../domain/repo";
import { type Route, ok } from "./common";
import { httpUrl } from "./sessions";

const BUSINESS_TYPES = ["individual", "company", "non_profit", "government_entity"] as const;
const LINK_TYPES = ["account_onboarding", "account_update"] as const;
const LINK_LIFETIME_S = 30 * 60;

export const accountRoutes: Route[] = [
  {
    method: "POST",
    path: "/v1/accounts",
    async run(ctx, { params }) {
      if (reqStr(params, "type") !== "express") throw invalidEnum("type", ["express"]);
      const country = str(params, "country") ?? "AU";
      if (country !== "AU") {
        throw invalidRequest("Only country=AU is supported in this simulation.", {
          param: "country",
        });
      }
      const businessRaw = str(params, "business_type");
      const businessType = oneOf(businessRaw, BUSINESS_TYPES);
      if (businessRaw !== undefined && businessType === undefined) {
        throw invalidEnum("business_type", BUSINESS_TYPES);
      }
      const intervalRaw = str(params, "settings", "payouts", "schedule", "interval") ?? "daily";
      const interval = oneOf(intervalRaw, ["manual", "daily"] as const);
      if (interval === undefined) {
        throw invalidEnum("settings[payouts][schedule][interval]", ["manual", "daily"]);
      }
      const account = newAccount(ctx, {
        email: str(params, "email") ?? null,
        businessType: businessType ?? null,
        country,
        transfersRequested: bool(params, "capabilities", "transfers", "requested") === true,
        cardPaymentsRequested: bool(params, "capabilities", "card_payments", "requested") === true,
        interval,
        metadata: metadata(params, "metadata"),
      });
      await ctx.tx.put(account);
      return ok(ctx, account, params);
    },
  },
  {
    method: "GET",
    path: "/v1/accounts/:id",
    async run(ctx, { id, params }) {
      return ok(ctx, await load(ctx, id, "account"), params);
    },
  },
  {
    method: "POST",
    path: "/v1/account_links",
    async run(ctx, { params }) {
      const accountId = reqStr(params, "account");
      await load(ctx, accountId, "account", { param: "account" });
      const refreshUrl = httpUrl("refresh_url", reqStr(params, "refresh_url"));
      const returnUrl = httpUrl("return_url", reqStr(params, "return_url"));
      const type = oneOf(reqStr(params, "type"), LINK_TYPES);
      if (type === undefined) throw invalidEnum("type", LINK_TYPES);
      const token = newToken("acl_");
      const created = unix(ctx.now);
      const expiresAt = created + LINK_LIFETIME_S;
      const base = ctx.config.publicBaseUrl.replace(/\/+$/, "");
      const link = mk(
        "account_link",
        token,
        null,
        {
          object: "account_link",
          created,
          expires_at: expiresAt,
          url: `${base}/connect/onboarding/${token}`,
        },
        { account: accountId, refresh_url: refreshUrl, return_url: returnUrl, link_type: type },
      );
      await ctx.tx.put(link);
      return ok(ctx, link, params);
    },
  },
];
