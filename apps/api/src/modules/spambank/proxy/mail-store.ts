import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";

/**
 * What the mail API reads and writes in Postgres (spambank/BUILD.md §4.3-§4.5, §4.13). Behind an
 * interface so the proxy's tests run without a database; `createPgMailStore` is the real one.
 */

export interface MailboxRecord {
  readonly id: string;
  readonly userId: string;
  readonly localPart: string;
  readonly domain: string;
  readonly status: "provisioning" | "active" | "suspended" | "erasing";
  readonly junkMailboxId: string | null;
}

export interface UnsubscribeRecord {
  readonly mailboxId: string;
  readonly orgDomain: string;
  readonly method: "one_click" | "mailto" | "link";
  readonly status: "done" | "failed" | "opened";
  readonly httpStatus: number | null;
}

export interface MailCounters {
  readonly bulkFiled30d: number;
  readonly marketersUnsubscribed: number;
  readonly autoRepliesSent30d: number;
}

export interface SpambankMailStore {
  findMailbox(id: string): Promise<MailboxRecord | undefined>;
  /**
   * Adds `count` recipients to today's (UTC) send count unless the total would pass `cap`. Returns
   * the day it counted against (to give recipients back), or undefined when over the cap.
   */
  reserveRecipients(mailboxId: string, count: number, cap: number): Promise<string | undefined>;
  /** Gives back recipients that were never sent (Stalwart refused or never answered). */
  releaseRecipients(mailboxId: string, day: string, count: number): Promise<void>;
  recordUnsubscribe(row: UnsubscribeRecord): Promise<void>;
  counters(mailboxId: string): Promise<MailCounters>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: ReadonlySet<string> = new Set(["provisioning", "active", "suspended", "erasing"]);

function isStatus(value: unknown): value is MailboxRecord["status"] {
  return typeof value === "string" && STATUSES.has(value);
}

function count(value: unknown): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function createPgMailStore(db: AppDb): SpambankMailStore {
  return {
    async findMailbox(id) {
      if (!UUID.test(id)) return undefined;
      const result = await db.execute(sql`
        SELECT id::text AS id, user_id, local_part, domain, status, junk_mailbox_id
          FROM spambank.mailbox WHERE id = ${id}::uuid`);
      const row = result.rows[0];
      if (row === undefined || !isStatus(row.status)) return undefined;
      return {
        id: String(row.id),
        userId: String(row.user_id),
        localPart: String(row.local_part),
        domain: String(row.domain),
        status: row.status,
        junkMailboxId: typeof row.junk_mailbox_id === "string" ? row.junk_mailbox_id : null,
      };
    },

    async reserveRecipients(mailboxId, recipients, cap) {
      // One statement: the conflict update's WHERE is checked under the row lock, so two parallel
      // sends cannot both fit under the cap.
      const result = await db.execute(sql`
        INSERT INTO spambank.send_count AS c (mailbox_id, day, recipients)
        SELECT ${mailboxId}::uuid, (now() AT TIME ZONE 'UTC')::date, ${recipients}::int
         WHERE ${recipients}::int <= ${cap}::int
        ON CONFLICT (mailbox_id, day) DO UPDATE
           SET recipients = c.recipients + EXCLUDED.recipients
         WHERE c.recipients + EXCLUDED.recipients <= ${cap}::int
        RETURNING day::text AS day`);
      const day = result.rows[0]?.day;
      return typeof day === "string" ? day : undefined;
    },

    async releaseRecipients(mailboxId, day, recipients) {
      await db.execute(sql`
        UPDATE spambank.send_count
           SET recipients = greatest(recipients - ${recipients}::int, 0)
         WHERE mailbox_id = ${mailboxId}::uuid AND day = ${day}::date`);
    },

    async recordUnsubscribe(row) {
      await db.execute(sql`
        INSERT INTO spambank.unsubscribe (id, mailbox_id, org_domain, method, status, http_status)
        VALUES (${randomUUID()}::uuid, ${row.mailboxId}::uuid, ${row.orgDomain}, ${row.method},
                ${row.status}, ${row.httpStatus})`);
    },

    async counters(mailboxId) {
      // "Sent" auto-replies are the ones that reached the marketer: live mode only, not redirect.
      const result = await db.execute(sql`
        SELECT
          (SELECT count(*) FROM spambank.ingested_message
            WHERE mailbox_id = ${mailboxId}::uuid AND folder = 'junk'
              AND received_at > now() - interval '30 days') AS bulk,
          (SELECT count(DISTINCT org_domain) FROM spambank.unsubscribe
            WHERE mailbox_id = ${mailboxId}::uuid AND status = 'done') AS unsubscribed,
          (SELECT count(*) FROM spambank.autoreply
            WHERE source_mailbox_id = ${mailboxId}::uuid AND mode = 'live'
              AND status IN ('sent', 'bounced', 'complained')
              AND created_at > now() - interval '30 days') AS replies`);
      const row = result.rows[0];
      return {
        bulkFiled30d: count(row?.bulk),
        marketersUnsubscribed: count(row?.unsubscribed),
        autoRepliesSent30d: count(row?.replies),
      };
    },
  };
}
