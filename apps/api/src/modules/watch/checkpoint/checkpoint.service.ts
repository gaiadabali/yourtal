import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  CHECKPOINT_TOKEN_TTL_MS,
  checkpointSchedule,
  issueCheckpointToken,
  newCheckpointNonce,
  verifyCheckpointToken,
} from "@yourtal/contracts/watch/checkpoint-token";
import type { Question } from "@yourtal/contracts/question/question";
import { pickQuestionForCheckpoint } from "../question/question-for-checkpoint";
import {
  CHECKPOINT_NONCE_REPOSITORY,
  type CheckpointNonceRepository,
} from "./persistence/checkpoint-nonce.repository";
import {
  CHECKPOINT_ISSUE_REPOSITORY,
  type CheckpointIssueRepository,
} from "./persistence/checkpoint-issue.repository";

/**
 * The signing key, injected rather than read from `process.env` here.
 *
 * Deliberately a token rather than a config lookup inside the service: a
 * module that reaches into the environment is one that cannot be
 * constructed with a different key in a test, and a signing service whose
 * key cannot be varied is one whose "wrong key is refused" test has to be
 * written against the real key or not at all.
 *
 * **It has no default and must not acquire one.** `env.schema.ts` records
 * why `DATABASE_URL` is required: a fallback is the thing tests quietly
 * select. That argument is sharper for a secret — a signing key with a
 * default in the repository is a key every reader of the repository holds,
 * so every checkpoint token in every environment that forgot to set it is
 * forgeable by anyone who has seen the source.
 */
export const CHECKPOINT_SECRET = Symbol("CHECKPOINT_SECRET");

export interface IssuedCheckpoint {
  readonly token: string;
  readonly expiresAtMs: number;
}

/**
 * Why a checkpoint could not be redeemed.
 *
 * Kept as distinct values INSIDE the service because a fraud review wants
 * to tell a replay from a second issuance, and deliberately collapsed to one
 * message at the HTTP boundary. YT-0153's enumeration discipline: a refusal
 * that names which check failed answers the prober's question for them.
 */
export type RedeemRefusal =
  | { readonly kind: "token_rejected"; readonly detail: string }
  | { readonly kind: "nonce_already_spent" }
  | { readonly kind: "checkpoint_already_answered" };

export type RedeemResult =
  | { readonly redeemed: true; readonly nonce: string; readonly expiresAtMs: number }
  | { readonly redeemed: false; readonly refusal: RedeemRefusal };

export interface RedeemInput {
  readonly token: string;
  readonly sessionId: string;
  readonly checkpointIndex: number;
  readonly nowMs: number;
}

@Injectable()
export class CheckpointService {
  private readonly logger = new Logger("CheckpointService");

  constructor(
    @Inject(CHECKPOINT_NONCE_REPOSITORY) private readonly nonces: CheckpointNonceRepository,
    @Inject(CHECKPOINT_ISSUE_REPOSITORY) private readonly issues: CheckpointIssueRepository,
    @Inject(CHECKPOINT_SECRET) private readonly secret: string,
  ) {}

  /** The checkpoint times for a session, in whole seconds. */
  schedule(sessionId: string, durationSeconds: number, count: number): readonly number[] {
    return checkpointSchedule({ sessionId, durationSeconds, count, secret: this.secret });
  }

  /**
   * Which question one checkpoint asks (5.2.b/c). Exposed here, rather than
   * making the signing secret public, so the controller never touches it
   * directly — the same reasoning `schedule` above already follows.
   */
  pickQuestion(
    bank: readonly Question[],
    sessionId: string,
    schedule: readonly number[],
    index: number,
  ): Question | null {
    return pickQuestionForCheckpoint(bank, sessionId, schedule, index, this.secret);
  }

  /**
   * EW-08: at most one LIVE token per (session, checkpoint) at a time. A
   * repeated call while the prior issuance is still live returns the SAME
   * token — `issueCheckpointToken` is pure over its claims, so replaying a
   * lost response needs no idempotency key of its own.
   */
  async issue(sessionId: string, checkpointIndex: number, nowMs: number): Promise<IssuedCheckpoint> {
    const fresh = {
      nonce: newCheckpointNonce(),
      expiresAtMs: nowMs + CHECKPOINT_TOKEN_TTL_MS,
    };
    const live = await this.issues.issueOnce(sessionId, checkpointIndex, fresh, nowMs);
    const token = issueCheckpointToken(
      { sessionId, checkpointIndex, nonce: live.nonce, expiresAtMs: live.expiresAtMs },
      this.secret,
    );
    return { token, expiresAtMs: live.expiresAtMs };
  }

  /**
   * Verifies a token and burns its nonce, in that order, as one operation a
   * caller cannot half-perform.
   *
   * The ordering is not arbitrary. Burning first would spend the nonce of a
   * token that turns out to be forged or expired — letting anyone invalidate
   * a checkpoint by presenting garbage for it. Verifying without burning
   * leaves the token replayable, which is the whole failure this exists to
   * prevent. So neither half is exposed on its own: there is no public
   * `verify`, because a caller who could reach it would eventually use it
   * and skip the burn.
   */
  async redeem(input: RedeemInput): Promise<RedeemResult> {
    const verdict = verifyCheckpointToken({
      token: input.token,
      secret: this.secret,
      sessionId: input.sessionId,
      checkpointIndex: input.checkpointIndex,
      nowMs: input.nowMs,
    });

    if (!verdict.accepted) {
      this.refuse(input, { kind: "token_rejected", detail: verdict.reason.kind });
      return { redeemed: false, refusal: { kind: "token_rejected", detail: verdict.reason.kind } };
    }

    const refused = await this.nonces.spend({
      nonce: verdict.claims.nonce,
      sessionId: input.sessionId,
      checkpointIndex: input.checkpointIndex,
      expiresAt: new Date(verdict.claims.expiresAtMs),
    });

    if (refused !== null) {
      this.refuse(input, { kind: refused });
      return { redeemed: false, refusal: { kind: refused } };
    }
    return { redeemed: true, nonce: verdict.claims.nonce, expiresAtMs: verdict.claims.expiresAtMs };
  }

  /**
   * Records a refusal server-side. AC3's second half — *rejected **and
   * logged*** — and the only place the distinction the caller is denied is
   * written down.
   *
   * The HTTP boundary collapses every refusal into one message, because a
   * response naming which check failed answers the prober's question for
   * them (YT-0153). That discipline protects the client side and destroys
   * the evidence, so it has to be recreated here: a fraud review needs to
   * tell a replay of one token from a viewer who collected two issuances for
   * one checkpoint, and those are `nonce_already_spent` and
   * `checkpoint_already_answered` respectively.
   *
   * ## Why `expired` is not a warning
   *
   * An expired token is what an honest viewer's idle tab produces. Warning
   * on it would be the loudest line in the log and mean nothing, and a
   * signal that fires constantly is one nobody reads — which is how the real
   * ones get buried. Everything else here is a shape an honest client does
   * not produce: a bad signature is hostile by construction, and a replay or
   * a second answer is either an attack or a bug worth finding.
   */
  private refuse(input: RedeemInput, refusal: RedeemRefusal): void {
    const where = `session=${input.sessionId} checkpoint=${String(input.checkpointIndex)}`;
    if (refusal.kind === "token_rejected" && refusal.detail === "expired") {
      this.logger.log(`checkpoint token expired — ${where}`);
      return;
    }
    const what =
      refusal.kind === "token_rejected" ? `token_rejected:${refusal.detail}` : refusal.kind;
    this.logger.warn(`checkpoint refused ${what} — ${where}`);
  }
}
