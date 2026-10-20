import type { Ctx } from "../ctx";
import { load, mk, nv, sv } from "./repo";
import type { StoredObject } from "../store";

/** Integer cents as "$12.34", no floating point. */
export function aud(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const PLATFORM = "platform";

async function platform(ctx: Ctx): Promise<StoredObject> {
  return (
    (await ctx.tx.get(PLATFORM, { forUpdate: true })) ??
    mk("platform", PLATFORM, null, {}, { balance: 0 })
  );
}

export async function platformBalance(ctx: Ctx): Promise<number> {
  return nv((await platform(ctx)).internal, "balance");
}

/** The platform balance is reported but never enforced (see the contract). */
export async function adjustPlatform(ctx: Ctx, delta: number): Promise<void> {
  const p = await platform(ctx);
  p.internal["balance"] = nv(p.internal, "balance") + delta;
  await ctx.tx.put(p);
}

export function accountBalance(account: StoredObject): number {
  return nv(account.internal, "balance");
}

/**
 * Moves money in a connected account's balance. A credit to a `daily`
 * account queues it for the sweep, which pays the balance out.
 */
export async function adjustAccount(
  ctx: Ctx,
  accountId: string,
  delta: number,
  opts: { sweep: boolean },
): Promise<StoredObject> {
  const acct = await load(ctx, accountId, "account", { lock: true });
  acct.internal["balance"] = accountBalance(acct) + delta;
  const daily = sv(acct.internal, "interval") === "daily";
  if (delta > 0 && opts.sweep && daily && acct.dueAt === null) acct.dueAt = ctx.now;
  await ctx.tx.put(acct);
  return acct;
}
