import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { ingestDeliveryLog, parseDeliveryLine } from "./delivery-log-ingest";

const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const pool = new Pool({ connectionString: DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

const sessionId = randomUUID();
const token = "a".repeat(43); // hls-token.ts's own shape; this job never verifies the signature, only the shape

function segmentLine(index: number, status = 200): string {
  return `127.0.0.1 - - [10/Oct/2026:13:55:36 +0000] "GET /media/hls/9999999999/${token}/${sessionId}/v0/segment${index}.ts HTTP/1.1" ${status} 512000 "-" "-"`;
}

describe("parseDeliveryLine", () => {
  it("reads a segment request", () => {
    const parsed = parseDeliveryLine(segmentLine(3));
    expect(parsed).not.toBeNull();
    expect(parsed?.sessionId).toBe(sessionId);
    expect(parsed?.segmentIndex).toBe(3);
    expect(parsed?.statusCode).toBe(200);
    expect(parsed?.servedAt.toISOString()).toBe("2026-10-10T13:55:36.000Z");
  });

  it("reads a manifest request with no segment index", () => {
    const parsed = parseDeliveryLine(
      `127.0.0.1 - - [10/Oct/2026:13:55:36 +0000] "GET /media/hls/9999999999/${token}/${sessionId}/master.m3u8 HTTP/1.1" 200 900 "-" "-"`,
    );
    expect(parsed?.segmentIndex).toBeNull();
  });

  it("ignores a request that is not the signed HLS path", () => {
    expect(
      parseDeliveryLine(`127.0.0.1 - - [10/Oct/2026:13:55:36 +0000] "GET /health HTTP/1.1" 200 2 "-" "-"`),
    ).toBeNull();
  });

  it("ignores a malformed line rather than throwing", () => {
    expect(parseDeliveryLine("not a log line at all")).toBeNull();
    expect(parseDeliveryLine("")).toBeNull();
  });

  it("hashes identical lines identically, so re-ingestion can dedupe on it", () => {
    const line = segmentLine(1);
    expect(parseDeliveryLine(line)?.lineHash).toBe(parseDeliveryLine(line)?.lineHash);
    expect(parseDeliveryLine(line)?.lineHash).not.toBe(parseDeliveryLine(segmentLine(2))?.lineHash);
  });
});

describe("ingestDeliveryLog", () => {
  it("does nothing when no log path is configured", async () => {
    expect(await ingestDeliveryLog(pool, "")).toBe(0);
  });

  it("does nothing when the log has not been rotated in yet", async () => {
    expect(await ingestDeliveryLog(pool, path.join(tmpdir(), `no-such-file-${randomUUID()}.log`))).toBe(0);
  });

  it("writes each HLS line once, and re-ingesting the same file inserts nothing new", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "delivery-log-"));
    const file = path.join(dir, "access.log");
    try {
      const lines = [segmentLine(0), segmentLine(1), segmentLine(2), "not a log line"].join("\n");
      await writeFile(file, lines, "utf8");

      const first = await ingestDeliveryLog(pool, file);
      expect(first).toBe(3);

      const second = await ingestDeliveryLog(pool, file);
      expect(second).toBe(0);

      const rows = await pool.query<{ segment_index: number | null }>(
        `SELECT segment_index FROM platform.delivery_log WHERE session_id = $1 ORDER BY segment_index`,
        [sessionId],
      );
      expect(rows.rows.map((r) => r.segment_index)).toEqual([0, 1, 2]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
