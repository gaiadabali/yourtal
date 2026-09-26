import { and, eq } from "drizzle-orm";
import type { AppDb } from "../../../../shared/persistence/drizzle-client";
import { checkpointIssues } from "./checkpoint-issue.table";

export const CHECKPOINT_ISSUE_REPOSITORY = Symbol("CHECKPOINT_ISSUE_REPOSITORY");

export interface LiveIssuance {
  readonly nonce: string;
  readonly expiresAtMs: number;
}

/**
 * EW-08: at most one LIVE token per (session, checkpoint). See this
 * repository's own migration for the full reasoning.
 *
 * `issueOnce` is the whole interface, deliberately — there is no plain
 * `get`, for the same "no read before write" reason
 * `CheckpointNonceRepository` gives: a caller that could read first and
 * insert second would have a race between them. The one method does both:
 * if a live issuance already exists it is returned unchanged (a client
 * asking again after a lost response gets the SAME token back, since
 * `issueCheckpointToken` is pure over its claims); otherwise the supplied
 * fresh claims are written and returned.
 */
export interface CheckpointIssueRepository {
  issueOnce(
    sessionId: string,
    checkpointIndex: number,
    fresh: LiveIssuance,
    nowMs: number,
  ): Promise<LiveIssuance>;
}

export class DrizzleCheckpointIssueRepository implements CheckpointIssueRepository {
  constructor(private readonly db: AppDb) {}

  async issueOnce(
    sessionId: string,
    checkpointIndex: number,
    fresh: LiveIssuance,
    nowMs: number,
  ): Promise<LiveIssuance> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ nonce: checkpointIssues.nonce, expiresAt: checkpointIssues.expiresAt })
        .from(checkpointIssues)
        .where(
          and(
            eq(checkpointIssues.sessionId, sessionId),
            eq(checkpointIssues.checkpointIndex, checkpointIndex),
          ),
        )
        .for("update")
        .limit(1);

      const row = existing[0];
      if (row !== undefined && row.expiresAt.getTime() > nowMs) {
        // A live issuance already exists — hand back the SAME token rather
        // than minting a second one for a checkpoint that already has one
        // outstanding.
        return { nonce: row.nonce, expiresAtMs: row.expiresAt.getTime() };
      }

      if (row === undefined) {
        await tx.insert(checkpointIssues).values({
          sessionId,
          checkpointIndex,
          nonce: fresh.nonce,
          expiresAt: new Date(fresh.expiresAtMs),
        });
      } else {
        // The prior issuance expired unanswered (an idle tab). A fresh one
        // replaces it — nothing was ever spent, so nothing is lost by
        // reissuing.
        await tx
          .update(checkpointIssues)
          .set({ nonce: fresh.nonce, expiresAt: new Date(fresh.expiresAtMs) })
          .where(
            and(
              eq(checkpointIssues.sessionId, sessionId),
              eq(checkpointIssues.checkpointIndex, checkpointIndex),
            ),
          );
      }
      return fresh;
    });
  }
}
