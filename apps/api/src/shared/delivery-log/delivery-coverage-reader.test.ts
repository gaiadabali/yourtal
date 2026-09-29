import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { RealDeliveryCoverageReader, claimedIsCoveredByServed } from "./delivery-coverage-reader";

describe("claimedIsCoveredByServed", () => {
  it("matches when served spans fully cover the claimed ones", () => {
    expect(claimedIsCoveredByServed([[0, 10]], [[0, 6], [6, 12]])).toBe(true);
  });

  it("detects a gap the served segments never covered", () => {
    expect(claimedIsCoveredByServed([[0, 18]], [[0, 6], [12, 18]])).toBe(false);
  });

  it("merges adjacent and overlapping claimed spans before comparing", () => {
    // Claimed as two overlapping reports of the same seconds; one served
    // segment covering the whole thing is enough.
    expect(claimedIsCoveredByServed([[0, 6], [4, 10]], [[0, 12]])).toBe(true);
  });

  it("has nothing to check against an empty claim", () => {
    expect(claimedIsCoveredByServed([], [[0, 6]])).toBe(true);
  });
});

const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const pool = new Pool({ connectionString: DATABASE_URL });
afterAll(async () => {
  await pool.end();
});

async function seededCampaign(): Promise<{ campaignId: string; termsVersion: number }> {
  const campaigns = await pool.query<{ id: string }>(
    `SELECT id FROM campaign.campaigns WHERE lifecycle_state IN ('live','paused','ended')
      ORDER BY published_at DESC LIMIT 1`,
  );
  const campaignId = campaigns.rows[0]?.id;
  if (campaignId === undefined) throw new Error("expected at least one seeded campaign");
  const terms = await pool.query<{ version: number }>(
    `SELECT version FROM campaign.terms_version WHERE campaign_id = $1 ORDER BY version DESC LIMIT 1`,
    [campaignId],
  );
  const termsVersion = terms.rows[0]?.version;
  if (termsVersion === undefined) throw new Error("expected the seeded campaign to carry terms");
  return { campaignId, termsVersion };
}

async function seedSession(): Promise<string> {
  const { campaignId, termsVersion } = await seededCampaign();
  const sessionId = randomUUID();
  await pool.query(
    `INSERT INTO watch.session (id, user_id, campaign_id, terms_version, state)
     VALUES ($1, $2, $3, $4, 'active')`,
    [sessionId, randomUUID(), campaignId, termsVersion],
  );
  return sessionId;
}

describe("RealDeliveryCoverageReader", () => {
  it("answers unknown before the log has ingested anything for this session", async () => {
    const sessionId = await seedSession();
    const reader = new RealDeliveryCoverageReader(pool);
    expect(await reader.deliveryCoverage(sessionId)).toBe("unknown");
  });

  it("answers matches when served segments cover every claimed span", async () => {
    const sessionId = await seedSession();
    await pool.query(`INSERT INTO watch.coverage (session_id, from_second, to_second) VALUES ($1, 0, 12)`, [
      sessionId,
    ]);
    for (const index of [0, 1]) {
      await pool.query(
        `INSERT INTO platform.delivery_log (session_id, segment_index, path, status_code, served_at, line_hash)
         VALUES ($1, $2, $3, 200, now(), $4)`,
        [sessionId, index, `/media/hls/9999999999/x/${sessionId}/v0/segment${index}.ts`, randomUUID()],
      );
    }
    const reader = new RealDeliveryCoverageReader(pool);
    expect(await reader.deliveryCoverage(sessionId)).toBe("matches");
  });

  it("answers gap_detected when the claim outruns what the log shows served", async () => {
    const sessionId = await seedSession();
    await pool.query(`INSERT INTO watch.coverage (session_id, from_second, to_second) VALUES ($1, 0, 30)`, [
      sessionId,
    ]);
    await pool.query(
      `INSERT INTO platform.delivery_log (session_id, segment_index, path, status_code, served_at, line_hash)
       VALUES ($1, 0, $2, 200, now(), $3)`,
      [sessionId, `/media/hls/9999999999/x/${sessionId}/v0/segment0.ts`, randomUUID()],
    );
    const reader = new RealDeliveryCoverageReader(pool);
    expect(await reader.deliveryCoverage(sessionId)).toBe("gap_detected");
  });
});
