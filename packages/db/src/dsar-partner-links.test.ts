import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { executeDeletion } from "@yourtal/consent/dsar-orchestrator";
import { APP_URL, OWNER_URL } from "./database-urls";
import { TOMBSTONE, postgresHandlers } from "./dsar-handlers";

/**
 * The `partner_links` DSAR domain (14.3 follow-up) against real Postgres.
 * Fixtures are written as the OWNER, the handler and assertions run as the
 * app, the same split `dsar-handlers.test.ts` explains.
 */
const { Pool } = pg;
let pool: pg.Pool;
let owner: pg.Pool;
const partnerId = `test-partner-${randomUUID()}`;
const subject = randomUUID();
const other = randomUUID();
const receipt = { subject: `rcpt-${randomUUID()}`, other: `rcpt-${randomUUID()}` };
const codes = { unspent: code(), spent: code(), other: code() };
const ids = { active: randomUUID(), oldRevoked: randomUUID(), other: randomUUID() };
const OLD_REVOCATION = "2026-01-01T00:00:00.000Z";

function code(): string {
  return randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
}

beforeAll(async () => {
  pool = new Pool({ connectionString: APP_URL, max: 2 });
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
  await owner.query(
    `INSERT INTO platform.partner_credential (partner_id, secret_env_var) VALUES ($1, 'UNUSED')`,
    [partnerId],
  );
  await owner.query(
    `INSERT INTO platform.partner_link (id, partner_id, user_id, region, revoked_at) VALUES
       ($1, $4, $5, 'AU', NULL), ($2, $4, $5, 'AU', $7), ($3, $4, $6, 'ID', NULL)`,
    [ids.active, ids.oldRevoked, ids.other, partnerId, subject, other, OLD_REVOCATION],
  );
  await owner.query(
    `INSERT INTO platform.partner_receipt (partner_id, receipt_hash, user_id, external_ref) VALUES
       ($1, $2, $4, $2), ($1, $3, $5, $3)`,
    [partnerId, receipt.subject, receipt.other, subject, other],
  );
  const expires = new Date(Date.now() + 10 * 60 * 1000);
  await owner.query(
    `INSERT INTO me.link_code (code, user_id, region, expires_at, consumed_at) VALUES
       ($1, $4, 'AU', $6, NULL), ($2, $4, 'AU', $6, now()), ($3, $5, 'ID', $6, NULL)`,
    [codes.unspent, codes.spent, codes.other, subject, other, expires],
  );
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

async function linkRevokedAt(id: string): Promise<string | null> {
  const { rows } = await pool.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM platform.partner_link WHERE id = $1`,
    [id],
  );
  return rows[0]?.revoked_at?.toISOString() ?? null;
}

async function receiptOwner(hash: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM platform.partner_receipt WHERE partner_id = $1 AND receipt_hash = $2`,
    [partnerId, hash],
  );
  return rows[0]?.user_id;
}

async function codesFor(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ code: string }>(
    `SELECT code FROM me.link_code WHERE user_id = $1 ORDER BY code`,
    [userId],
  );
  return rows.map((row) => row.code);
}

describe("the partner_links domain on account deletion", () => {
  it("cannot be done with the app's own grants: only the function can", async () => {
    await expect(
      pool.query(`DELETE FROM me.link_code WHERE user_id = $1`, [subject]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      pool.query(`UPDATE platform.partner_receipt SET user_id = $1 WHERE user_id = $2`, [
        TOMBSTONE,
        subject,
      ]),
    ).rejects.toThrow(/permission denied/);
  });

  it("revokes active links, detaches receipts, deletes codes, and touches no one else", async () => {
    const handler = postgresHandlers(pool)["partner_links"];
    if (handler === undefined) throw new Error("partner_links has no handler");

    // 1 link revoked + 1 receipt detached + 2 codes deleted.
    expect(await handler(subject)).toBe(4);

    expect(await linkRevokedAt(ids.active)).not.toBeNull();
    expect(await linkRevokedAt(ids.oldRevoked)).toBe(OLD_REVOCATION);
    expect(await receiptOwner(receipt.subject)).toBe(TOMBSTONE);
    expect(await codesFor(subject)).toEqual([]);

    expect(await linkRevokedAt(ids.other)).toBeNull();
    expect(await receiptOwner(receipt.other)).toBe(other);
    expect(await codesFor(other)).toEqual([codes.other]);

    // A retry finds nothing left to do, and is not an error.
    expect(await handler(subject)).toBe(0);
  });

  it("is reported as anonymised by a deletion request", async () => {
    const report = await executeDeletion(randomUUID(), postgresHandlers(pool));
    expect(report.results.find((result) => result.domain === "partner_links")?.outcome).toEqual({
      status: "anonymised",
      records: 0,
    });
  });
});
