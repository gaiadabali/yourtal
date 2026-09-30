import { sql } from "drizzle-orm";
import { ResultAsync, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { toMinorUnits } from "@yourtal/contracts/money";
import type {
  MerchantCaptureStats,
  MerchantCaptureStatsRequest,
  MerchantVoucherStatus,
  MerchantVoucherStatusRequest,
} from "@yourtal/contracts/voucher-internal/stats";
import type { VoucherError } from "../voucher-internal-client";
import type { AppDb } from "../../persistence/drizzle-client";

export function merchantCaptureStats(
  db: AppDb,
  request: MerchantCaptureStatsRequest,
): ResultAsync<MerchantCaptureStats, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<MerchantCaptureStats, VoucherError>> => {
      const result = await db.execute<{
        currency: string | null;
        count: string;
        total: string;
      }>(sql`
        SELECT currency, COUNT(*) AS count, COALESCE(SUM(amount_minor), 0) AS total
          FROM platform.voucher_fake_capture
         WHERE merchant_id = ${request.merchantId}
           AND captured_at::date BETWEEN ${request.from}::date AND ${request.to}::date
         GROUP BY currency
      `);
      const row = result.rows[0];
      return ok({
        merchantId: request.merchantId,
        currency: (row?.currency ?? "IDR") as MerchantCaptureStats["currency"],
        captureCount: Number(row?.count ?? 0),
        capturedMinor: toMinorUnits(Number(row?.total ?? 0)),
      });
    })(),
  );
}

/** 13.10 on the fake tables: status derived the way fake-voucher-wallet.ts derives it. */
export function merchantVoucherStatus(
  db: AppDb,
  request: MerchantVoucherStatusRequest,
): ResultAsync<MerchantVoucherStatus, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<MerchantVoucherStatus, VoucherError>> => {
      const result = await db.execute<{ status: string; count: string; total: string }>(sql`
        SELECT status, COUNT(*) AS count, COALESCE(SUM(face_value_minor), 0) AS total FROM (
          SELECT l.face_value_minor,
                 CASE WHEN v.void_reason = 'transfer' THEN 'transferred'
                      WHEN v.remaining_value_minor <= 0 THEN 'redeemed'
                      WHEN v.expires_at <= now() THEN 'expired'
                      ELSE 'active' END AS status
            FROM platform.voucher_fake_voucher v
            JOIN store.listings l ON l.id = v.listing_id
           WHERE l.merchant_id = ${request.merchantId} AND l.region = ${request.region}
             AND v.owner_id IS NOT NULL
             AND (v.void_reason IS NULL OR v.void_reason = 'transfer')
        ) s GROUP BY status ORDER BY status
      `);
      return ok({
        merchantId: request.merchantId,
        region: request.region,
        currency: request.region === "AU" ? "AUD" : "IDR",
        rows: result.rows.map((row) => ({
          status: row.status as MerchantVoucherStatus["rows"][number]["status"],
          count: Number(row.count),
          faceValueMinor: toMinorUnits(Number(row.total)),
        })),
      });
    })(),
  );
}
