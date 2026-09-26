import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG } from "../../../config/app-config.module";
import type { AppConfig } from "../../../config/app-config";
import { hashOpaqueToken, issueOpaqueToken } from "../crypto/opaque-token";
import { SESSION_REPOSITORY } from "../persistence/session.repository";
import type { SessionRepository, StoredSession } from "../persistence/session.repository";

/**
 * Which lifetime regime a session was issued under. 1.5.e, F12 "Sessions":
 * a staff account signs in through the exact same `/api/auth/login` a
 * consumer does (`pnpm staff:add` only grants an EXISTING account a role
 * row, 1.5.b — it does not create a separate login path), so the
 * distinction has to be decided at issuance, not assumed from the route.
 * `AuthService` is what actually knows which kind applies (it can read
 * `identity.staff_role`); this type is just the vocabulary the two share.
 */
export type SessionKind = "consumer" | "staff";

export type SessionValidation =
  | { readonly valid: true; readonly userId: string }
  | {
      readonly valid: false;
      readonly reason: "not_found" | "revoked" | "expired" | "idle_timeout";
    };

@Injectable()
export class SessionService {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Mints a new session and returns the raw token — stored nowhere else.
   *
   * `kind` picks the ABSOLUTE ceiling only — `config.session.staffAbsoluteTtlMs`
   * (12h, F12) is already far tighter than `consumerIdleTtlMs` (30 days), so
   * a staff session hits its absolute cap long before the shared idle check
   * in `validateAndTouch` could ever be the binding constraint. A second,
   * separately-configured staff IDLE window would be a number that can
   * never matter, not a real knob — see `env.schema.ts`'s own note.
   */
  async issue(userId: string, now: Date, kind: SessionKind = "consumer"): Promise<string> {
    const { token, hash } = issueOpaqueToken();
    const absoluteTtlMs =
      kind === "staff"
        ? this.config.session.staffAbsoluteTtlMs
        : this.config.session.consumerAbsoluteTtlMs;
    await this.sessions.create({
      id: hash,
      userId,
      absoluteExpiresAt: new Date(now.getTime() + absoluteTtlMs),
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
    if (now.getTime() - record.lastSeenAt.getTime() > this.config.session.consumerIdleTtlMs) {
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
