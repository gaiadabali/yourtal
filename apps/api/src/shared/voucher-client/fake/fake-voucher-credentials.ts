import { randomUUID, randomBytes, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { ResultAsync, ok } from "neverthrow";
import type { Result } from "neverthrow";
import type {
  IssueMerchantCredentialRequest,
  MerchantCredential,
  RevokeCredentialRequest,
  RotateCredentialRequest,
} from "@yourtal/contracts/voucher-internal/credentials";
import type { VoucherError } from "../voucher-internal-client";
import type { AppDb } from "../../persistence/drizzle-client";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Only ever returned to the caller once, at issuance or rotation — never persisted in the clear (docs/15 rule 7). */
function newSecret(): string {
  return randomBytes(32).toString("hex");
}

export function issueMerchantCredential(
  db: AppDb,
  request: IssueMerchantCredentialRequest,
): ResultAsync<MerchantCredential, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<MerchantCredential, VoucherError>> => {
      const id = randomUUID();
      const secret = newSecret();
      await db.execute(sql`
        INSERT INTO platform.voucher_fake_credential (id, merchant_id, device_id, secret_hash)
        VALUES (${id}, ${request.merchantId}, ${request.deviceId}, ${sha256(secret)})
      `);
      return ok({
        credentialId: id,
        merchantId: request.merchantId,
        deviceId: request.deviceId,
        secret,
        state: "active",
        issuedAt: new Date().toISOString(),
      });
    })(),
  );
}

type CredentialRow = {
  readonly id: string;
  readonly merchant_id: string;
  readonly device_id: string;
  readonly state: string;
  readonly issued_at: string;
};

async function loadCredential(db: AppDb, credentialId: string): Promise<CredentialRow> {
  const result = await db.execute<CredentialRow>(sql`
    SELECT id, merchant_id, device_id, state, issued_at
      FROM platform.voucher_fake_credential WHERE id = ${credentialId}
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no credential ${credentialId} exists`);
  return row;
}

export function rotate(
  db: AppDb,
  request: RotateCredentialRequest,
): ResultAsync<MerchantCredential, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<MerchantCredential, VoucherError>> => {
      const row = await loadCredential(db, request.credentialId);
      const secret = newSecret();
      await db.execute(
        sql`UPDATE platform.voucher_fake_credential SET secret_hash = ${sha256(secret)} WHERE id = ${request.credentialId}`,
      );
      return ok({
        credentialId: row.id,
        merchantId: row.merchant_id,
        deviceId: row.device_id,
        secret,
        state: row.state as MerchantCredential["state"],
        issuedAt: new Date(row.issued_at).toISOString(),
      });
    })(),
  );
}

export function revoke(db: AppDb, request: RevokeCredentialRequest): ResultAsync<void, VoucherError> {
  return new ResultAsync(
    (async (): Promise<Result<void, VoucherError>> => {
      await db.execute(
        sql`UPDATE platform.voucher_fake_credential SET state = 'revoked' WHERE id = ${request.credentialId}`,
      );
      return ok(undefined);
    })(),
  );
}
