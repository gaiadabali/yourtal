import { sql } from "drizzle-orm";
import { ResultAsync, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { toMinorUnits } from "@yourtal/contracts/money";
import type {
  MerchantCaptureStats,
  MerchantCaptureStatsRequest,
} from "@yourtal/contracts/voucher-internal/stats";
import type { VoucherError } from "../voucher-internal-client";
import type { AppDb } from "../../persistence/drizzle-client";

export function merchantCaptureStats(
  db: AppDb,
  request: MerchantCaptureStatsRequest,
): ResultAsync<MerchantCaptureStats, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<MerchantCaptureStats, VoucherError>> => {
      const result = await db.execute<{ currency: string | null; count: string; total: string }>(sql`
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
