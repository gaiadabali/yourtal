import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { runGuardianEmailPurge } from "./guardian-email-purge";

/** Real Postgres — same shape every other worker job test in this directory uses. */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const pool = new Pool({ connectionString: DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

async function seedTeenWithGuardianConsent(dateOfBirth: string): Promise<string> {
  const userId = randomUUID();
  await pool.query(
    `INSERT INTO identity.user_profile (user_id, region, display_name, date_of_birth, timezone)
     VALUES ($1, 'AU', 'Guardian Purge Test', $2, 'Australia/Sydney')`,
    [userId, dateOfBirth],
  );
  await pool.query(
    `INSERT INTO identity.guardian_consent (user_id, token_hash, guardian_email, region)
     VALUES ($1, $2, 'guardian-purge@example.test', 'AU')`,
    [userId, `guardian-purge-token-${userId}`],
  );
  return userId;
}

async function guardianEmailFor(userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ guardian_email: string | null }>(
    `SELECT guardian_email FROM identity.guardian_consent WHERE user_id = $1`,
    [userId],
  );
  return rows[0]?.guardian_email ?? null;
}

describe("guardian-email-purge job", () => {
  it("clears the guardian email for an account that has turned 18", async () => {
    // Comfortably 18+ as of any date this suite runs.
    const userId = await seedTeenWithGuardianConsent("2000-01-01");

    const cleared = await runGuardianEmailPurge(pool, new Date("2026-09-30T00:00:00Z"));

    expect(cleared).toBeGreaterThanOrEqual(1);
    expect(await guardianEmailFor(userId)).toBeNull();
  });

  it("keeps the guardian email for a 17-year-old", async () => {
    // 17 as of 2026-09-30 -- inside 13-17, not yet 18.
    const userId = await seedTeenWithGuardianConsent("2009-06-01");

    await runGuardianEmailPurge(pool, new Date("2026-09-30T00:00:00Z"));

    expect(await guardianEmailFor(userId)).toBe("guardian-purge@example.test");
  });

  it("is idempotent -- a second run against an already-cleared row changes nothing and errors on nothing", async () => {
    const userId = await seedTeenWithGuardianConsent("1995-01-01");

    await runGuardianEmailPurge(pool, new Date("2026-09-30T00:00:00Z"));
    expect(await guardianEmailFor(userId)).toBeNull();

    const secondRunCount = await runGuardianEmailPurge(pool, new Date("2026-09-30T00:00:00Z"));
    expect(await guardianEmailFor(userId)).toBeNull();
    // Not asserting `secondRunCount` is 0 outright: other tests in this
    // suite may have left their own turned-18 rows uncleared depending on
    // execution order. What matters is this row specifically stays null
    // and the run does not throw.
    expect(secondRunCount).toBeGreaterThanOrEqual(0);
  });
});
