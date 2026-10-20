import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { REDIS_CLIENT } from "../../../shared/redis/redis-client.module";
import type { AuthMethod } from "../session/amr";

/** A password sign-in waiting for its second factor. */
export interface PendingSignIn {
  readonly userId: string;
  readonly amr: readonly AuthMethod[];
}

export const FACTOR_STORE = Symbol("FACTOR_STORE");

/**
 * Short-lived, single-use state for sign-in ceremonies: WebAuthn challenges,
 * a password sign-in waiting for its code, and the authenticator time steps
 * already used. Every `take*` deletes as it reads, so a challenge answers
 * one ceremony at most.
 */
export interface FactorStore {
  putChallenge(key: string, challenge: string, ttlSeconds: number): Promise<void>;
  takeChallenge(key: string): Promise<string | null>;
  putPending(tokenHash: string, pending: PendingSignIn, ttlSeconds: number): Promise<void>;
  readPending(tokenHash: string): Promise<PendingSignIn | null>;
  dropPending(tokenHash: string): Promise<void>;
  /** Counts a wrong code against one pending sign-in; returns the new total. */
  countPendingFailure(tokenHash: string, ttlSeconds: number): Promise<number>;
  /** True the first time a (user, time step) is claimed, false on a replay. */
  claimTotpStep(userId: string, step: number, ttlSeconds: number): Promise<boolean>;
}

const PREFIX = "yt:auth:factor";

@Injectable()
export class RedisFactorStore implements FactorStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async putChallenge(key: string, challenge: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(`${PREFIX}:challenge:${key}`, challenge, "EX", ttlSeconds);
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
    await this.redis.del(`${PREFIX}:pending:${tokenHash}`, `${PREFIX}:pending-fail:${tokenHash}`);
  }

  async countPendingFailure(tokenHash: string, ttlSeconds: number): Promise<number> {
    const key = `${PREFIX}:pending-fail:${tokenHash}`;
    const [[, count]] = (await this.redis.multi().incr(key).expire(key, ttlSeconds).exec()) as [
      [Error | null, number],
    ];
    return count;
  }

  async claimTotpStep(userId: string, step: number, ttlSeconds: number): Promise<boolean> {
    const claimed = await this.redis.set(
      `${PREFIX}:totp-step:${userId}:${String(step)}`,
      "1",
      "EX",
      ttlSeconds,
      "NX",
    );
    return claimed !== null;
  }
}

/** In-memory, for unit tests. Expiry is not modelled. */
export class InMemoryFactorStore implements FactorStore {
  private readonly challenges = new Map<string, string>();
  private readonly pending = new Map<string, PendingSignIn>();
  private readonly failures = new Map<string, number>();
  private readonly steps = new Set<string>();

  putChallenge(key: string, challenge: string): Promise<void> {
    this.challenges.set(key, challenge);
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
    this.failures.delete(tokenHash);
    return Promise.resolve();
  }

  countPendingFailure(tokenHash: string): Promise<number> {
    const next = (this.failures.get(tokenHash) ?? 0) + 1;
    this.failures.set(tokenHash, next);
    return Promise.resolve(next);
  }

  claimTotpStep(userId: string, step: number): Promise<boolean> {
    const key = `${userId}:${String(step)}`;
    if (this.steps.has(key)) return Promise.resolve(false);
    this.steps.add(key);
    return Promise.resolve(true);
  }
}
