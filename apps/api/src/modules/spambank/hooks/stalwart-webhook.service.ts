import { Inject, Injectable, Logger } from "@nestjs/common";
import { SPAMBANK_CONFIG } from "../spambank.tokens";
import type { SpambankConfig } from "../../../config/spambank-config";
import { SpambankDb } from "../spambank-db";
import { SPAMBANK_JOB_QUEUE } from "./job-queue";
import type { SpambankJobQueue } from "./job-queue";
import { extractWebhookHints } from "./webhook-payload";
import type { WebhookHints } from "./webhook-payload";

const logger = new Logger("StalwartWebhook");

/** The system account's addresses (BUILD.md §4.6): bounces, complaints and answers arrive here. */
const REPLY_LOCAL_PARTS = ["reply", "abuse", "postmaster"];

export interface WebhookAction {
  readonly ingest: readonly string[];
  readonly replyInbox: boolean;
  readonly reconcile: boolean;
}

/**
 * What to do about one delivery (BUILD.md §5.4): map the recipients (or account ids) it names to active
 * mailboxes and queue one read of each; mail for the `reply` system account goes to T7's job; a delivery
 * that names nobody we know, or whose shape is not understood, queues a reconcile of everyone instead.
 * Never throws for a payload: the reconcile is the safety net.
 */
export function planWebhook(
  hints: WebhookHints,
  mailboxes: readonly { readonly id: string }[],
  replyDomain: string,
): WebhookAction {
  const replyInbox = hints.addresses.some((address) => {
    const at = address.lastIndexOf("@");
    return (
      at > 0 &&
      address.slice(at + 1) === replyDomain.toLowerCase() &&
      REPLY_LOCAL_PARTS.includes(address.slice(0, at))
    );
  });
  const ingest = [...new Set(mailboxes.map((mailbox) => mailbox.id))];
  const nothingToRead = hints.relevantEvents === 0;
  return {
    ingest,
    replyInbox,
    reconcile: !nothingToRead && ingest.length === 0 && !replyInbox,
  };
}

@Injectable()
export class StalwartWebhookService {
  constructor(
    @Inject(SpambankDb) private readonly db: SpambankDb,
    @Inject(SPAMBANK_JOB_QUEUE) private readonly queue: SpambankJobQueue,
    @Inject(SPAMBANK_CONFIG) private readonly config: SpambankConfig,
  ) {}

  /** Handles one verified delivery. Resolves whatever happens: the sender is told 202 either way. */
  async handle(body: unknown): Promise<WebhookAction> {
    const hints = extractWebhookHints(body);
    if (hints.relevantEvents > 0 && hints.accountIds.length + hints.addresses.length === 0) {
      // The shape is not one we can map (U4 is unverified): keys and types only, no values.
      logger.warn(`webhook with no account or recipient we recognise; shape=${hints.shape}`);
    }
    let action: WebhookAction = { ingest: [], replyInbox: false, reconcile: false };
    try {
      const mailboxes = await this.lookup(hints);
      action = planWebhook(hints, mailboxes, this.config.replyDomain);
      for (const id of action.ingest) await this.queue.ingest(id);
      if (action.replyInbox) await this.queue.replyInbox();
      if (action.reconcile) await this.queue.reconcile();
    } catch (error) {
      // The reconcile reads the mail within a minute whatever happened here.
      logger.error(
        `webhook could not be queued; the reconcile will read the mail: ${error instanceof Error ? error.message : "?"}`,
      );
    }
    return action;
  }

  private async lookup(hints: WebhookHints): Promise<{ id: string }[]> {
    if (hints.accountIds.length === 0 && hints.addresses.length === 0) return [];
    const { rows } = await this.db.pool.query<{ id: string }>(
      `SELECT id FROM spambank.mailbox
        WHERE status = 'active'
          AND (stalwart_account_id = ANY($1::text[])
               OR lower(local_part || '@' || domain) = ANY($2::text[]))`,
      [hints.accountIds, hints.addresses],
    );
    return rows;
  }
}
