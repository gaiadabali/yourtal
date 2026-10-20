import { DEFAULT_API_VERSION, type PaySimConfig } from "./config";
import type { Ctx } from "./ctx";
import { unix } from "./ctx";
import { expireSession } from "./domain/checkout";
import { settlePayout, sweepDailyAccount } from "./domain/connect";
import { cancelIntent } from "./domain/payments";
import { nv, sv } from "./domain/repo";
import type { PaySimStore, StoredObject } from "./store";

const BATCH = 50;

async function sweepOne(ctx: Ctx, o: StoredObject): Promise<void> {
  switch (o.type) {
    case "checkout.session":
      if (sv(o.data, "status") === "open" && nv(o.data, "expires_at") <= unix(ctx.now)) {
        await expireSession(ctx, o);
        return;
      }
      break;
    case "payment_intent":
      if (sv(o.data, "status") === "requires_capture") {
        await cancelIntent(ctx, o, "automatic");
        return;
      }
      break;
    case "payout":
      if (sv(o.data, "status") === "pending") {
        await settlePayout(ctx, o);
        return;
      }
      break;
    case "account":
      await sweepDailyAccount(ctx, o);
      return;
    default:
      break;
  }
  // Nothing left to do for this row: stop looking at it.
  o.dueAt = null;
  await ctx.tx.put(o);
}

/**
 * Session expiry, lapsed holds, payouts pending -> paid/failed, and daily
 * accounts into payouts. Rows are locked, so two processes can both run it.
 */
export async function runSweep(
  store: PaySimStore,
  config: PaySimConfig,
  now: Date,
): Promise<number> {
  let total = 0;
  for (let round = 0; round < 20; round += 1) {
    const handled = await store.transaction(async (tx) => {
      const ctx: Ctx = {
        tx,
        now,
        config,
        apiVersion: DEFAULT_API_VERSION,
        idempotencyKey: null,
        account: null,
      };
      const rows = await tx.claimDueObjects(now, BATCH);
      for (const o of rows) await sweepOne(ctx, o);
      return rows.length;
    });
    total += handled;
    if (handled < BATCH) break;
  }
  return total;
}
