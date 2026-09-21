import { and, lt, sql } from "drizzle-orm";
import type { AppDb } from "../../../../shared/persistence/drizzle-client";
import { checkpointNonces } from "./checkpoint-nonce.table";

export const CHECKPOINT_NONCE_REPOSITORY = Symbol("CHECKPOINT_NONCE_REPOSITORY");

/**
 * Why a spend was refused.
 *
 * The two are distinguished internally because they mean different things to
 * a fraud review — the same token twice is a replay, two tokens for one
 * checkpoint is someone collecting issuances — and are deliberately NOT
 * distinguished to the caller's caller. YT-0153's enumeration discipline:
 * a refusal that says *which* check failed is a probe that answers itself.
 */
export type SpendRefusal = "nonce_already_spent" | "checkpoint_already_answered";

export interface CheckpointSpend {
  readonly nonce: string;
  readonly sessionId: string;
  readonly checkpointIndex: number;
  readonly expiresAt: Date;
}

/**
 * The record that makes a checkpoint token single-use. YT-0121.
 *
 * ## There is no `get`, and that is the design
 *
 * `packages/idempotency/src/store.ts` argues this at length for its own
 * store and the argument transfers unchanged: a `has()`-then-`insert()` pair
 * cannot be made safe. Two concurrent presentations of one token both read
 * "unspent", both insert, and both are accepted — the exact replay this
 * interface exists to prevent, reintroduced by the shape of the interface
 * rather than by any caller's mistake.
 *
 * So the only way to ask is to try: `spend` attempts the write and its
 * return value tells you whether you were first. An implementation that
 * cannot do that atomically is not a valid implementation.
 */
export interface CheckpointNonceRepository {
  /**
   * Burns a nonce. Returns `null` on success, or why it was refused.
   *
   * Must be atomic, and must enforce BOTH constraints — the nonce has not
   * been seen, and this checkpoint has not already been answered in this
   * session. The second is the one that matters: nonce uniqueness alone lets
   * a viewer request two tokens for checkpoint 3 and spend both, because
   * both carry different nonces and both are legitimately signed.
   */
  spend(spend: CheckpointSpend): Promise<SpendRefusal | null>;

  /** Removes rows past their expiry. Scheduled, never on the request path. */
  prune(now: Date): Promise<number>;
}

export class DrizzleCheckpointNonceRepository implements CheckpointNonceRepository {
  constructor(private readonly db: AppDb) {}

  async spend(spend: CheckpointSpend): Promise<SpendRefusal | null> {
    // `ON CONFLICT DO NOTHING` across BOTH unique constraints — the primary
    // key on `nonce` and `checkpoint_answered_once_per_session`. A bare
    // `onConflictDoNothing()` with no target covers every constraint on the
    // table, which is what is wanted here: either conflict means the spend
    // did not happen, and the returned rows tell us which.
    const inserted = await this.db
      .insert(checkpointNonces)
      .values({
        nonce: spend.nonce,
        sessionId: spend.sessionId,
        checkpointIndex: spend.checkpointIndex,
        spentAt: new Date(),
        expiresAt: spend.expiresAt,
      })
      .onConflictDoNothing()
      .returning({ nonce: checkpointNonces.nonce });

    if (inserted.length > 0) return null;

    // Lost the race, or a genuine replay. Which constraint stopped us is
    // worth knowing for a fraud review, so it is resolved with one extra
    // read — AFTER the write has already failed, so this read can no longer
    // be part of a check-then-act race.
    const existing = await this.db
      .select({ nonce: checkpointNonces.nonce })
      .from(checkpointNonces)
      .where(sql`${checkpointNonces.nonce} = ${spend.nonce}`)
      .limit(1);

    return existing.length > 0 ? "nonce_already_spent" : "checkpoint_already_answered";
  }

  async prune(now: Date): Promise<number> {
    // Safe past expiry, and only past expiry. The signature layer refuses an
    // expired token before this table is consulted, so a row that outlives
    // its `expires_at` protects against nothing and only grows.
    const removed = await this.db
      .delete(checkpointNonces)
      .where(and(lt(checkpointNonces.expiresAt, now)))
      .returning({ nonce: checkpointNonces.nonce });

    return removed.length;
  }
}
