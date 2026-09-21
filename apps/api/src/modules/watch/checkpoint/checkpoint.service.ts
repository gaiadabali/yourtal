import { Inject, Injectable } from "@nestjs/common";
import {
  CHECKPOINT_TOKEN_TTL_MS,
  checkpointSchedule,
  issueCheckpointToken,
  newCheckpointNonce,
  verifyCheckpointToken,
} from "@yourtal/contracts/watch/checkpoint-token";
import {
  CHECKPOINT_NONCE_REPOSITORY,
  type CheckpointNonceRepository,
} from "./persistence/checkpoint-nonce.repository";

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
  | { readonly redeemed: true; readonly nonce: string }
  | { readonly redeemed: false; readonly refusal: RedeemRefusal };

export interface RedeemInput {
  readonly token: string;
  readonly sessionId: string;
  readonly checkpointIndex: number;
  readonly nowMs: number;
}

@Injectable()
export class CheckpointService {
  constructor(
    @Inject(CHECKPOINT_NONCE_REPOSITORY) private readonly nonces: CheckpointNonceRepository,
    @Inject(CHECKPOINT_SECRET) private readonly secret: string,
  ) {}

  /** The checkpoint times for a session, in whole seconds. */
  schedule(sessionId: string, durationSeconds: number, count: number): readonly number[] {
    return checkpointSchedule({ sessionId, durationSeconds, count, secret: this.secret });
  }

  issue(sessionId: string, checkpointIndex: number, nowMs: number): IssuedCheckpoint {
    const expiresAtMs = nowMs + CHECKPOINT_TOKEN_TTL_MS;
    const token = issueCheckpointToken(
      { sessionId, checkpointIndex, nonce: newCheckpointNonce(), expiresAtMs },
      this.secret,
    );
    return { token, expiresAtMs };
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
      return { redeemed: false, refusal: { kind: "token_rejected", detail: verdict.reason.kind } };
    }

    const refused = await this.nonces.spend({
      nonce: verdict.claims.nonce,
      sessionId: input.sessionId,
      checkpointIndex: input.checkpointIndex,
      expiresAt: new Date(verdict.claims.expiresAtMs),
    });

    if (refused !== null) {
      return { redeemed: false, refusal: { kind: refused } };
    }
    return { redeemed: true, nonce: verdict.claims.nonce };
  }
}
