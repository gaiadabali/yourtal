import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ResultAsync, err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import { toMinorUnits } from "@yourtal/contracts/money";
import type {
  ApproveBatchRequest,
  Batch,
  RequestBatchRequest,
} from "@yourtal/contracts/voucher-internal/batches";
import type { VoucherError } from "../voucher-internal-client";
import type { AppDb } from "../../persistence/drizzle-client";

type BatchRow = {
  readonly id: string;
  readonly listing_id: string;
  readonly merchant_id: string;
  readonly currency: string;
  readonly face_value_minor: string;
  readonly quantity: number;
  readonly requested_by: string;
  readonly approved_by: string | null;
  readonly state: string;
};

function toBatch(row: BatchRow): Batch {
  return {
    batchId: row.id,
    listingId: row.listing_id,
    merchantId: row.merchant_id,
    currency: row.currency as Batch["currency"],
    faceValueMinor: toMinorUnits(Number(row.face_value_minor)),
    quantity: row.quantity,
    requestedBy: row.requested_by,
    approvedBy: row.approved_by,
    state: row.state as Batch["state"],
  };
}

export function requestBatch(
  db: AppDb,
  request: RequestBatchRequest,
): ResultAsync<Batch, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<Batch, VoucherError>> => {
      const id = randomUUID();
      await db.execute(sql`
        INSERT INTO platform.voucher_fake_batch
          (id, listing_id, merchant_id, currency, face_value_minor, quantity, requested_by)
        VALUES (${id}, ${request.listingId}, ${request.merchantId}, ${request.currency},
                ${request.faceValueMinor}, ${request.quantity}, ${request.requestedBy})
      `);
      return ok({
        batchId: id,
        listingId: request.listingId,
        merchantId: request.merchantId,
        currency: request.currency,
        faceValueMinor: request.faceValueMinor,
        quantity: request.quantity,
        requestedBy: request.requestedBy,
        approvedBy: null,
        state: "pending",
      });
    })(),
  );
}

/** Two-person approval (YT-0141): `approvedBy` must differ from `requestedBy`, enforced by a CHECK too. */
export function approveBatch(
  db: AppDb,
  request: ApproveBatchRequest,
): ResultAsync<Batch, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<Batch, VoucherError>> => {
      const rows = await db.execute<BatchRow>(sql`
        SELECT id, listing_id, merchant_id, currency, face_value_minor, quantity, requested_by, approved_by, state
          FROM platform.voucher_fake_batch WHERE id = ${request.batchId}
      `);
      const row = rows.rows[0];
      if (row === undefined) throw new Error(`no batch ${request.batchId} exists`);
      if (row.requested_by === request.approvedBy) {
        return err(
          ledgerError("already_granted", "a batch cannot be approved by its own requester"),
        );
      }
      if (row.state === "approved") return ok(toBatch(row));
      await db.execute(sql`
        UPDATE platform.voucher_fake_batch SET approved_by = ${request.approvedBy}, state = 'approved'
         WHERE id = ${request.batchId}
      `);
      return ok(toBatch({ ...row, approved_by: request.approvedBy, state: "approved" }));
    })(),
  );
}
