import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { isTeenInQuietHours } from "./teen-quiet-hours";

const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const pool = new Pool({ connectionString: DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

async function seedProfile(dateOfBirth: string, timezone: string): Promise<string> {
  const userId = randomUUID();
  await pool.query(
    `INSERT INTO identity.user_profile (user_id, region, display_name, date_of_birth, timezone)
     VALUES ($1, 'AU', 'Quiet Hours Fixture', $2, $3)`,
    [userId, dateOfBirth, timezone],
  );
  return userId;
}

describe("isTeenInQuietHours", () => {
  it("is true for a teen at 21:00 in their own timezone", async () => {
    const userId = await seedProfile("2012-01-01", "Australia/Sydney");
    expect(await isTeenInQuietHours(pool, userId, new Date("2026-07-01T11:00:00.000Z"))).toBe(true);
  });

  it("is false for the same teen at 10:00", async () => {
    const userId = await seedProfile("2012-01-01", "Australia/Sydney");
    expect(await isTeenInQuietHours(pool, userId, new Date("2026-07-01T00:00:00.000Z"))).toBe(
      false,
    );
  });

  it("is false for an adult at 21:00 -- quiet hours are a teen-only rule", async () => {
    const userId = await seedProfile("1990-01-01", "Australia/Sydney");
    expect(await isTeenInQuietHours(pool, userId, new Date("2026-07-01T11:00:00.000Z"))).toBe(
      false,
    );
  });

  it("fails open (false) when there is no profile to check", async () => {
    expect(await isTeenInQuietHours(pool, randomUUID(), new Date("2026-07-01T11:00:00.000Z"))).toBe(
      false,
    );
  });
});
