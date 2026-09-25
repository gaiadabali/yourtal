import { sql } from "drizzle-orm";
import { ResultAsync, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type { Reservation } from "@yourtal/contracts/voucher-internal/lifecycle";
import type {
  GetVoucherRequest,
  ListForUserRequest,
  ListForUserResult,
} from "@yourtal/contracts/voucher-internal/wallet";
import type { VoucherError } from "../voucher-internal-client";
import type { AppDb } from "../../persistence/drizzle-client";

type VoucherRow = {
  readonly id: string;
  readonly listing_id: string;
  readonly saga_id: string;
  readonly state: string;
};

function toReservation(row: VoucherRow): Reservation {
  return { voucherId: row.id, listingId: row.listing_id, sagaId: row.saga_id, state: row.state as Reservation["state"] };
}

export function listForUser(
  db: AppDb,
  request: ListForUserRequest,
): ResultAsync<ListForUserResult, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<ListForUserResult, VoucherError>> => {
      const result = await db.execute<VoucherRow>(sql`
        SELECT id, listing_id, saga_id, state FROM platform.voucher_fake_voucher
         WHERE owner_id = ${request.userId}
           AND (${request.startingAfter ?? null}::uuid IS NULL OR id > ${request.startingAfter ?? null}::uuid)
         ORDER BY id
         LIMIT ${request.limit + 1}
      `);
      const hasMore = result.rows.length > request.limit;
      const page = hasMore ? result.rows.slice(0, request.limit) : result.rows;
      return ok({ vouchers: page.map(toReservation), hasMore });
    })(),
  );
}

export function get(db: AppDb, request: GetVoucherRequest): ResultAsync<Reservation, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<Reservation, VoucherError>> => {
      const result = await db.execute<VoucherRow>(sql`
        SELECT id, listing_id, saga_id, state FROM platform.voucher_fake_voucher
         WHERE id = ${request.voucherId} AND owner_id = ${request.ownerId}
      `);
      const row = result.rows[0];
      if (row === undefined) throw new Error(`no voucher ${request.voucherId} owned by ${request.ownerId} exists`);
      return ok(toReservation(row));
    })(),
  );
}
