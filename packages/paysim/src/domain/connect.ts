import { type Ctx, unix } from "../ctx";
import { ID_PREFIX, newId } from "../ids";
import { invalidRequest } from "../errors";
import type { JsonObject, StoredObject } from "../store";
import { emitEvent } from "./events";
import { accountBalance, aud } from "./money";
import { jo, metaJson, mk, nv, sv } from "./repo";

/** How long a payout stays `pending` before the sweep settles it. */
export const PAYOUT_DELAY_MS = 30_000;

export type BankScenario = "ok" | "no_account" | "account_closed";

const PAYOUT_FAILURES: Record<Exclude<BankScenario, "ok">, [string, string]> = {
  no_account: [
    "no_account",
    "The bank account details on file are probably incorrect. No bank account could be located with those details.",
  ],
  account_closed: ["account_closed", "The bank account has been closed."],
};

export interface NewAccount {
  email: string | null;
  businessType: string | null;
  country: string;
  transfersRequested: boolean;
  cardPaymentsRequested: boolean;
  interval: "manual" | "daily";
  metadata: Record<string, string>;
}

export function newAccount(ctx: Ctx, n: NewAccount): StoredObject {
  const id = newId(ID_PREFIX.account);
  const capabilities: JsonObject = {};
  if (n.transfersRequested) capabilities["transfers"] = "inactive";
  if (n.cardPaymentsRequested) capabilities["card_payments"] = "inactive";
  return mk(
    "account",
    id,
    null,
    {
      id,
      object: "account",
      created: unix(ctx.now),
      livemode: false,
      type: "express",
      country: n.country,
      email: n.email,
      business_type: n.businessType,
      default_currency: "aud",
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      capabilities,
      external_accounts: {
        object: "list",
        data: [],
        has_more: false,
        total_count: 0,
        url: `/v1/accounts/${id}/external_accounts`,
      },
      settings: { payouts: { schedule: { interval: n.interval } } },
      requirements: { currently_due: ["external_account", "tos_acceptance.date"] },
      metadata: metaJson(n.metadata),
    },
    { balance: 0, interval: n.interval },
  );
}

/** The onboarding form was submitted with an accepted bank account. */
export async function completeOnboarding(
  ctx: Ctx,
  acct: StoredObject,
  bank: { scenario: BankScenario; last4: string; routing: string },
): Promise<void> {
  const baId = newId(ID_PREFIX.bankAccount);
  acct.data["charges_enabled"] = true;
  acct.data["payouts_enabled"] = true;
  acct.data["details_submitted"] = true;
  acct.data["capabilities"] = { transfers: "active", card_payments: "active" };
  acct.data["requirements"] = { currently_due: [] };
  acct.data["external_accounts"] = {
    object: "list",
    data: [
      {
        id: baId,
        object: "bank_account",
        country: "AU",
        currency: "aud",
        last4: bank.last4,
        routing_number: bank.routing,
      },
    ],
    has_more: false,
    total_count: 1,
    url: `/v1/accounts/${acct.id}/external_accounts`,
  };
  acct.internal["bank"] = { id: baId, scenario: bank.scenario };
  await ctx.tx.put(acct);
  await emitEvent(ctx, "account.updated", acct.data, acct.id);
}

export function bankOf(acct: StoredObject): { id: string; scenario: BankScenario } | null {
  const b = jo(acct.internal, "bank");
  const id = sv(b, "id");
  if (id === "") return null;
  const s = sv(b, "scenario");
  return { id, scenario: s === "no_account" || s === "account_closed" ? s : "ok" };
}

export interface NewPayout {
  amount: number;
  description: string | null;
  metadata: Record<string, string>;
}

/** Takes the amount out of the balance now; the sweep settles it later. */
export async function createPayout(
  ctx: Ctx,
  acct: StoredObject,
  p: NewPayout,
): Promise<StoredObject> {
  const bank = bankOf(acct);
  if (acct.data["payouts_enabled"] !== true || bank === null) {
    throw invalidRequest(
      "Cannot create a payout: this account has no bank account to pay out to. Complete onboarding first.",
    );
  }
  const balance = accountBalance(acct);
  if (p.amount < 1) throw invalidRequest("Invalid positive integer", { param: "amount" });
  if (p.amount > balance) {
    throw invalidRequest(
      `You have insufficient funds in your Stripe account for this payout. Your available balance is ${aud(balance)}.`,
      { param: "amount", code: "balance_insufficient" },
    );
  }
  acct.internal["balance"] = balance - p.amount;
  await ctx.tx.put(acct);
  const id = newId(ID_PREFIX.payout);
  const payout = mk(
    "payout",
    id,
    acct.id,
    {
      id,
      object: "payout",
      created: unix(ctx.now),
      livemode: false,
      amount: p.amount,
      currency: "aud",
      status: "pending",
      type: "bank_account",
      method: "standard",
      arrival_date: unix(ctx.now) + 86_400,
      destination: bank.id,
      failure_code: null,
      failure_message: null,
      description: p.description,
      metadata: metaJson(p.metadata),
    },
    {},
    new Date(ctx.now.getTime() + PAYOUT_DELAY_MS),
  );
  await ctx.tx.put(payout);
  return payout;
}

/** ~30 s after creation: paid, or failed with the amount back in the balance. */
export async function settlePayout(ctx: Ctx, payout: StoredObject): Promise<void> {
  payout.dueAt = null;
  const acct = await ctx.tx.get(payout.account ?? "", { forUpdate: true });
  const scenario = acct === undefined ? "ok" : (bankOf(acct)?.scenario ?? "ok");
  if (scenario === "ok" || acct === undefined) {
    payout.data["status"] = "paid";
    await ctx.tx.put(payout);
    await emitEvent(ctx, "payout.paid", payout.data, payout.account);
    return;
  }
  const [code, message] = PAYOUT_FAILURES[scenario];
  payout.data["status"] = "failed";
  payout.data["failure_code"] = code;
  payout.data["failure_message"] = message;
  await ctx.tx.put(payout);
  // Back to the balance without re-queuing the daily sweep, or it would loop.
  acct.internal["balance"] = accountBalance(acct) + nv(payout.data, "amount");
  await ctx.tx.put(acct);
  await emitEvent(ctx, "payout.failed", payout.data, payout.account);
}

/** A `daily` account's whole balance becomes a payout. */
export async function sweepDailyAccount(ctx: Ctx, acct: StoredObject): Promise<void> {
  acct.dueAt = null;
  const balance = accountBalance(acct);
  if (balance > 0 && acct.data["payouts_enabled"] === true && bankOf(acct) !== null) {
    await createPayout(ctx, acct, { amount: balance, description: null, metadata: {} });
    return;
  }
  await ctx.tx.put(acct);
}
