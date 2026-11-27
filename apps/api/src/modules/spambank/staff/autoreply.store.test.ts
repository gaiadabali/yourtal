import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spambankAutoreplySchema } from "@yourtal/contracts/spambank/staff";
import { RUN, testPool } from "../ingest/test-support";
import { changeAutoreply, readAutoreply } from "./autoreply.store";

/**
 * The auto-reply panel's state and its one write, against real Postgres (BUILD.md 4.6, 5.4).
 * `spambank.control` is a singleton the other Spambank tests touch too: its row is saved first and put back
 * after, and the rows this file adds (today's counters, the blocklist lines) are removed by their key.
 */
const pool = testPool();
let owner: Pool;
let saved: Record<string, unknown>;
let savedDay: Record<string, unknown> | undefined;
const TARGET = `t7-${RUN}.example`;
const ACTOR = `staff-${RUN}`;

const today = (): string => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  const ownerUrl = process.env["DATABASE_OWNER_URL"];
  if (ownerUrl === undefined) throw new Error("DATABASE_OWNER_URL must be set");
  owner = new Pool({ connectionString: ownerUrl, max: 2 });
  saved = (await owner.query("SELECT * FROM spambank.control")).rows[0] as Record<string, unknown>;
  savedDay = (
    await owner.query("SELECT * FROM spambank.autoreply_day WHERE day = $1::date", [today()])
  ).rows[0] as Record<string, unknown> | undefined;
});

afterAll(async () => {
  await owner.query(
    `UPDATE spambank.control SET daily_cap = $1, paused_at = $2, paused_reason = $3, updated_by = $4,
            updated_at = $5, tripped_at = $6, tripped_reason = $7, tripped_by = $8`,
    [
      saved["daily_cap"],
      saved["paused_at"],
      saved["paused_reason"],
      saved["updated_by"],
      saved["updated_at"],
      saved["tripped_at"],
      saved["tripped_reason"],
      saved["tripped_by"],
    ],
  );
  await owner.query("DELETE FROM spambank.blocklist_check WHERE target = $1", [TARGET]);
  await owner.query("DELETE FROM spambank.autoreply_day WHERE day = $1::date", [today()]);
  if (savedDay !== undefined) {
    await owner.query(
      "INSERT INTO spambank.autoreply_day (day, sent, bounces, complaints) VALUES ($1, $2, $3, $4)",
      [savedDay["day"], savedDay["sent"], savedDay["bounces"], savedDay["complaints"]],
    );
  }
  await owner.end();
  await pool.end();
});

beforeEach(async () => {
  // A known starting point: not tripped, not paused, the default cap, no counters today.
  await owner.query(
    `UPDATE spambank.control SET daily_cap = 200, paused_at = NULL, paused_reason = NULL,
            tripped_at = NULL, tripped_reason = NULL, tripped_by = NULL`,
  );
  await owner.query("DELETE FROM spambank.autoreply_day WHERE day = $1::date", [today()]);
});

async function control(): Promise<Record<string, unknown>> {
  return (await owner.query("SELECT * FROM spambank.control")).rows[0] as Record<string, unknown>;
}

describe("reading the panel", () => {
  it("reports the mode from the settings, a clean control row and zeros when nothing was sent today", async () => {
    const state = await readAutoreply(pool, "dry_run");
    expect(() => spambankAutoreplySchema.parse(state)).not.toThrow();
    expect(state).toMatchObject({
      mode: "dry_run",
      tripped: false,
      pausedAt: null,
      pausedReason: null,
      dailyCap: 200,
      today: { sent: 0, bounces: 0, complaints: 0 },
    });
  });

  it("reports today's counters (the UTC day)", async () => {
    await owner.query(
      "INSERT INTO spambank.autoreply_day (day, sent, bounces, complaints) VALUES ($1::date, 7, 2, 1)",
      [today()],
    );
    expect((await readAutoreply(pool, "live")).today).toEqual({
      sent: 7,
      bounces: 2,
      complaints: 1,
    });
  });

  it("reports the auto-pause", async () => {
    await owner.query(
      "UPDATE spambank.control SET paused_at = '2026-11-20T01:00:00Z', paused_reason = 'complaints >= 2'",
    );
    expect(await readAutoreply(pool, "live")).toMatchObject({
      pausedAt: "2026-11-20T01:00:00.000Z",
      pausedReason: "complaints >= 2",
    });
  });

  it("lists the latest blocklist result per target and list", async () => {
    const insert = (list: string, result: string, at: string, detail: string | null) =>
      owner.query(
        `INSERT INTO spambank.blocklist_check (checked_at, target, list, result, detail)
         VALUES ($1, $2, $3, $4, $5)`,
        [at, TARGET, list, result, detail],
      );
    await insert("zen", "clean", "2026-11-20T00:00:00Z", null);
    await insert("zen", "listed", "2026-11-21T00:00:00Z", "127.0.0.2");
    await insert("zen", "clean", "2026-11-22T00:00:00Z", null);
    await insert("dbl", "error", "2026-11-21T00:00:00Z", "timeout");
    const mine = (await readAutoreply(pool, "live")).lastBlocklist.filter(
      (check) => check.target === TARGET,
    );
    expect(mine).toEqual([
      {
        checkedAt: "2026-11-21T00:00:00.000Z",
        target: TARGET,
        list: "dbl",
        result: "error",
        detail: "timeout",
      },
      {
        checkedAt: "2026-11-22T00:00:00.000Z",
        target: TARGET,
        list: "zen",
        result: "clean",
        detail: null,
      },
    ]);
  });
});

