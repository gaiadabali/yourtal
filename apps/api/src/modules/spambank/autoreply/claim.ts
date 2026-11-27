import type { PoolClient } from "pg";
import type { AutoreplyMode } from "@yourtal/contracts/spambank/common";
import type { AutoreplyDecision } from "./decide";
import { QUEUED, SENDING, utcDay } from "./decide";

/**
 * BUILD.md §4.6 checks 0 (again), 8, 9 and 10 and the mode, in ONE transaction, so the guards are atomic:
 *
 * - the message row is locked first: a job that fires twice (or a sweep re-queue) waits, then finds the
 *   decision already taken and does nothing;
 * - check 9 is an upsert that sets `last_replied_at` only when the domain is not opted out and was not
 *   replied to in 30 days: two jobs for one new domain serialise on its row and exactly one gets a row back;
 * - check 10 increments today's counter only below `control.daily_cap` (the migration's trigger is the
 *   backstop); no row means the whole transaction is rolled back, which frees the domain claim;
 * - `dry_run` rolls back too: it records `would_send` and spends no slot.
 *
 * `redirect`/`live` commit the claims, an `autoreply` row (`queued`) and the message's `sending` mark, and
 * only then is the mail sent: a crash after this sends nothing twice (at most once, never twice).
 */

export interface ClaimInput {
  readonly mailboxId: string;
  readonly emailId: string;
  readonly orgDomain: string;
  readonly mode: Exclude<AutoreplyMode, "off">;
  /** For `redirect`/`live`: the new `autoreply` row. */
  readonly reply?: {
    readonly id: string;
    readonly toAddress: string;
    readonly messageId: string;
  };
  readonly now: Date;
}

export type ClaimResult =
  /** Another run took the decision first. */
  | { readonly status: "not_queued" }
  | { readonly status: "decided"; readonly decision: AutoreplyDecision }
  /** Claims committed: send now. */
  | { readonly status: "claimed" };

const CHECK_VIOLATION = "23514";

/** Writes a decision over `from` (`queued` unless said), so a decision is only ever taken once. */
export async function recordDecision(
  db: Pick<PoolClient, "query">,
  mailboxId: string,
  emailId: string,
  decision: AutoreplyDecision | typeof SENDING,
  from: string = QUEUED,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE spambank.ingested_message SET autoreply_decision = $3
      WHERE mailbox_id = $1 AND email_id = $2 AND autoreply_decision = $4`,
    [mailboxId, emailId, decision, from],
  );
  return (result.rowCount ?? 0) > 0;
}

async function rollbackAndRecord(
  db: PoolClient,
  input: ClaimInput,
  decision: AutoreplyDecision,
): Promise<ClaimResult> {
  await db.query("ROLLBACK");
  const recorded = await recordDecision(db, input.mailboxId, input.emailId, decision);
  return recorded ? { status: "decided", decision } : { status: "not_queued" };
}

async function commitDecision(
  db: PoolClient,
  input: ClaimInput,
  decision: AutoreplyDecision,
): Promise<ClaimResult> {
  await recordDecision(db, input.mailboxId, input.emailId, decision);
  await db.query("COMMIT");
  return { status: "decided", decision };
}

function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

/** Runs the claim on a checked-out client. The caller releases it (destroying it if this threw). */
export async function claimAutoreply(db: PoolClient, input: ClaimInput): Promise<ClaimResult> {
  await db.query("BEGIN");
  try {
    const locked = await db.query<{ autoreply_decision: string }>(
      `SELECT autoreply_decision FROM spambank.ingested_message
        WHERE mailbox_id = $1 AND email_id = $2 FOR UPDATE`,
      [input.mailboxId, input.emailId],
    );
    if (locked.rows[0]?.autoreply_decision !== QUEUED) {
      await db.query("ROLLBACK");
      return { status: "not_queued" };
    }

    // Check 0 inside the transaction: a trip or a pause takes effect on the very next claim.
    const control = await db.query<{ tripped: boolean; paused: boolean }>(
      `SELECT tripped_at IS NOT NULL AS tripped, paused_at IS NOT NULL AS paused
         FROM spambank.control FOR SHARE`,
    );
    const state = control.rows[0];
    if (state === undefined || state.tripped) return await commitDecision(db, input, "disabled");
    if (state.paused) return await commitDecision(db, input, "paused");

    // Check 8.
    const domain = await db.query<{ opted: boolean }>(
      `SELECT opted_out_at IS NOT NULL AS opted FROM spambank.autoreply_domain WHERE org_domain = $1`,
      [input.orgDomain],
    );
    if (domain.rows[0]?.opted === true) return await commitDecision(db, input, "opted_out");

    // Check 9: one reply per registrable domain per 30 days, across every user.
    const claimed = await db.query(
      `INSERT INTO spambank.autoreply_domain AS d (org_domain, last_replied_at, replies_total)
       VALUES ($1, $2, 1)
       ON CONFLICT (org_domain) DO UPDATE
         SET last_replied_at = EXCLUDED.last_replied_at, replies_total = d.replies_total + 1
         WHERE d.opted_out_at IS NULL
           AND (d.last_replied_at IS NULL
                OR d.last_replied_at < EXCLUDED.last_replied_at - interval '30 days')
       RETURNING org_domain`,
      [input.orgDomain, input.now],
    );
    if ((claimed.rowCount ?? 0) === 0) {
      // An opt-out may have landed since the read above; it outranks the throttle.
      const again = await db.query<{ opted: boolean }>(
        `SELECT opted_out_at IS NOT NULL AS opted FROM spambank.autoreply_domain WHERE org_domain = $1`,
        [input.orgDomain],
      );
      return await commitDecision(
        db,
        input,
        again.rows[0]?.opted === true ? "opted_out" : "throttled",
      );
    }

    // Check 10: the global daily cap, enforced by the database.
    let counted: number;
    try {
      const day = await db.query(
        `INSERT INTO spambank.autoreply_day AS d (day, sent) VALUES ($1::date, 1)
         ON CONFLICT (day) DO UPDATE SET sent = d.sent + 1
           WHERE d.sent < (SELECT c.daily_cap FROM spambank.control c)
         RETURNING sent`,
        [utcDay(input.now)],
      );
      counted = day.rowCount ?? 0;
    } catch (error) {
      if (sqlState(error) !== CHECK_VIOLATION) throw error;
      counted = 0;
    }
    if (counted === 0) return await rollbackAndRecord(db, input, "daily_cap");

    if (input.mode === "dry_run") return await rollbackAndRecord(db, input, "would_send");

    const reply = input.reply;
    if (reply === undefined) throw new Error(`mode ${input.mode} needs the reply row`);
    await db.query(
      `INSERT INTO spambank.autoreply
         (id, org_domain, to_address, source_mailbox_id, source_email_id, message_id, mode, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8)`,
      [
        reply.id,
        input.orgDomain,
        reply.toAddress,
        input.mailboxId,
        input.emailId,
        reply.messageId,
        input.mode,
        input.now,
      ],
    );
    await recordDecision(db, input.mailboxId, input.emailId, SENDING);
    await db.query("COMMIT");
    return { status: "claimed" };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
