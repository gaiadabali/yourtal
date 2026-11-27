import { randomUUID } from "node:crypto";
import {
  SPAMBANK_EVENT_TTL_SECONDS,
  SPAMBANK_MAIL_EVENT,
  SPAMBANK_STATEMENT_EVENT,
} from "@yourtal/contracts/spambank/events";
import type { SpambankMailEvent, SpambankStatementEvent } from "@yourtal/contracts/spambank/events";
import type { EventReceiver } from "@yourtal/contracts/oidc/event-receivers";
import type { Queryable } from "./db";

/**
 * Writes a mail event for SnapApp into the Spambank outbox (BUILD.md B8, §5.5), never into
 * `oidc.event_outbox`: a new-mail alert stuck in retry there would hold back that person's
 * `account-deleted`. The payload is the SET's `events` claim; the delivery job signs it.
 */
export interface SnapappTarget {
  readonly receiver: EventReceiver;
  /** SnapApp's pairwise `sub` for this person. */
  readonly sub: string;
}

/**
 * The person's SnapApp `sub`, only while their consent to that app is live (`ended_at IS NULL`): an app the
 * person has left is never sent anything about their mail.
 */
export async function snapappTargetFor(
  db: Queryable,
  userId: string,
  receiver: EventReceiver | undefined,
): Promise<SnapappTarget | null> {
  if (receiver === undefined) return null;
  const { rows } = await db.query<{ sub: string }>(
    `SELECT s.sub FROM oidc.subject s
       JOIN oidc.app_consent c ON c.user_id = s.user_id AND c.sector = s.sector
      WHERE s.user_id = $1 AND s.sector = $2 AND c.ended_at IS NULL`,
    [userId, receiver.sector],
  );
  const sub = rows[0]?.sub;
  return sub === undefined ? null : { receiver, sub };
}

async function enqueue(
  db: Queryable,
  target: SnapappTarget,
  type: string,
  body: object,
  ttlSeconds: number,
  now: Date,
): Promise<string> {
  const jti = randomUUID();
  await db.query(
    `INSERT INTO spambank.app_event_outbox (jti, client_id, sub, event_type, payload, iat, expires_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6::timestamptz + make_interval(secs => $7))`,
    [
      jti,
      target.receiver.clientId,
      target.sub,
      type,
      JSON.stringify({ [type]: body }),
      now,
      ttlSeconds,
    ],
  );
  return jti;
}

export function enqueueMailEvent(
  db: Queryable,
  target: SnapappTarget,
  event: SpambankMailEvent,
  now: Date,
): Promise<string> {
  return enqueue(db, target, SPAMBANK_MAIL_EVENT, event, SPAMBANK_EVENT_TTL_SECONDS.mail, now);
}

export function enqueueStatementEvent(
  db: Queryable,
  target: SnapappTarget,
  event: SpambankStatementEvent,
  now: Date,
): Promise<string> {
  return enqueue(
    db,
    target,
    SPAMBANK_STATEMENT_EVENT,
    event,
    SPAMBANK_EVENT_TTL_SECONDS.statement,
    now,
  );
}
