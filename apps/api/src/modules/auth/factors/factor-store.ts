import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { REDIS_CLIENT } from "../../../shared/redis/redis-client.module";
import type { AuthMethod } from "../session/amr";

/** A password sign-in waiting for its second factor. */
export interface PendingSignIn {
  readonly userId: string;
  readonly amr: readonly AuthMethod[];
  /** The password was just set by a reset (an emailed link). */
  readonly viaReset?: boolean;
}

/** An authenticator app being set up: the sealed seed, until its first code. */
export interface PendingEnrolment {
  readonly userId: string;
  readonly sealedSeed: string;
}

export const FACTOR_STORE = Symbol("FACTOR_STORE");

/**
 * Short-lived, single-use state for sign-in ceremonies: WebAuthn challenges,
 * a password sign-in waiting for its code, the last authenticator time step
 * each account used, and step-up proofs. Every `take*` deletes as it reads,
 * so a challenge answers one ceremony at most, and every counter is reserved
 * before the attempt it counts is checked.
 */
export interface FactorStore {
  putChallenge(key: string, value: string, ttlSeconds: number): Promise<void>;
  takeChallenge(key: string): Promise<string | null>;
  putPending(tokenHash: string, pending: PendingSignIn, ttlSeconds: number): Promise<void>;
  readPending(tokenHash: string): Promise<PendingSignIn | null>;
  dropPending(tokenHash: string): Promise<void>;
  /** Counts an attempt on one pending sign-in before it is checked; returns the new total. */
  reservePendingAttempt(tokenHash: string, ttlSeconds: number): Promise<number>;
  /**
   * Records `step` as this account's last accepted code step, only if it is
   * later than the one recorded (RFC 6238 §5.2). False: the same or an
   * earlier step was already used, so the code is a replay.
   */
  advanceTotpStep(userId: string, step: number, ttlSeconds: number): Promise<boolean>;
  /** The session (by token hash) proved a second factor just now. */
  grantStepUp(sessionHash: string, userId: string, ttlSeconds: number): Promise<void>;
  hasStepUp(sessionHash: string, userId: string): Promise<boolean>;
  /** The session (by token hash) came from a password reset just now. */
  markResetProof(sessionHash: string, userId: string, ttlSeconds: number): Promise<void>;
  hasResetProof(sessionHash: string, userId: string): Promise<boolean>;
  /** An unfinished app enrolment, tied to the session that started it. */
  putEnrolment(sessionHash: string, enrolment: PendingEnrolment, ttlSeconds: number): Promise<void>;
  readEnrolment(sessionHash: string): Promise<PendingEnrolment | null>;
  dropEnrolment(sessionHash: string): Promise<void>;
}

const PREFIX = "yt:auth:factor";

/** Compare-and-set in one round trip, so two codes in flight cannot both pass. */
const ADVANCE_STEP = `
local current = redis.call('GET', KEYS[1])
if current and tonumber(current) >= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1`;

