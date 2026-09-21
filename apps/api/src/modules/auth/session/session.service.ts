import { Inject, Injectable } from "@nestjs/common";
import { hashOpaqueToken, issueOpaqueToken } from "../crypto/opaque-token";
import { SESSION_REPOSITORY } from "../persistence/session.repository";
import type { SessionRepository, StoredSession } from "../persistence/session.repository";

/**
 * Absolute lifetime ceiling — set once at issuance, never extended by
 * activity. 30 days: long enough that a consumer is not asked to log back
 * in every session, short enough that a stolen-but-unused session token
 * does not stay valid indefinitely.
 */
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Idle expiry — extended by `touch()` on every authenticated request.
 * Deliberately NOT stored as a column (see the migration header): this is
 * a policy constant `SessionService` compares `lastSeenAt` against, so
 * changing the window is a code change reviewed like any other, never a
 * per-row value that could disagree with itself across rows.
 */
export const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;

export type SessionValidation =
  | { readonly valid: true; readonly userId: string }
  | {
      readonly valid: false;
      readonly reason: "not_found" | "revoked" | "expired" | "idle_timeout";
    };

@Injectable()
export class SessionService {
  constructor(@Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository) {}

  /** Mints a new session and returns the raw token — stored nowhere else. */
  async issue(userId: string, now: Date): Promise<string> {
    const { token, hash } = issueOpaqueToken();
    await this.sessions.create({
      id: hash,
      userId,
      absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS),
    });
    return token;
  }

  /**
   * Validates a presented token and, on success, touches `lastSeenAt` —
   * the two happen together because a session that is about to be treated
   * as "used" should record that it was used, and a caller that only reads
   * would let idle expiry go stale.
   */
  async validateAndTouch(token: string, now: Date): Promise<SessionValidation> {
    const record = await this.lookup(token);
    if (record === null) {
      return { valid: false, reason: "not_found" };
    }
    if (record.revokedAt !== null) {
      return { valid: false, reason: "revoked" };
    }
    if (record.absoluteExpiresAt <= now) {
      return { valid: false, reason: "expired" };
    }
    if (now.getTime() - record.lastSeenAt.getTime() > SESSION_IDLE_TTL_MS) {
      return { valid: false, reason: "idle_timeout" };
    }
    await this.sessions.touch(record.id, now);
    return { valid: true, userId: record.userId };
  }

  /** Idempotent — revoking an already-revoked or unknown session is a no-op. */
  async revoke(token: string, now: Date): Promise<void> {
    await this.sessions.revoke(hashOpaqueToken(token), now);
  }

  /**
   * Rotation on privilege change (YT-0540's third criterion): every live
   * session for this user is revoked, including — deliberately — the one
   * the caller is currently using. A password change is exactly the moment
   * every OTHER holder of a session (a stolen token, a forgotten logged-in
   * device) should be forced to re-authenticate; the caller gets a fresh
   * session minted right after, in the same use-case, rather than this
   * method special-casing "except the current one".
   */
  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    await this.sessions.revokeAllForUser(userId, now);
  }

  private async lookup(token: string): Promise<StoredSession | null> {
    return this.sessions.findById(hashOpaqueToken(token));
  }
}
