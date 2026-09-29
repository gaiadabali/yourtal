import { sql } from "drizzle-orm";
import { ResultAsync, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type {
  GetVoucherRequest,
  ListForUserRequest,
  ListForUserResult,
  WalletVoucherRow,
} from "@yourtal/contracts/voucher-internal/wallet";
import { toMinorUnits } from "@yourtal/contracts/money";
import type { VoucherError } from "../voucher-internal-client";
import type { AppDb } from "../../persistence/drizzle-client";

/**
 * TASKS.md 4.8.c: the fake engine never modelled a voucher's real lifecycle
 * (active/held/redeemed/expired/voided) or partial redemption -- see
 * `20260929060000_voucher_fake_wallet_widen.sql`'s own header for why. This
 * row is that state DERIVED at read time from three tables instead of
 * stored in one column, mirroring what `services/voucher`'s real engine
 * would have computed had the capture happened there: `void_reason` set is
 * voided; `remaining_value_minor <= 0` is redeemed (the same "balance hits
 * zero" rule `settle.go`'s `afterCapture` applies for real, `docs/09`
 * §8.2); an unexpired, uncaptured authorization is held; `expires_at` past
 * is expired; otherwise active.
 */
type VoucherRow = {
  readonly id: string;
  readonly listing_id: string;
  readonly saga_id: string;
  readonly state: string;
  readonly owner_id: string | null;
  readonly remaining_value_minor: string;
  readonly expires_at: string;
  readonly void_reason: string | null;
  readonly merchant_name: string;
  readonly title: string;
  readonly currency: string;
  readonly face_value_minor: string;
  readonly partial_redemption_policy: string;
  readonly location_name: string | null;
  readonly location_address: string | null;
  readonly location_district: string | null;
  readonly held: boolean;
};

// LEFT JOIN, not JOIN: `voucher_fake_voucher` carries no FK to
// `store.listings` (this table's own header comment on that migration, and
// `voucher-client.contract.spec.ts`'s own `seedListing` doc comment) --
// several tests `reserve()` a synthetic `listingId` with no listing row at
// all. `COALESCE` fills the display fields with an obviously-fake
// placeholder rather than dropping the voucher from its owner's own wallet.
const VOUCHER_ROW_SELECT = sql`
  SELECT v.id, v.listing_id, v.saga_id, v.state, v.owner_id,
         v.remaining_value_minor, v.expires_at, v.void_reason,
         COALESCE(l.merchant_name, '') AS merchant_name,
         COALESCE(l.title, '') AS title,
         COALESCE(l.currency, 'IDR') AS currency,
         COALESCE(l.face_value_minor, v.remaining_value_minor) AS face_value_minor,
         COALESCE(l.partial_redemption_policy, 'single_use_forfeit') AS partial_redemption_policy,
         loc.name AS location_name, loc.address AS location_address, loc.district AS location_district,
         EXISTS (
           SELECT 1 FROM platform.voucher_fake_authorization a
            WHERE a.voucher_id = v.id AND a.captured = false AND a.expires_at > now()
         ) AS held
    FROM platform.voucher_fake_voucher v
    LEFT JOIN store.listings l ON l.id = v.listing_id
    LEFT JOIN store.listing_location ll ON ll.listing_id = v.listing_id
    LEFT JOIN store.merchant_location loc ON loc.id = ll.location_id
`;

function toWalletVoucherRow(row: VoucherRow): WalletVoucherRow {
  const remainingValueMinor = toMinorUnits(Number(row.remaining_value_minor));
  const lifecycleState: WalletVoucherRow["lifecycleState"] =
    row.void_reason !== null
      ? "voided"
      : remainingValueMinor <= 0
        ? "redeemed"
        : new Date(row.expires_at).getTime() <= Date.now()
          ? "expired"
          : row.held
            ? "held"
            : "active";
  return {
    voucherId: row.id,
    listingId: row.listing_id,
    sagaId: row.saga_id,
    state: row.state as WalletVoucherRow["state"],
    lifecycleState,
    voidReason: row.void_reason as WalletVoucherRow["voidReason"],
    merchantName: row.merchant_name,
    title: row.title,
    currency: row.currency as WalletVoucherRow["currency"],
    faceValueMinor: toMinorUnits(Number(row.face_value_minor)),
    remainingValueMinor,
    partialRedemptionPolicy:
      row.partial_redemption_policy as WalletVoucherRow["partialRedemptionPolicy"],
    expiresAt: new Date(row.expires_at).toISOString(),
    location:
      row.location_name === null || row.location_address === null || row.location_district === null
        ? null
        : {
            name: row.location_name,
            address: row.location_address,
            district: row.location_district,
          },
  };
}

export function listForUser(
  db: AppDb,
  request: ListForUserRequest,
): ResultAsync<ListForUserResult, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<ListForUserResult, VoucherError>> => {
      const result = await db.execute<VoucherRow>(sql`
        ${VOUCHER_ROW_SELECT}
         WHERE v.owner_id = ${request.userId}
           AND (${request.startingAfter ?? null}::uuid IS NULL OR v.id > ${request.startingAfter ?? null}::uuid)
         ORDER BY v.id
         LIMIT ${request.limit + 1}
      `);
      const hasMore = result.rows.length > request.limit;
      const page = hasMore ? result.rows.slice(0, request.limit) : result.rows;
      return ok({ vouchers: page.map(toWalletVoucherRow), hasMore });
    })(),
  );
}

export function get(
  db: AppDb,
  request: GetVoucherRequest,
): ResultAsync<WalletVoucherRow, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<WalletVoucherRow, VoucherError>> => {
      const result = await db.execute<VoucherRow>(sql`
        ${VOUCHER_ROW_SELECT}
         WHERE v.id = ${request.voucherId} AND v.owner_id = ${request.ownerId}
      `);
      const row = result.rows[0];
      if (row === undefined)
        throw new Error(`no voucher ${request.voucherId} owned by ${request.ownerId} exists`);
      return ok(toWalletVoucherRow(row));
    })(),
  );
}