@Injectable()
export class RedisFactorStore implements FactorStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async putChallenge(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(`${PREFIX}:challenge:${key}`, value, "EX", ttlSeconds);
  }

  async takeChallenge(key: string): Promise<string | null> {
    return this.redis.getdel(`${PREFIX}:challenge:${key}`);
  }

  async putPending(tokenHash: string, pending: PendingSignIn, ttlSeconds: number): Promise<void> {
    await this.redis.set(
      `${PREFIX}:pending:${tokenHash}`,
      JSON.stringify(pending),
      "EX",
      ttlSeconds,
    );
  }

  async readPending(tokenHash: string): Promise<PendingSignIn | null> {
    const raw = await this.redis.get(`${PREFIX}:pending:${tokenHash}`);
    return raw === null ? null : (JSON.parse(raw) as PendingSignIn);
  }

  async dropPending(tokenHash: string): Promise<void> {
    await this.redis.del(`${PREFIX}:pending:${tokenHash}`, `${PREFIX}:pending-tries:${tokenHash}`);
  }

  async reservePendingAttempt(tokenHash: string, ttlSeconds: number): Promise<number> {
    const key = `${PREFIX}:pending-tries:${tokenHash}`;
    const results = await this.redis.multi().incr(key).expire(key, ttlSeconds).exec();
    return Number(results?.[0]?.[1] ?? Number.POSITIVE_INFINITY);
  }

  async advanceTotpStep(userId: string, step: number, ttlSeconds: number): Promise<boolean> {
    const advanced = await this.redis.eval(
      ADVANCE_STEP,
      1,
      `${PREFIX}:totp-step:${userId}`,
      String(step),
      String(ttlSeconds),
    );
    return Number(advanced) === 1;
  }

  async grantStepUp(sessionHash: string, userId: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(`${PREFIX}:step-up:${sessionHash}`, userId, "EX", ttlSeconds);
  }

  async hasStepUp(sessionHash: string, userId: string): Promise<boolean> {
    return (await this.redis.get(`${PREFIX}:step-up:${sessionHash}`)) === userId;
  }

  async markResetProof(sessionHash: string, userId: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(`${PREFIX}:reset-proof:${sessionHash}`, userId, "EX", ttlSeconds);
  }

  async hasResetProof(sessionHash: string, userId: string): Promise<boolean> {
    return (await this.redis.get(`${PREFIX}:reset-proof:${sessionHash}`)) === userId;
  }

  async putEnrolment(
    sessionHash: string,
    enrolment: PendingEnrolment,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(
      `${PREFIX}:enrolment:${sessionHash}`,
      JSON.stringify(enrolment),
      "EX",
      ttlSeconds,
    );
  }

  async readEnrolment(sessionHash: string): Promise<PendingEnrolment | null> {
    const raw = await this.redis.get(`${PREFIX}:enrolment:${sessionHash}`);
    return raw === null ? null : (JSON.parse(raw) as PendingEnrolment);
  }

  async dropEnrolment(sessionHash: string): Promise<void> {
    await this.redis.del(`${PREFIX}:enrolment:${sessionHash}`);
  }
}

/** In-memory, for unit tests. Expiry is not modelled; each call is atomic. */
export class InMemoryFactorStore implements FactorStore {
  private readonly challenges = new Map<string, string>();
  private readonly pending = new Map<string, PendingSignIn>();
  private readonly tries = new Map<string, number>();
  private readonly steps = new Map<string, number>();
  private readonly stepUps = new Map<string, string>();
  private readonly resetProofs = new Map<string, string>();
  readonly enrolments = new Map<string, PendingEnrolment>();

  putChallenge(key: string, value: string): Promise<void> {
    this.challenges.set(key, value);
    return Promise.resolve();
  }

  takeChallenge(key: string): Promise<string | null> {
    const value = this.challenges.get(key) ?? null;
    this.challenges.delete(key);
    return Promise.resolve(value);
  }

  putPending(tokenHash: string, pending: PendingSignIn): Promise<void> {
    this.pending.set(tokenHash, pending);
    return Promise.resolve();
  }

  readPending(tokenHash: string): Promise<PendingSignIn | null> {
    return Promise.resolve(this.pending.get(tokenHash) ?? null);
  }

  dropPending(tokenHash: string): Promise<void> {
    this.pending.delete(tokenHash);
    this.tries.delete(tokenHash);
    return Promise.resolve();
  }

  reservePendingAttempt(tokenHash: string): Promise<number> {
    const next = (this.tries.get(tokenHash) ?? 0) + 1;
    this.tries.set(tokenHash, next);
    return Promise.resolve(next);
  }

  advanceTotpStep(userId: string, step: number): Promise<boolean> {
    const last = this.steps.get(userId);
    if (last !== undefined && last >= step) return Promise.resolve(false);
    this.steps.set(userId, step);
    return Promise.resolve(true);
  }

  grantStepUp(sessionHash: string, userId: string): Promise<void> {
    this.stepUps.set(sessionHash, userId);
    return Promise.resolve();
  }

  hasStepUp(sessionHash: string, userId: string): Promise<boolean> {
    return Promise.resolve(this.stepUps.get(sessionHash) === userId);
  }

  markResetProof(sessionHash: string, userId: string): Promise<void> {
    this.resetProofs.set(sessionHash, userId);
    return Promise.resolve();
  }

  hasResetProof(sessionHash: string, userId: string): Promise<boolean> {
    return Promise.resolve(this.resetProofs.get(sessionHash) === userId);
  }

  putEnrolment(sessionHash: string, enrolment: PendingEnrolment): Promise<void> {
    this.enrolments.set(sessionHash, enrolment);
    return Promise.resolve();
  }

  readEnrolment(sessionHash: string): Promise<PendingEnrolment | null> {
    return Promise.resolve(this.enrolments.get(sessionHash) ?? null);
  }

  dropEnrolment(sessionHash: string): Promise<void> {
    this.enrolments.delete(sessionHash);
    return Promise.resolve();
  }
}
