import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  approveBatchRequestSchema,
  batchSchema,
  requestBatchRequestSchema,
} from "@yourtal/contracts/voucher-internal/batches";
import { existingListingFacts, postSigned } from "../staging";
import type { StagingVoucherConfig } from "../staging";

/**
 * Tops a listing up to `want` unused vouchers through the voucher service's
 * two-person batch flow (a request and a different approver), the same calls
 * `demo-media-vouchers.ts` makes. Never inserts a voucher row itself.
 */
export async function mintVouchers(
  pool: pg.Pool,
  voucher: StagingVoucherConfig,
  input: { readonly listingId: string; readonly merchantId: string; readonly want: number },
): Promise<number> {
  const unused = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM voucher.vouchers
      WHERE listing_id = $1 AND state IN ('minted', 'allocated')`,
    [input.listingId],
  );
  const missing = input.want - Number(unused.rows[0]?.n ?? "0");
  if (missing <= 0) return 0;

  const facts = await existingListingFacts(pool, input.listingId);
  if (facts === null) throw new Error(`no listing ${input.listingId} to mint vouchers for`);
  const requested = await postSigned(
    voucher,
    "/internal/v1/batches",
    requestBatchRequestSchema.parse({
      listingId: input.listingId,
      merchantId: input.merchantId,
      currency: facts.currency,
      faceValueMinor: facts.faceValueMinor,
      quantity: missing,
      partialRedemptionPolicy: facts.partialRedemptionPolicy,
      requestedBy: `demo-world-requester-${randomUUID()}`,
    }),
  );
  if (!requested.ok) throw new Error(`voucher batch request: ${requested.detail}`);
  const batch = batchSchema.parse(requested.body);
  const approved = await postSigned(
    voucher,
    "/internal/v1/batches/approve",
    approveBatchRequestSchema.parse({
      batchId: batch.batchId,
      approvedBy: `demo-world-approver-${randomUUID()}`,
    }),
  );
  if (!approved.ok) throw new Error(`voucher batch approve: ${approved.detail}`);
  // Stock is what can still be bought: the unsold vouchers.
  await pool.query(
    `UPDATE store.listings SET stock_remaining = $2, stock_total = GREATEST(stock_total, $2)
      WHERE id = $1`,
    [input.listingId, input.want],
  );
  return missing;
}
