import { randomUUID } from "node:crypto";
import type { Queryable } from "../ingest/db";
import { utcDay } from "./decide";
import type { SystemMailer } from "./mailer";
import { buildAlertMessage } from "./message";

/**
 * Auto-pause (BUILD.md §4.6 "Bounces and complaints", D2 6): in one UTC day, 10 or more bounces that are
 * also at least 10% of the replies sent, or 2 complaints, or any blocklist listing, set
 * `control.paused_at`. Only staff resume (`POST /api/staff/spambank/autoreply {resume: true}`). The pause
 * is claimed with `WHERE paused_at IS NULL`, so the alert goes out once per pause, not once per check.
 */

export const BOUNCES_MIN = 10;
export const BOUNCE_SHARE = 0.1;
export const COMPLAINTS_MAX = 2;

export interface DayCounts {
  readonly sent: number;
  readonly bounces: number;
  readonly complaints: number;
}

export function pauseReasonFor(day: DayCounts): string | null {
  if (day.complaints >= COMPLAINTS_MAX) {
    return `${String(day.complaints)} complaints today (limit ${String(COMPLAINTS_MAX)})`;
  }
  if (day.bounces >= BOUNCES_MIN && day.bounces >= day.sent * BOUNCE_SHARE) {
    return `${String(day.bounces)} bounces of ${String(day.sent)} replies today (limit ${String(BOUNCES_MIN)} and 10%)`;
  }
  return null;
}

export async function dayCounts(db: Queryable, now: Date): Promise<DayCounts> {
  const { rows } = await db.query<DayCounts>(
    "SELECT sent, bounces, complaints FROM spambank.autoreply_day WHERE day = $1::date",
    [utcDay(now)],
  );
  return rows[0] ?? { sent: 0, bounces: 0, complaints: 0 };
}

/** Pauses unless already paused. True when this call paused it. */
export async function pause(db: Queryable, reason: string, now: Date): Promise<boolean> {
  const result = await db.query(
    `UPDATE spambank.control SET paused_at = $1, paused_reason = $2 WHERE paused_at IS NULL`,
    [now, reason.slice(0, 500)],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Today's bounce and complaint numbers: pauses when over a threshold. Returns the reason if it paused now. */
export async function pauseOnThresholds(db: Queryable, now: Date): Promise<string | null> {
  const reason = pauseReasonFor(await dayCounts(db, now));
  if (reason === null) return null;
  return (await pause(db, reason, now)) ? reason : null;
}

const SAFE_ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export interface Alerter {
  alert(subject: string, text: string): Promise<void>;
}

/** Emails `SPAMBANK_ALERT_EMAILS` from the reply address; never throws (the log line is the fallback). */
export function createAlerter(input: {
  readonly mailer: SystemMailer;
  readonly replyDomain: string;
  readonly to: readonly string[];
  readonly now?: () => Date;
  readonly log?: (message: string) => void;
}): Alerter {
  const log = input.log ?? ((message: string) => console.error(message));
  const to = input.to.filter((address) => SAFE_ADDRESS.test(address));
  return {
    async alert(subject: string, text: string): Promise<void> {
      log(`[spambank] ALERT: ${subject}`);
      if (to.length === 0) return;
      try {
        const message = buildAlertMessage({
          replyDomain: input.replyDomain,
          to,
          subject: `[Spambank] ${subject}`,
          text,
          id: randomUUID(),
          date: (input.now ?? (() => new Date()))(),
        });
        const sent = await input.mailer.send(message.raw, to);
        if (!sent.ok) log(`[spambank] the alert email failed: ${sent.code}`);
      } catch (error) {
        log(
          `[spambank] the alert email failed: ${error instanceof Error ? error.message : "error"}`,
        );
      }
    },
  };
}

export function pausedAlertText(reason: string): string {
  return [
    "Spambank's counter-spam auto-reply has paused itself.",
    "",
    `Reason: ${reason}`,
    "",
    "No reply is sent until a staff member (ops or admin) resumes it on the staff auto-reply page,",
    'or with POST /api/staff/spambank/autoreply {"resume": true, "reason": "..."}.',
    "Check the bounces, complaints and blocklist results there first.",
  ].join("\n");
}
