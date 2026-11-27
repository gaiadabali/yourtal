import type { Queryable } from "./db";
import { ingestMailbox } from "./ingest-mailbox";
import type { IngestDeps } from "./ingest-mailbox";

/**
 * BUILD.md B5: every minute, `Email/changes` for every active mailbox. This is what makes Stalwart's webhook
 * non-critical: a webhook that never arrives, or whose payload nobody could read, delays mail by a minute.
 */
export interface ReconcileOptions {
  /** Stop starting new mailboxes after this long; the rest wait for the next minute (they are read oldest-first). */
  readonly budgetMs?: number;
  readonly concurrency?: number;
}

export interface ReconcileResult {
  readonly mailboxes: number;
  readonly processed: number;
  readonly unavailable: number;
  /** The run stopped early because Stalwart answered nothing for several mailboxes in a row. */
  readonly stalwartDown: boolean;
  readonly autoreplies: readonly { readonly mailboxId: string; readonly emailId: string }[];
  readonly eventsQueued: number;
}

/** Mailboxes in the order that serves the longest-waiting first. */
export async function activeMailboxIds(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM spambank.mailbox WHERE status = 'active'
      ORDER BY last_ingested_at ASC NULLS FIRST, created_at ASC`,
  );
  return rows.map((row) => row.id);
}

/** Consecutive "Stalwart did not answer" results that end a run: one dead server is not N log lines. */
const GIVE_UP_AFTER = 3;

export async function reconcileMailboxes(
  deps: IngestDeps,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const budgetMs = options.budgetMs ?? 50_000;
  const workers = Math.max(1, options.concurrency ?? 4);
  const ids = await activeMailboxIds(deps.pool);
  const started = Date.now();
  const autoreplies: { mailboxId: string; emailId: string }[] = [];
  let next = 0;
  let done = 0;
  let processed = 0;
  let unavailable = 0;
  let inARow = 0;
  let eventsQueued = 0;
  let stalwartDown = false;

  async function worker(): Promise<void> {
    while (!stalwartDown && Date.now() - started < budgetMs) {
      const id = ids[next];
      next += 1;
      if (id === undefined) return;
      const result = await ingestMailbox(deps, id);
      done += 1;
      processed += result.processed;
      eventsQueued += result.eventsQueued;
      for (const emailId of result.autoreplyEmailIds) autoreplies.push({ mailboxId: id, emailId });
      if (result.status === "unavailable") {
        unavailable += 1;
        inARow = result.detail === "unavailable" ? inARow + 1 : 0;
        if (inARow >= GIVE_UP_AFTER) stalwartDown = true;
      } else {
        inARow = 0;
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return { mailboxes: done, processed, unavailable, stalwartDown, autoreplies, eventsQueued };
}
