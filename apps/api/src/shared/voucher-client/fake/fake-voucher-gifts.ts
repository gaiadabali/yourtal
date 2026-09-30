import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ResultAsync, err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type {
  GiftVoucherRequest,
  ListGiftsRequest,
  ListGiftsResult,
  ResolveGiftRequest,
  VoucherGift,
  VoucherGiftError,
  VoucherGiftErrorCode,
} from "@yourtal/contracts/voucher-internal/gifts";
import { toMinorUnits } from "@yourtal/contracts/money";
import type { AppDb } from "../../persistence/drizzle-client";

/**
 * 13.20's gifts for LEDGER_MODE=fake: the same rules as services/voucher's
 * issue/gift.go on the fake tables, minus the holdback (a fake has no event
 * chain to read it from). The old voucher gets `void_reason = 'transfer'`;
 * the new one waits `reserved` with no owner until accepted or returned.
 */
const ACCEPT_WINDOW = "7 days";
const SENT_PER_DAY = 3;

type Outcome<T> = Result<T, VoucherGiftError>;

function refuse<T>(code: VoucherGiftErrorCode, message: string): Outcome<T> {
  return err({ code, message });
}

type GiftRow = {
  readonly id: string;
  readonly source_voucher_id: string;
  readonly voucher_id: string;
  readonly sender_id: string;
  readonly recipient_id: string;
  readonly region: "AU" | "ID";
  readonly state: "pending" | "accepted" | "returned";
  readonly created_at: string;
  readonly expires_at: string;
  readonly resolved_at: string | null;
  readonly title: string;
  readonly merchant_name: string;
  readonly currency: "AUD" | "IDR";
  readonly face_value_minor: string;
  readonly voucher_expires_at: string;
};

const GIFT_SELECT = sql`
  SELECT g.id, g.source_voucher_id, g.voucher_id, g.sender_id, g.recipient_id, g.region, g.state,
         g.created_at, g.expires_at, g.resolved_at,
         COALESCE(l.title, '') AS title, COALESCE(l.merchant_name, '') AS merchant_name,
         COALESCE(l.currency, 'IDR') AS currency, v.remaining_value_minor AS face_value_minor,
         v.expires_at AS voucher_expires_at
    FROM platform.voucher_fake_gift g
    JOIN platform.voucher_fake_voucher v ON v.id = g.voucher_id
    LEFT JOIN store.listings l ON l.id = v.listing_id
`;

