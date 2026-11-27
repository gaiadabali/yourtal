import type { QueryResultRow } from "pg";
import {
  LEAD_EXPORT_MAX,
  LEAD_PAGE_SIZE,
  type LeadStatus,
  type SpambankLead,
  type SpambankLeadPage,
  type SpambankLeadUpdate,
} from "@yourtal/contracts/spambank/staff";
import type { Queryable } from "../ingest/db";

/**
 * BUILD.md 4.7 / 5.4: the staff leads list. Every query takes the region from the caller's principal,
 * never from the request, and filters on it in SQL: the region wall for a list that spans brands.
 */
export type LeadRegion = "AU" | "ID";

export interface LeadFilter {
  readonly status?: LeadStatus | undefined;
  readonly q?: string | undefined;
  readonly cursor?: string | undefined;
}

export class InvalidCursorError extends Error {
  constructor() {
    super("the cursor is not one this list gave out");
  }
}

interface LeadRow extends QueryResultRow {
  org_domain: string;
  display_name: string | null;
  sample_from: string | null;
  sample_subject: string | null;
  recipients: number;
  messages: number;
  first_seen_at: Date;
  last_seen_at: Date;
  status: LeadStatus;
  note: string | null;
  last_replied_at: Date | null;
  opted_out_at: Date | null;
  /** `last_seen_at` at microsecond precision: a JS Date would round it and break the keyset. */
  cursor_t: string;
}

const MICROS_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** `base64url({ t, d })`: where the next page starts. */
export function encodeCursor(t: string, d: string): string {
  return Buffer.from(JSON.stringify({ t, d })).toString("base64url");
}

export function decodeCursor(cursor: string): { t: string; d: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed === "object" && parsed !== null) {
      const { t, d } = parsed as Record<string, unknown>;
      if (typeof t === "string" && MICROS_ISO.test(t) && typeof d === "string" && d.length <= 253) {
        return { t, d };
      }
    }
  } catch {
    // falls through to the refusal
  }
  throw new InvalidCursorError();
}

/** `%`, `_` and the escape character are literal in a staff member's search. */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const SELECT = `
  l.org_domain, l.display_name, l.sample_from, l.sample_subject, l.messages,
  l.first_seen_at, l.last_seen_at, l.status, l.note,
  (SELECT count(*)::int FROM spambank.lead_sighting s
    WHERE s.region = l.region AND s.org_domain = l.org_domain) AS recipients,
  d.last_replied_at, d.opted_out_at,
  to_char(l.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_t`;

/** `autoreply_domain` is global (one sending reputation), so it joins on the domain alone. */
const JOIN = "LEFT JOIN spambank.autoreply_domain d ON d.org_domain = l.org_domain";

function toLead(row: LeadRow): SpambankLead {
  return {
    orgDomain: row.org_domain,
    displayName: row.display_name,
    sampleFrom: row.sample_from,
    sampleSubject: row.sample_subject,
    recipients: row.recipients,
    messages: row.messages,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    status: row.status,
    note: row.note,
    autoRepliedAt: row.last_replied_at?.toISOString() ?? null,
    optedOutAt: row.opted_out_at?.toISOString() ?? null,
  };
}

async function select(
  db: Queryable,
  region: LeadRegion,
  filter: LeadFilter,
  limit: number,
): Promise<LeadRow[]> {
  const params: unknown[] = [region];
  const where = ["l.region = $1"];
  if (filter.status !== undefined) {
    params.push(filter.status);
    where.push(`l.status = $${String(params.length)}`);
  }
  const q = filter.q?.trim() ?? "";
  if (q.length > 0) {
    params.push(`%${escapeLike(q)}%`);
    const n = String(params.length);
    where.push(`(l.org_domain ILIKE $${n} ESCAPE '\\' OR l.display_name ILIKE $${n} ESCAPE '\\')`);
  }
  if (filter.cursor !== undefined && filter.cursor.length > 0) {
    const { t, d } = decodeCursor(filter.cursor);
    params.push(t, d);
    const tn = String(params.length - 1);
    const dn = String(params.length);
    where.push(
      `(l.last_seen_at < $${tn}::timestamptz OR (l.last_seen_at = $${tn}::timestamptz AND l.org_domain > $${dn}))`,
    );
  }
  params.push(limit);
  const { rows } = await db.query<LeadRow>(
    `SELECT ${SELECT} FROM spambank.lead l ${JOIN}
      WHERE ${where.join(" AND ")}
      ORDER BY l.last_seen_at DESC, l.org_domain ASC
      LIMIT $${String(params.length)}`,
    params,
  );
  return rows;
}

/** One page, newest sighting first; `nextCursor` is null on the last one. */
export async function listLeads(
  db: Queryable,
  region: LeadRegion,
  filter: LeadFilter,
): Promise<SpambankLeadPage> {
  const rows = await select(db, region, filter, LEAD_PAGE_SIZE + 1);
  const page = rows.slice(0, LEAD_PAGE_SIZE);
  const last = page[page.length - 1];
  const more = rows.length > LEAD_PAGE_SIZE && last !== undefined;
  return {
    items: page.map(toLead),
    nextCursor: more ? encodeCursor(last.cursor_t, last.org_domain) : null,
  };
}

/** The whole filtered list for the CSV, capped: one region's list, not a data dump. */
export async function exportLeads(
  db: Queryable,
  region: LeadRegion,
  filter: Omit<LeadFilter, "cursor">,
): Promise<SpambankLead[]> {
  return (await select(db, region, filter, LEAD_EXPORT_MAX)).map(toLead);
}

/** Status and/or note of one lead in the caller's region; null when there is no such lead there. */
export async function updateLead(
  db: Queryable,
  region: LeadRegion,
  orgDomain: string,
  update: SpambankLeadUpdate,
): Promise<SpambankLead | null> {
  const noteGiven = update.note !== undefined;
  // An empty note is a cleared one.
  const note = update.note === undefined || update.note === "" ? null : update.note;
  const { rows } = await db.query<LeadRow>(
    `WITH u AS (
       UPDATE spambank.lead
          SET status = COALESCE($3::text, status),
              note   = CASE WHEN $4::boolean THEN $5::text ELSE note END
        WHERE region = $1 AND org_domain = $2
        RETURNING *)
     SELECT ${SELECT} FROM u l ${JOIN}`,
    [region, orgDomain.toLowerCase(), update.status ?? null, noteGiven, note],
  );
  const row = rows[0];
  return row === undefined ? null : toLead(row);
}
