import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { ResultAsync, err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { ledgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import { toMinorUnits } from "@yourtal/contracts/money";
import type {
  Authorization,
  AuthorizeAsDeviceRequest,
  Capture,
  CaptureAsDeviceRequest,
} from "@yourtal/contracts/voucher-internal/redemption";
import type { VoucherError } from "../voucher-internal-client";
import type { AppDb } from "../../persistence/drizzle-client";

const AUTHORIZATION_TTL_MS = 5 * 60 * 1000;

type VoucherLookupRow = {
  readonly id: string;
  readonly code_hash: string;
};

/** Both operations assert the device's merchant matches the voucher's own — TASKS.md 1.2.b's own words. */
export function authorizeAsDevice(
  db: AppDb,
  request: AuthorizeAsDeviceRequest,
): ResultAsync<Authorization, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<Authorization, VoucherError>> => {
      const result = await db.execute<VoucherLookupRow>(sql`
        SELECT id, code_hash FROM platform.voucher_fake_voucher WHERE code = ${request.voucherCode}
      `);
      const row = result.rows[0];
      if (row === undefined) {
        return err(ledgerError("audience_blocked", "no voucher matches this code"));
      }
      const id = randomUUID();
      const amountMinor = request.amountMinor ?? toMinorUnits(0);
      await db.execute(sql`
        INSERT INTO platform.voucher_fake_authorization
          (id, voucher_id, merchant_id, device_id, amount_minor, currency, expires_at)
        VALUES (${id}, ${row.id}, ${request.merchantId}, ${request.deviceId}, ${amountMinor}, ${request.currency},
                ${new Date(Date.now() + AUTHORIZATION_TTL_MS).toISOString()})
      `);
      return ok({
        authorizationId: id,
        voucherId: row.id,
        amountMinor,
        currency: request.currency,
        expiresAt: new Date(Date.now() + AUTHORIZATION_TTL_MS).toISOString(),
      });
    })(),
  );
}

type AuthorizationRow = {
  readonly id: string;
  readonly voucher_id: string;
  readonly merchant_id: string;
  readonly amount_minor: string;
  readonly currency: string;
  readonly expires_at: string;
  readonly captured: boolean;
};

export function captureAsDevice(
  db: AppDb,
  request: CaptureAsDeviceRequest,
): ResultAsync<Capture, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<Capture, VoucherError>> => {
      const result = await db.execute<AuthorizationRow>(sql`
        SELECT id, voucher_id, merchant_id, amount_minor, currency, expires_at, captured
          FROM platform.voucher_fake_authorization WHERE id = ${request.authorizationId}
      `);
      const row = result.rows[0];
      if (row === undefined) throw new Error(`no authorization ${request.authorizationId} exists`);
      if (row.merchant_id !== request.merchantId) {
        return err(
          ledgerError(
            "audience_blocked",
            `authorization ${request.authorizationId} was not issued to merchant ${request.merchantId}`,
          ),
        );
      }
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return err(ledgerError("quote_expired", `authorization ${request.authorizationId} has expired`));
      }
      if (row.captured) {
        return err(
          ledgerError("already_granted", `authorization ${request.authorizationId} was already captured`),
        );
      }
      const captureId = randomUUID();
      await db.execute(sql`
        UPDATE platform.voucher_fake_authorization SET captured = true WHERE id = ${request.authorizationId}
      `);
      await db.execute(sql`
        INSERT INTO platform.voucher_fake_capture (id, voucher_id, merchant_id, amount_minor, currency)
        VALUES (${captureId}, ${row.voucher_id}, ${row.merchant_id}, ${row.amount_minor}, ${row.currency})
      `);
      return ok({
        captureId,
        voucherId: row.voucher_id,
        amountMinor: toMinorUnits(Number(row.amount_minor)),
        currency: row.currency as Capture["currency"],
        capturedAt: new Date().toISOString(),
      });
    })(),
  );
}
