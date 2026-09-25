import { randomUUID, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { ResultAsync, err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type {
  ActivateRequest,
  QrToken,
  QrTokenRequest,
  ReleaseRequest,
  Reservation,
  ReserveRequest,
  RevealRequest,
  RevealedCode,
  VerifyQrTokenRequest,
  VerifyQrTokenResult,
} from "@yourtal/contracts/voucher-internal/lifecycle";
import type { VoucherError } from "../voucher-internal-client";
import type { AppDb } from "../../persistence/drizzle-client";

const QR_TOKEN_TTL_MS = 5 * 60 * 1000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type VoucherRow = {
  readonly id: string;
  readonly listing_id: string;
  readonly saga_id: string;
  readonly owner_id: string | null;
  readonly code: string;
  readonly state: string;
};

function toReservation(row: VoucherRow): Reservation {
  return {
    voucherId: row.id,
    listingId: row.listing_id,
    sagaId: row.saga_id,
    state: row.state as Reservation["state"],
  };
}

export function reserve(
  db: AppDb,
  request: ReserveRequest,
): ResultAsync<Reservation, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<Reservation, VoucherError>> => {
      const existing = await db.execute<VoucherRow>(sql`
        SELECT id, listing_id, saga_id, owner_id, code, state
          FROM platform.voucher_fake_voucher WHERE saga_id = ${request.sagaId}
      `);
      const prior = existing.rows[0];
      if (prior !== undefined) {
        if (prior.listing_id !== request.listingId) {
          return err(
            ledgerError(
              "idempotency_conflict",
              `saga ${request.sagaId} was already used to reserve a different listing`,
            ),
          );
        }
        return ok(toReservation(prior));
      }
      const id = randomUUID();
      const code = randomUUID().replace(/-/g, "").toUpperCase().slice(0, 16);
      await db.execute(sql`
        INSERT INTO platform.voucher_fake_voucher (id, listing_id, saga_id, code, code_hash)
        VALUES (${id}, ${request.listingId}, ${request.sagaId}, ${code}, ${sha256(code)})
      `);
      return ok({
        voucherId: id,
        listingId: request.listingId,
        sagaId: request.sagaId,
        state: "reserved",
      });
    })(),
  );
}

async function loadVoucherBySaga(db: AppDb, sagaId: string): Promise<VoucherRow> {
  const result = await db.execute<VoucherRow>(sql`
    SELECT id, listing_id, saga_id, owner_id, code, state
      FROM platform.voucher_fake_voucher WHERE saga_id = ${sagaId}
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no reservation for saga ${sagaId} exists`);
  return row;
}

export function release(db: AppDb, request: ReleaseRequest): ResultAsync<void, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<void, VoucherError>> => {
      const row = await loadVoucherBySaga(db, request.sagaId);
      if (row.state === "activated") {
        throw new Error(
          `voucher for saga ${request.sagaId} is already activated and cannot be released`,
        );
      }
      await db.execute(
        sql`UPDATE platform.voucher_fake_voucher SET state = 'released' WHERE saga_id = ${request.sagaId}`,
      );
      return ok(undefined);
    })(),
  );
}

export function activate(
  db: AppDb,
  request: ActivateRequest,
): ResultAsync<Reservation, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<Reservation, VoucherError>> => {
      const row = await loadVoucherBySaga(db, request.sagaId);
      if (row.state === "activated") return ok(toReservation(row));
      if (row.state === "released") {
        throw new Error(`voucher for saga ${request.sagaId} was released and cannot be activated`);
      }
      await db.execute(sql`
        UPDATE platform.voucher_fake_voucher SET state = 'activated', owner_id = ${request.ownerId}
         WHERE saga_id = ${request.sagaId}
      `);
      return ok({ ...toReservation(row), state: "activated" });
    })(),
  );
}

export function reveal(db: AppDb, request: RevealRequest): ResultAsync<RevealedCode, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<RevealedCode, VoucherError>> => {
      const result = await db.execute<VoucherRow>(sql`
        SELECT id, listing_id, saga_id, owner_id, code, state
          FROM platform.voucher_fake_voucher WHERE id = ${request.voucherId}
      `);
      const row = result.rows[0];
      if (row === undefined) throw new Error(`no voucher ${request.voucherId} exists`);
      if (row.owner_id !== request.ownerId) {
        return err(
          ledgerError(
            "audience_blocked",
            `voucher ${request.voucherId} does not belong to this caller`,
          ),
        );
      }
      return ok({ voucherId: row.id, code: row.code });
    })(),
  );
}

export function qrToken(db: AppDb, request: QrTokenRequest): ResultAsync<QrToken, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<QrToken, VoucherError>> => {
      const result = await db.execute<VoucherRow>(sql`
        SELECT id, listing_id, saga_id, owner_id, code, state
          FROM platform.voucher_fake_voucher WHERE id = ${request.voucherId}
      `);
      const row = result.rows[0];
      if (row === undefined) throw new Error(`no voucher ${request.voucherId} exists`);
      if (row.owner_id !== request.ownerId) {
        return err(
          ledgerError(
            "audience_blocked",
            `voucher ${request.voucherId} does not belong to this caller`,
          ),
        );
      }
      const token = `${row.id}.${randomUUID()}`;
      return ok({
        token,
        voucherId: row.id,
        expiresAt: new Date(Date.now() + QR_TOKEN_TTL_MS).toISOString(),
      });
    })(),
  );
}

/** A stateless token in this fake: `voucherId.nonce`, valid for `QR_TOKEN_TTL_MS` from mint — no store needed to verify its SHAPE, only that the named voucher still exists. */
export function verifyQrToken(
  db: AppDb,
  request: VerifyQrTokenRequest,
): ResultAsync<VerifyQrTokenResult, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<VerifyQrTokenResult, VoucherError>> => {
      const [voucherId] = request.token.split(".");
      // A malformed token (not even shaped like a uuid) is invalid, not a
      // database error — checked before the query rather than caught after.
      const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
      if (voucherId === undefined || !UUID_SHAPE.test(voucherId)) {
        return ok({ valid: false, voucherId: null });
      }
      const result = await db.execute<{ id: string }>(sql`
        SELECT id FROM platform.voucher_fake_voucher WHERE id = ${voucherId}
      `);
      const row = result.rows[0];
      if (row === undefined) return ok({ valid: false, voucherId: null });
      return ok({ valid: true, voucherId: row.id });
    })(),
  );
}
