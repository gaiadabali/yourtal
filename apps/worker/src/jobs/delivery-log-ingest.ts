import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { defineJob } from "../job";

/**
 * TASKS.md 10.4.c (EW-18): a worker job loads the nginx access log into
 * `platform.delivery_log`, so `deliveryCoverage(sessionId)`
 * (apps/api/src/shared/delivery-log) has real evidence of which signed HLS
 * segments were actually served, cross-checked against a session's own
 * claimed coverage (`watch.coverage`). apps/api/src/modules/watch's own
 * `StubDeliveryCoverageReader` stays wired in until 11.5.f swaps it for the
 * real one -- this job only has to make the table true meanwhile.
 *
 * No byte-offset tracking: the whole file is re-read and re-parsed on every
 * tick, and `platform.delivery_log.line_hash` (a sha-256 of the raw line)
 * is what makes that idempotent rather than "re-ingest the same log twice a
 * minute forever". A real nginx log rotates daily in staging, which keeps
 * the file this reads small; a bigger one is a later job's problem
 * (streaming instead of `readFile`), not this one's.
 */

// `/media/hls/<expires>/<token>/<sessionId>/<path>` — hls-token.ts's own
// shape (apps/api/src/shared/media-auth). Segments are named `segmentN.ts`
// by ffmpeg-transcode.ts (7.2.b); a manifest request (`.m3u8`) has no index.
const HLS_PATH = /^\/media\/hls\/\d{1,12}\/[A-Za-z0-9_-]{43}\/([A-Za-z0-9-]{1,64})\/(.+)$/;
const SEGMENT_NAME = /segment(\d+)\.ts$/;

// Combined Log Format: `host - - [date] "METHOD path HTTP/1.1" status bytes ...`
const COMBINED_LOG_LINE = /^\S+ \S+ \S+ \[([^\]]+)\] "(?:\S+) (\S+) \S+" (\d{3}) \S+/;

export interface ParsedDeliveryLine {
  readonly sessionId: string;
  readonly segmentIndex: number | null;
  readonly path: string;
  readonly statusCode: number;
  readonly servedAt: Date;
  readonly lineHash: string;
}

/** Parses one access-log line, or null for a line this job has no business in (not an HLS request, or malformed). */
export function parseDeliveryLine(line: string): ParsedDeliveryLine | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  const combined = COMBINED_LOG_LINE.exec(trimmed);
  if (combined === null) return null;
  const [, dateRaw, requestPath, statusRaw] = combined as unknown as [string, string, string, string];

  const hls = HLS_PATH.exec(requestPath.split("?")[0] ?? "");
  if (hls === null) return null;
  const [, sessionId, mediaPath] = hls as unknown as [string, string, string];

  const servedAt = parseNginxDate(dateRaw);
  if (servedAt === null) return null;

  const segmentMatch = SEGMENT_NAME.exec(mediaPath);
  const segmentIndex = segmentMatch ? Number(segmentMatch[1]) : null;

  return {
    sessionId,
    segmentIndex,
    path: requestPath,
    statusCode: Number(statusRaw),
    servedAt,
    lineHash: createHash("sha256").update(trimmed).digest("hex"),
  };
}

/** `10/Oct/2026:13:55:36 +0000` — nginx's own default date format. */
function parseNginxDate(raw: string): Date | null {
  const match = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/.exec(raw);
  if (match === null) return null;
  const [, day, monthName, year, hour, minute, second, offset] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const month = MONTHS.indexOf(monthName);
  if (month < 0) return null;
  const offsetSign = offset.startsWith("-") ? 1 : -1;
  const offsetMinutes = offsetSign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3, 5)));
  const utcMs =
    Date.UTC(Number(year), month, Number(day), Number(hour), Number(minute), Number(second)) +
    offsetMinutes * 60_000;
  return new Date(utcMs);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Reads the log file and writes every new HLS line, returning how many rows this call inserted. */
export async function ingestDeliveryLog(pool: Pool, logPath: string): Promise<number> {
  if (logPath === "") return 0; // no nginx in front of this environment yet
  let contents: string;
  try {
    contents = await readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; // nothing rotated in yet
    throw error;
  }

  let inserted = 0;
  for (const line of contents.split("\n")) {
    const parsed = parseDeliveryLine(line);
    if (parsed === null) continue;
    const result = await pool.query(
      `INSERT INTO platform.delivery_log
         (session_id, segment_index, path, status_code, served_at, line_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (line_hash) DO NOTHING`,
      [parsed.sessionId, parsed.segmentIndex, parsed.path, parsed.statusCode, parsed.servedAt, parsed.lineHash],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

let pool: Pool | undefined;
function poolFor(databaseUrl: string): Pool {
  pool ??= new Pool({ connectionString: databaseUrl });
  return pool;
}

export const job = defineJob({
  queue: "platform.delivery_log_ingest",
  schedule: "*/5 * * * *",
  async handle(_job, { config }) {
    await ingestDeliveryLog(poolFor(config.databaseUrl), config.nginxAccessLogPath);
  },
});
