import { invalidRequest } from "../errors";
import { metadata, reqInt, reqStr, str } from "../params";
import { createPayout } from "../domain/connect";
import { accountBalance, platformBalance } from "../domain/money";
import { jo, load, sv } from "../domain/repo";
import { createTransfer } from "../domain/transfers";
import { type Route, ok } from "./common";
import { createdFilter, listPage } from "./lists";

function aud(param: string, value: string): void {
  if (value !== "aud") {
    throw invalidRequest("Only the aud currency is supported in this simulation.", { param });
  }
}

export const moneyRoutes: Route[] = [
  {
    method: "POST",
    path: "/v1/transfers",
    async run(ctx, { params }) {
      const amount = reqInt(params, "amount");
      aud("currency", reqStr(params, "currency"));
      const destination = reqStr(params, "destination");
      if (amount < 1) throw invalidRequest("Invalid positive integer", { param: "amount" });
      const acct = await load(ctx, destination, "account", { param: "destination" });
      if (sv(jo(acct.data, "capabilities"), "transfers") !== "active") {
        throw invalidRequest(
          "Your destination account needs to have at least one of the following capabilities enabled: transfers, crypto_transfers, legacy_payments",
          { code: "insufficient_capabilities_for_transfer", param: "destination" },
        );
      }
      const transfer = await createTransfer(ctx, {
        amount,
        destination,
        transferGroup: str(params, "transfer_group") ?? null,
        description: str(params, "description") ?? null,
        metadata: metadata(params, "metadata"),
        sourceTransaction: null,
      });
      return ok(ctx, transfer, params);
    },
  },
  {
    method: "POST",
    path: "/v1/payouts",
    async run(ctx, { params }) {
      if (ctx.account === null) {
        throw invalidRequest(
          "Payouts are made on a connected account in this simulation: send the Stripe-Account header.",
        );
      }
      const amount = reqInt(params, "amount");
      aud("currency", reqStr(params, "currency"));
      const acct = await load(ctx, ctx.account, "account", { lock: true, unscoped: true });
      const payout = await createPayout(ctx, acct, {
        amount,
        description: str(params, "description") ?? null,
        metadata: metadata(params, "metadata"),
      });
      return ok(ctx, payout, params);
    },
  },
  {
    method: "GET",
    path: "/v1/payouts",
    async run(ctx, { params }) {
      if (ctx.account === null) {
        throw invalidRequest(
          "Payouts are listed on a connected account in this simulation: send the Stripe-Account header.",
        );
      }
      const payouts = await ctx.tx.list("payout", ctx.account);
      return listPage(ctx, params, "payout", "/v1/payouts", payouts, createdFilter(params));
    },
  },
  {
    method: "GET",
    path: "/v1/transfers",
    async run(ctx, { params }) {
      const transfers = await ctx.tx.list("transfer", null);
      const inRange = createdFilter(params);
      const destination = str(params, "destination");
      const group = str(params, "transfer_group");
      return listPage(
        ctx,
        params,
        "transfer",
        "/v1/transfers",
        transfers,
        (o) =>
          inRange(o) &&
          (destination === undefined || o.data["destination"] === destination) &&
          (group === undefined || o.data["transfer_group"] === group),
      );
    },
  },
  {
    method: "GET",
    path: "/v1/payouts/:id",
    async run(ctx, { id, params }) {
      return ok(ctx, await load(ctx, id, "payout"), params);
    },
  },
  {
    method: "GET",
    path: "/v1/balance",
    async run(ctx) {
      const available =
        ctx.account === null
          ? await platformBalance(ctx)
          : accountBalance(await load(ctx, ctx.account, "account", { unscoped: true }));
      return {
        body: {
          object: "balance",
          livemode: false,
          available: [{ amount: available, currency: "aud" }],
          pending: [{ amount: 0, currency: "aud" }],
        },
      };
    },
  },
];