describe("changing the panel", () => {
  it("trips the kill switch with the reason and who did it, and keeps the first trip time", async () => {
    await changeAutoreply(pool, { tripped: true, reason: "Complaint from a brand" }, ACTOR);
    const first = await control();
    expect(first).toMatchObject({
      tripped_reason: "Complaint from a brand",
      tripped_by: ACTOR,
      updated_by: ACTOR,
    });
    expect(first["tripped_at"]).toBeInstanceOf(Date);
    expect(first["updated_at"]).toBeInstanceOf(Date);
    expect((await readAutoreply(pool, "live")).tripped).toBe(true);

    await changeAutoreply(pool, { tripped: true, reason: "Still looking" }, `${ACTOR}-2`);
    const again = await control();
    expect(again["tripped_at"]).toEqual(first["tripped_at"]);
    expect(again).toMatchObject({ tripped_reason: "Still looking", tripped_by: `${ACTOR}-2` });
  });

  it("clears the kill switch", async () => {
    await changeAutoreply(pool, { tripped: true, reason: "Trip it" }, ACTOR);
    await changeAutoreply(pool, { tripped: false, reason: "All clear" }, ACTOR);
    expect(await control()).toMatchObject({
      tripped_at: null,
      tripped_reason: null,
      tripped_by: null,
      updated_by: ACTOR,
    });
    expect((await readAutoreply(pool, "live")).tripped).toBe(false);
  });

  it("changes the daily cap alone, and leaves the switch and the pause as they were", async () => {
    await changeAutoreply(pool, { tripped: true, reason: "Trip it" }, ACTOR);
    await owner.query("UPDATE spambank.control SET paused_at = now(), paused_reason = 'bounces'");
    await changeAutoreply(pool, { dailyCap: 50, reason: "Lower it" }, ACTOR);
    const row = await control();
    expect(row["daily_cap"]).toBe(50);
    expect(row["tripped_at"]).not.toBeNull();
    expect(row["paused_at"]).not.toBeNull();
    expect((await readAutoreply(pool, "live")).dailyCap).toBe(50);
  });

  it("allows a cap of zero, and a cap lowered below what was already sent today", async () => {
    await owner.query(
      "INSERT INTO spambank.autoreply_day (day, sent, bounces, complaints) VALUES ($1::date, 30, 0, 0)",
      [today()],
    );
    await changeAutoreply(pool, { dailyCap: 10, reason: "Below today's count" }, ACTOR);
    expect((await readAutoreply(pool, "live")).dailyCap).toBe(10);
    await changeAutoreply(pool, { dailyCap: 0, reason: "Stop everything" }, ACTOR);
    expect((await readAutoreply(pool, "live")).dailyCap).toBe(0);
  });

  it("resumes after an auto-pause, clearing both fields", async () => {
    await owner.query(
      "UPDATE spambank.control SET paused_at = now(), paused_reason = 'a blocklist listing'",
    );
    await changeAutoreply(pool, { resume: true, reason: "Delisted" }, ACTOR);
    expect(await control()).toMatchObject({
      paused_at: null,
      paused_reason: null,
      updated_by: ACTOR,
    });
  });

  it("does the whole change in one go", async () => {
    await owner.query("UPDATE spambank.control SET paused_at = now(), paused_reason = 'bounces'");
    await changeAutoreply(
      pool,
      { tripped: true, dailyCap: 5, resume: true, reason: "All three" },
      ACTOR,
    );
    expect(await control()).toMatchObject({
      daily_cap: 5,
      paused_at: null,
      paused_reason: null,
      tripped_reason: "All three",
      tripped_by: ACTOR,
    });
  });
});
