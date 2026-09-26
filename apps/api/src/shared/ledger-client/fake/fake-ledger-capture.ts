import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ResultAsync, err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import { REGION_CONFIG } from "@yourtal/contracts/region";
import { toMinorUnits } from "@yourtal/contracts/money";
import type {
  CapturePosting,
  CaptureVoucherRequest,
} from "@yourtal/contracts/ledger-internal/capture";
import type { AppDb } from "../../persistence/drizzle-client";

type CaptureRow = {
  readonly capture_id: string;
  readonly region: string;
  readonly merchant_id: string;
  readonly amount_minor: string;
  readonly currency: string;
  readonly transfer_id: string;
  readonly posted_at: string;
};

function toPosting(row: CaptureRow): CapturePosting {
  return {
    captureId: row.capture_id,
    region: row.region as CapturePosting["region"],
    merchantId: row.merchant_id,
    amountMinor: toMinorUnits(Number(row.amount_minor)),
    currency: row.currency as CapturePosting["currency"],
    transferId: row.transfer_id,
    postedAt: new Date(row.posted_at).toISOString(),
  };
}

/**
 * 4.6.f.2: the fake of services/ledger/internal/capture, keyed on captureId.
 * A replay returns the original posting; the same id with other terms is
 * `idempotency_conflict`; a wrong currency, or a merchant already paid in the
 * other region, is `region_mismatch`.
 */
export function captureVoucher(
  db: AppDb,
  request: CaptureVoucherRequest,
): ResultAsync<CapturePosting, LedgerError> {
  return new ResultAsync(
    (async (): Promise<Result<CapturePosting, LedgerError>> => {
      if (REGION_CONFIG[request.region].currency !== request.currency) {
        return err(
          ledgerError(
            "region_mismatch",
            `region ${request.region} does not use currency ${request.currency}`,
          ),
        );
      }
      const otherRegion = await db.execute(sql`
        SELECT 1 FROM platform.ledger_fake_capture
         WHERE merchant_id = ${request.merchantId} AND region <> ${request.region} LIMIT 1
      `);
      if (otherRegion.rows.length > 0) {
        return err(
          ledgerError(
            "region_mismatch",
            `merchant ${request.merchantId} is paid in another region`,
          ),
        );
      }

      // Insert-or-nothing, then read back: two racing retries agree on one row.
      await db.execute(sql`
        INSERT INTO platform.ledger_fake_capture
          (capture_id, region, merchant_id, amount_minor, currency, transfer_id)
        VALUES (${request.captureId}, ${request.region}, ${request.merchantId},
                ${request.amountMinor}, ${request.currency}, ${`xfer_${randomUUID()}`})
        ON CONFLICT (capture_id) DO NOTHING
      `);
      const stored = await db.execute<CaptureRow>(sql`
        SELECT capture_id, region, merchant_id, amount_minor, currency, transfer_id, posted_at
          FROM platform.ledger_fake_capture WHERE capture_id = ${request.captureId}
      `);
      const row = stored.rows[0];
      if (row === undefined) throw new Error("ledger_fake_capture lost a row it just wrote");
      if (
        row.region !== request.region ||
        row.merchant_id !== request.merchantId ||
        Number(row.amount_minor) !== request.amountMinor ||
        row.currency !== request.currency
      ) {
        return err(
          ledgerError(
            "idempotency_conflict",
            `captureId ${request.captureId} was already used for a different capture`,
          ),
        );
      }
      return ok(toPosting(row));
    })(),
  );
}
