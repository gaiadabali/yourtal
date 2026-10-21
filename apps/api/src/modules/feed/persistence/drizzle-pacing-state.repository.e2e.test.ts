import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import { DrizzlePacingStateRepository } from "./drizzle-pacing-state.repository";

/**
 * 14.6.a: the feed reads and writes pacing for every candidate at once. Real Postgres. Each batch call must agree
 * with the single-campaign one it replaced (`canServe`, `recordServe`).
 */
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
const repo = new DrizzlePacingStateRepository(db);
const seeded: string[] = [];

function campaignId(): string {
  const id = randomUUID();
  seeded.push(id);
  return id;
}

async function row(id: string): Promise<{ served_today: number; day: string } | undefined> {
  const result = await db.execute<{ served_today: number; day: string }>(
    sql`SELECT served_today, day::text AS day FROM feed.pacing_state WHERE campaign_id = ${id}`,
  );
  return result.rows[0];
}

const today = () => new Date().toISOString().slice(0, 10);

afterAll(async () => {
  const owner = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
  for (const id of seeded)
    await owner.execute(sql`DELETE FROM feed.pacing_state WHERE campaign_id = ${id}`);
});

describe("DrizzlePacingStateRepository batch methods", () => {
  it("recordServes starts a count at 1, adds to today's, and restarts it after a day change", async () => {
    const fresh = campaignId();
    const counted = campaignId();
    const stale = campaignId();
    await repo.recordServe(counted);
    await db.execute(sql`
      INSERT INTO feed.pacing_state (campaign_id, day, served_today, updated_at)
      VALUES (${stale}, '2020-01-01', 7, now())`);

    await repo.recordServes([fresh, counted, stale]);

    expect(await row(fresh)).toEqual({ served_today: 1, day: today() });
    expect(await row(counted)).toEqual({ served_today: 2, day: today() });
    expect(await row(stale)).toEqual({ served_today: 1, day: today() });
  });

  it("recordServes counts a repeated id once per repeat, and does nothing for none", async () => {
    const id = campaignId();
    await repo.recordServes([id, id, id]);
    expect(await row(id)).toEqual({ served_today: 3, day: today() });
    await repo.recordServes([]);
  });

  it("canServeMany answers every id like canServe: unknown and stale are open, a capped today is not", async () => {
    const unknown = campaignId();
    const stale = campaignId();
    const capped = campaignId();
    const under = campaignId();
    await db.execute(sql`
      INSERT INTO feed.pacing_state (campaign_id, day, served_today, updated_at)
      VALUES (${stale}, '2020-01-01', 999999, now()),
             (${capped}, ${today()}, 100000, now()),
             (${under}, ${today()}, 99999, now())`);

    const many = await repo.canServeMany([unknown, stale, capped, under]);

    expect(Object.fromEntries(many)).toEqual({
      [unknown]: true,
      [stale]: true,
      [capped]: false,
      [under]: true,
    });
    for (const id of [unknown, stale, capped, under]) {
      expect(many.get(id)).toBe(await repo.canServe(id));
    }
    expect((await repo.canServeMany([])).size).toBe(0);
  });
});
