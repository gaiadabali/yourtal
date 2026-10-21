import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { runOidcModelPurge } from "./oidc-model-purge";

/** Real Postgres, like every other worker job test here. */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const pool = new Pool({ connectionString: DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

const NOW = new Date("2026-10-21T12:00:00Z");

async function row(expiresAt: Date | null): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO oidc.model (kind, id, payload, expires_at) VALUES ('Interaction', $1, '{}', $2)`,
    [id, expiresAt],
  );
  return id;
}

async function exists(id: string): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM oidc.model WHERE id = $1", [id]);
  return result.rowCount === 1;
}

describe("oidc-model-purge job", () => {
  it("deletes rows expired more than a day ago, and keeps the rest", async () => {
    const old = await row(new Date("2026-10-19T12:00:00Z"));
    const recent = await row(new Date("2026-10-21T06:00:00Z"));
    const live = await row(new Date("2026-10-21T13:00:00Z"));

    expect(await runOidcModelPurge(pool, NOW)).toBeGreaterThanOrEqual(1);

    expect(await exists(old)).toBe(false);
    expect(await exists(recent)).toBe(true);
    expect(await exists(live)).toBe(true);
  });

  it("works through more than one batch", async () => {
    const prefix = randomUUID();
    await pool.query(
      `INSERT INTO oidc.model (kind, id, payload, expires_at)
       SELECT 'AccessToken', $1::text || '-' || n::text, '{}', timestamptz '2026-10-01T00:00:00Z'
         FROM generate_series(1, 1005) AS n`,
      [prefix],
    );
    expect(await runOidcModelPurge(pool, NOW)).toBeGreaterThanOrEqual(1005);
    const left = await pool.query("SELECT 1 FROM oidc.model WHERE id LIKE $1", [`${prefix}-%`]);
    expect(left.rowCount).toBe(0);
  });

  it("is idempotent", async () => {
    await runOidcModelPurge(pool, NOW);
    expect(await runOidcModelPurge(pool, NOW)).toBe(0);
  });
});
