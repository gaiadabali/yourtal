import { type Ctx, unix } from "../ctx";
import { ID_PREFIX, newId } from "../ids";
import type { StoredObject } from "../store";
import { emitEvent } from "./events";
import { adjustAccount, adjustPlatform } from "./money";
import { metaJson, mk } from "./repo";

export interface TransferParams {
  amount: number;
  destination: string;
  transferGroup: string | null;
  description: string | null;
  metadata: Record<string, string>;
  sourceTransaction: string | null;
}

/** Credits the destination, debits the platform, records the transfer. */
export async function createTransfer(ctx: Ctx, p: TransferParams): Promise<StoredObject> {
  const id = newId(ID_PREFIX.transfer);
  await adjustAccount(ctx, p.destination, p.amount, { sweep: true });
  await adjustPlatform(ctx, -p.amount);
  const transfer = mk("transfer", id, null, {
    id,
    object: "transfer",
    created: unix(ctx.now),
    livemode: false,
    amount: p.amount,
    amount_reversed: 0,
    currency: "aud",
    destination: p.destination,
    reversed: false,
    metadata: metaJson(p.metadata),
    transfer_group: p.transferGroup,
    description: p.description,
    source_transaction: p.sourceTransaction,
  });
  await ctx.tx.put(transfer);
  await emitEvent(ctx, "transfer.created", transfer.data, null);
  return transfer;
}
