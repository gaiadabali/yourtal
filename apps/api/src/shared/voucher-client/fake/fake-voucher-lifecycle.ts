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
  VoidVoucherRequest,
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
      // TASKS.md 4.8.c: `remaining_value_minor`/`expires_at` did not exist
      // before this (`20260929060000`) — a fresh voucher's remaining value
      // starts at its listing's own face value (nothing has redeemed any of
      // it yet) and its expiry is the listing's own, the same values the
      // real engine denormalizes onto `voucher.vouchers` at issuance.
      // `COALESCE`, not a JOIN: this table carries no FK to `store.listings`
      // by design (`voucher-client.contract.spec.ts`'s own comment — the
      // fake ignores everything about a listing except the id it is given),
      // and several tests `reserve()` a synthetic `listingId` that was never
      // seeded there at all. A join would silently insert nothing for
      // those; the 0/90-day fallback keeps this row inserted unconditionally.
      await db.execute(sql`
        INSERT INTO platform.voucher_fake_voucher
          (id, listing_id, saga_id, code, code_hash, remaining_value_minor, expires_at)
        VALUES (
          ${id}, ${request.listingId}, ${request.sagaId}, ${code}, ${sha256(code)},
          COALESCE((SELECT face_value_minor FROM store.listings WHERE id = ${request.listingId}), 0),
          COALESCE((SELECT expires_at FROM store.listings WHERE id = ${request.listingId}), now() + interval '90 days')
        )
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

/**
 * 4.7.c / K13 (requested by A): the owner disputes an uncaptured voucher.
 * `state` (reserved/activated/released) never grows a "voided" value — its
 * CHECK constraint only allows those three (`20260925190500`), a bug this
 * function's own OLD code tripped over (writing `state = 'voided'` would
 * throw a constraint violation, never actually reached by a passing test).
 * TASKS.md 4.8.c's own `void_reason` column is the real flag, same as the
 * live engine's `voucher.vouchers.void_reason` — always `admin` here, the
 * same reason `voidVoucher`'s real Go handler picks it (a staff/system-
 * mediated dispute resolution). Legal only while `void_reason IS NULL` and
 * the voucher is not yet fully redeemed (the fake's best approximation of
 * "active", since it has no state of its own for held/redeemed — captures
 * write to a separate table). Voiding twice replays rather than refusing,
 * matching the real engine's own idempotence.
 */
export function voidVoucher(
  db: AppDb,
  request: VoidVoucherRequest,
): ResultAsync<void, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<void, VoucherError>> => {
      const result = await db.execute<
        VoucherRow & { readonly void_reason: string | null; readonly remaining_value_minor: string }
      >(sql`
        SELECT id, listing_id, saga_id, owner_id, code, state, void_reason, remaining_value_minor
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
      if (row.void_reason !== null) return ok(undefined); // replay
      if (row.state !== "activated" || Number(row.remaining_value_minor) <= 0) {
        return err(
          ledgerError(
            "already_granted",
            `voucher ${request.voucherId} is not active — it cannot be disputed now`,
          ),
        );
      }
      await db.execute(
        sql`UPDATE platform.voucher_fake_voucher SET void_reason = 'admin' WHERE id = ${request.voucherId}`,
      );
      return ok(undefined);
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
