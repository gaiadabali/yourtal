import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ResultAsync, err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type {
  VoucherEscrow,
  VoucherEscrowHoldRequest,
  VoucherEscrowReleaseRequest,
} from "@yourtal/contracts/voucher-internal/escrow";
import type {
  VoucherGiftError,
  VoucherGiftErrorCode,
} from "@yourtal/contracts/voucher-internal/gifts";
import { toMinorUnits } from "@yourtal/contracts/money";
import type { AppDb } from "../../persistence/drizzle-client";

/**
 * 13.22's escrow for LEDGER_MODE=fake: the same rules as services/voucher's
 * issue/escrow.go on the fake tables. The seller's voucher gets
 * `void_reason = 'transfer'`; the escrowed one waits `reserved`, no owner.
 */
type Outcome<T> = Result<T, VoucherGiftError>;

function refuse<T>(code: VoucherGiftErrorCode, message: string): Outcome<T> {
  return err({ code, message });
}

type EscrowRow = {
  readonly auction_id: string;
  readonly source_voucher_id: string;
  readonly voucher_id: string;
  readonly seller_id: string;
  readonly region: "AU" | "ID";
  readonly state: "held" | "released";
  readonly released_to: string | null;
  readonly listing_id: string;
  readonly title: string;
  readonly merchant_name: string;
  readonly currency: "AUD" | "IDR";
  readonly face_value_minor: string;
  readonly voucher_expires_at: string;
};

async function load(db: Pick<AppDb, "execute">, auctionId: string): Promise<VoucherEscrow | null> {
  const result = await db.execute<EscrowRow>(sql`
    SELECT e.auction_id, e.source_voucher_id, e.voucher_id, e.seller_id, e.region, e.state,
           e.released_to, v.listing_id, COALESCE(l.title, '') AS title,
           COALESCE(l.merchant_name, '') AS merchant_name, COALESCE(l.currency, 'IDR') AS currency,
           v.remaining_value_minor AS face_value_minor, v.expires_at AS voucher_expires_at
      FROM platform.voucher_fake_escrow e
      JOIN platform.voucher_fake_voucher v ON v.id = e.voucher_id
      LEFT JOIN store.listings l ON l.id = v.listing_id
     WHERE e.auction_id = ${auctionId}
  `);
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    auctionId: row.auction_id,
    sourceVoucherId: row.source_voucher_id,
    voucherId: row.voucher_id,
    sellerId: row.seller_id,
    region: row.region,
    state: row.state,
    releasedTo: row.released_to,
    listingId: row.listing_id,
    title: row.title,
    merchantName: row.merchant_name,
    currency: row.currency,
    faceValueMinor: toMinorUnits(Number(row.face_value_minor)),
    voucherExpiresAt: new Date(row.voucher_expires_at).toISOString(),
  };
}

type SourceRow = {
  readonly id: string;
  readonly state: string;
  readonly void_reason: string | null;
  readonly remaining_value_minor: string;
  readonly face_value_minor: string;
  readonly expired: boolean;
  readonly transferable: boolean;
  readonly region: string;
  readonly received: boolean;
};

export function escrowHold(
  db: AppDb,
  request: VoucherEscrowHoldRequest,
): ResultAsync<VoucherEscrow, VoucherGiftError> {
  return ResultAsync.fromSafePromise(
    db.transaction(async (tx): Promise<Outcome<VoucherEscrow>> => {
      const existing = await load(tx, request.auctionId);
      if (existing !== null) {
        return existing.sourceVoucherId === request.voucherId
          ? ok(existing)
          : refuse("not_unused", "this auction escrows another voucher");
      }
      const found = await tx.execute<SourceRow>(sql`
        SELECT v.id, v.state, v.void_reason, v.remaining_value_minor,
               COALESCE(l.face_value_minor, v.remaining_value_minor) AS face_value_minor,
               v.expires_at <= now() AS expired, COALESCE(l.transferable, false) AS transferable,
               COALESCE(l.region, 'ID') AS region,
               (EXISTS (SELECT 1 FROM platform.voucher_fake_gift g
                         WHERE g.voucher_id = v.id AND g.state = 'accepted')
                OR EXISTS (SELECT 1 FROM platform.voucher_fake_escrow e
                         WHERE e.voucher_id = v.id AND e.state = 'released'
                           AND e.released_to <> e.seller_id)) AS received
          FROM platform.voucher_fake_voucher v
          LEFT JOIN store.listings l ON l.id = v.listing_id
         WHERE v.id = ${request.voucherId} AND v.owner_id = ${request.sellerId}
           FOR UPDATE OF v
      `);
      const source = found.rows[0];
      if (source === undefined) return refuse("not_found", "no such voucher");
      if (source.region !== request.region) return refuse("region_mismatch", "region");
      if (
        source.state !== "activated" ||
        source.void_reason !== null ||
        source.expired ||
        source.remaining_value_minor !== source.face_value_minor
      ) {
        return refuse("not_unused", "only an unused voucher can be listed");
      }
      if (!source.transferable) return refuse("not_transferable", "not transferable");
      if (source.received) return refuse("already_gifted", "one hop only");

      const voucherId = randomUUID();
      const code = randomUUID().replace(/-/g, "").toUpperCase().slice(0, 16);
      await tx.execute(
        sql`UPDATE platform.voucher_fake_voucher SET void_reason = 'transfer' WHERE id = ${source.id}`,
      );
      await tx.execute(sql`
        INSERT INTO platform.voucher_fake_voucher
          (id, listing_id, saga_id, code, code_hash, remaining_value_minor, expires_at)
        SELECT ${voucherId}, listing_id, ${`auction:${request.auctionId}`}, ${code},
               ${createHash("sha256").update(code).digest("hex")}, remaining_value_minor, expires_at
          FROM platform.voucher_fake_voucher WHERE id = ${source.id}
      `);
      await tx.execute(sql`
        INSERT INTO platform.voucher_fake_escrow (auction_id, source_voucher_id, voucher_id, seller_id, region)
        VALUES (${request.auctionId}, ${source.id}, ${voucherId}, ${request.sellerId}, ${request.region})
      `);
      const held = await load(tx, request.auctionId);
      if (held === null) throw new Error("the fake escrow vanished");
      return ok(held);
    }),
  ).andThen((outcome) => outcome);
}

export function escrowRelease(
  db: AppDb,
  request: VoucherEscrowReleaseRequest,
): ResultAsync<VoucherEscrow, VoucherGiftError> {
  return ResultAsync.fromSafePromise(
    db.transaction(async (tx): Promise<Outcome<VoucherEscrow>> => {
      const escrow = await load(tx, request.auctionId);
      if (escrow === null) return refuse("not_found", "no such escrow");
      if (escrow.state === "released") {
        return escrow.releasedTo === request.ownerId
          ? ok(escrow)
          : refuse("not_pending", "already handed over");
      }
      await tx.execute(sql`
        UPDATE platform.voucher_fake_voucher SET state = 'activated', owner_id = ${request.ownerId}
         WHERE id = ${escrow.voucherId}
      `);
      await tx.execute(sql`
        UPDATE platform.voucher_fake_escrow
           SET state = 'released', released_to = ${request.ownerId}, released_at = now()
         WHERE auction_id = ${request.auctionId}
      `);
      const released = await load(tx, request.auctionId);
      if (released === null) throw new Error("the fake escrow vanished");
      return ok(released);
    }),
  ).andThen((outcome) => outcome);
}
