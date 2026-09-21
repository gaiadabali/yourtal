export const SESSION_REPOSITORY = Symbol("SESSION_REPOSITORY");

export interface StoredSession {
  readonly id: string; // hashed
  readonly userId: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface SessionRepository {
  create(input: { id: string; userId: string; absoluteExpiresAt: Date }): Promise<void>;

  /**
   * Looked up by the HASH of the presented token — `session.service.ts`
   * hashes before calling this, never the other way round. Returns a
   * session regardless of whether it is revoked or past its expiry: those
   * are the caller's decision to make (comparing `revokedAt`/
   * `absoluteExpiresAt`/`lastSeenAt` against policy constants), not this
   * repository's — see the migration header on why there is no stored
   * `isExpired` for this to filter on instead.
   */
  findById(id: string): Promise<StoredSession | null>;

  /** Idle-timeout evidence. A no-op if the session no longer exists. */
  touch(id: string, now: Date): Promise<void>;

  /** Idempotent: revoking an already-revoked session changes nothing. */
  revoke(id: string, now: Date): Promise<void>;

  /**
   * Rotation on privilege change (YT-0540's third criterion) — every live
   * session for this user_id is revoked in one statement, not fetched and
   * revoked one at a time, so a session created between "fetch" and "revoke
   * each" cannot survive the rotation by timing.
   */
  revokeAllForUser(userId: string, now: Date): Promise<void>;

  /** Past `absoluteExpiresAt`. Scheduled, never on the request path. */
  pruneExpired(now: Date): Promise<number>;
}