const iso = (value: string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

function toGift(row: GiftRow): VoucherGift {
  return {
    giftId: row.id,
    sourceVoucherId: row.source_voucher_id,
    voucherId: row.voucher_id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    region: row.region,
    state: row.state,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    resolvedAt: iso(row.resolved_at),
    title: row.title,
    merchantName: row.merchant_name,
    currency: row.currency,
    faceValueMinor: toMinorUnits(Number(row.face_value_minor)),
    voucherExpiresAt: new Date(row.voucher_expires_at).toISOString(),
  };
}

async function loadGift(db: Pick<AppDb, "execute">, giftId: string): Promise<GiftRow | undefined> {
  const result = await db.execute<GiftRow>(sql`${GIFT_SELECT} WHERE g.id = ${giftId}`);
  return result.rows[0];
}

type SourceRow = {
  readonly id: string;
  readonly listing_id: string;
  readonly state: string;
  readonly void_reason: string | null;
  readonly remaining_value_minor: string;
  readonly face_value_minor: string;
  readonly expired: boolean;
  readonly transferable: boolean;
  readonly region: string;
  readonly received: boolean;
};

export function gift(
  db: AppDb,
  request: GiftVoucherRequest,
): ResultAsync<VoucherGift, VoucherGiftError> {
  return ResultAsync.fromSafePromise(
    db.transaction(async (tx): Promise<Outcome<VoucherGift>> => {
      if (request.senderId === request.recipientId) return refuse("gift_to_self", "to self");
      const found = await tx.execute<SourceRow>(sql`
        SELECT v.id, v.listing_id, v.state, v.void_reason, v.remaining_value_minor,
               COALESCE(l.face_value_minor, v.remaining_value_minor) AS face_value_minor,
               v.expires_at <= now() AS expired, COALESCE(l.transferable, false) AS transferable,
               COALESCE(l.region, 'ID') AS region,
               EXISTS (SELECT 1 FROM platform.voucher_fake_gift g
                        WHERE g.voucher_id = v.id AND g.state = 'accepted') AS received
          FROM platform.voucher_fake_voucher v
          LEFT JOIN store.listings l ON l.id = v.listing_id
         WHERE v.id = ${request.voucherId} AND v.owner_id = ${request.senderId}
           FOR UPDATE OF v
      `);
      const source = found.rows[0];
      if (source === undefined) return refuse("not_found", "no such voucher");

      const earlier = await tx.execute<{ id: string; recipient_id: string }>(sql`
        SELECT id, recipient_id FROM platform.voucher_fake_gift WHERE source_voucher_id = ${source.id}
      `);
      const replay = earlier.rows[0];
      if (replay !== undefined && replay.recipient_id === request.recipientId) {
        const row = await loadGift(tx, replay.id);
        if (row !== undefined) return ok(toGift(row));
      }

      if (source.region !== request.recipientRegion) return refuse("region_mismatch", "region");
      if (
        source.state !== "activated" ||
        source.void_reason !== null ||
        source.expired ||
        source.remaining_value_minor !== source.face_value_minor
      ) {
        return refuse("not_unused", "only an unused voucher can be gifted");
      }
      if (!source.transferable) return refuse("not_transferable", "not transferable");
      if (source.received) return refuse("already_gifted", "one hop only");
      const sent = await tx.execute<{ n: string }>(sql`
        SELECT count(*) AS n FROM platform.voucher_fake_gift
         WHERE sender_id = ${request.senderId} AND created_at >= now() - interval '1 day'
      `);
      if (Number(sent.rows[0]?.n ?? 0) >= SENT_PER_DAY) return refuse("velocity_capped", "cap");

      const giftId = randomUUID();
      const voucherId = randomUUID();
      const code = randomUUID().replace(/-/g, "").toUpperCase().slice(0, 16);
      await tx.execute(sql`
        UPDATE platform.voucher_fake_voucher SET void_reason = 'transfer' WHERE id = ${source.id}
      `);
      await tx.execute(sql`
        INSERT INTO platform.voucher_fake_voucher
          (id, listing_id, saga_id, code, code_hash, remaining_value_minor, expires_at)
        SELECT ${voucherId}, listing_id, ${`gift:${giftId}`}, ${code},
               ${createHash("sha256").update(code).digest("hex")}, remaining_value_minor, expires_at
          FROM platform.voucher_fake_voucher WHERE id = ${source.id}
      `);
      await tx.execute(sql`
        INSERT INTO platform.voucher_fake_gift
          (id, source_voucher_id, voucher_id, sender_id, recipient_id, region, expires_at)
        VALUES (${giftId}, ${source.id}, ${voucherId}, ${request.senderId}, ${request.recipientId},
                ${request.recipientRegion}, now() + ${ACCEPT_WINDOW}::interval)
      `);
      const row = await loadGift(tx, giftId);
      if (row === undefined) throw new Error("the fake gift vanished");
      return ok(toGift(row));
    }),
  ).andThen((outcome) => outcome);
}

export function listGifts(
  db: AppDb,
  request: ListGiftsRequest,
): ResultAsync<ListGiftsResult, VoucherGiftError> {
  return new ResultAsync(
    (async (): Promise<Outcome<ListGiftsResult>> => {
      const result = await db.execute<GiftRow>(sql`
        ${GIFT_SELECT}
        WHERE g.sender_id = ${request.userId} OR g.recipient_id = ${request.userId}
        ORDER BY g.created_at DESC LIMIT ${request.limit ?? 50}
      `);
      return ok({ gifts: result.rows.map(toGift) });
    })(),
  );
}

function resolve(
  db: AppDb,
  request: ResolveGiftRequest,
  outcome: "accepted" | "returned",
): ResultAsync<VoucherGift, VoucherGiftError> {
  return ResultAsync.fromSafePromise(
    db.transaction(async (tx): Promise<Outcome<VoucherGift>> => {
      const row = await loadGift(tx, request.giftId);
      if (row?.recipient_id !== request.recipientId) return refuse("not_found", "no such gift");
      if (row.state !== "pending") return refuse("not_pending", "already resolved");
      if (outcome === "accepted" && new Date(row.expires_at) <= new Date()) {
        return refuse("window_closed", "too late");
      }
      const owner = outcome === "accepted" ? row.recipient_id : row.sender_id;
      await tx.execute(sql`
        UPDATE platform.voucher_fake_voucher SET state = 'activated', owner_id = ${owner}
         WHERE id = ${row.voucher_id}
      `);
      await tx.execute(sql`
        UPDATE platform.voucher_fake_gift SET state = ${outcome}, resolved_at = now()
         WHERE id = ${row.id}
      `);
      const after = await loadGift(tx, row.id);
      if (after === undefined) throw new Error("the fake gift vanished");
      return ok(toGift(after));
    }),
  ).andThen((outcome) => outcome);
}

export const acceptGift = (db: AppDb, request: ResolveGiftRequest) =>
  resolve(db, request, "accepted");
export const declineGift = (db: AppDb, request: ResolveGiftRequest) =>
  resolve(db, request, "returned");

/** Returns every pending fake gift past its window to its sender. */
export function sweepGifts(db: AppDb): ResultAsync<ListGiftsResult, VoucherGiftError> {
  return new ResultAsync(
    (async (): Promise<Outcome<ListGiftsResult>> => {
      const due = await db.execute<{ id: string; recipient_id: string }>(sql`
        SELECT id, recipient_id FROM platform.voucher_fake_gift
         WHERE state = 'pending' AND expires_at <= now() LIMIT 100
      `);
      const returned: VoucherGift[] = [];
      for (const row of due.rows) {
        const outcome = await resolve(
          db,
          { giftId: row.id, recipientId: row.recipient_id },
          "returned",
        );
        if (outcome.isOk()) returned.push(outcome.value);
      }
      return ok({ gifts: returned });
    })(),
  );
}
