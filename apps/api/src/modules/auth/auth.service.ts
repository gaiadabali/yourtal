import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { hashPassword, verifyPassword } from "./crypto/password-hash";
import { hashOpaqueToken, issueOpaqueToken } from "./crypto/opaque-token";
import { DevTokenAccess } from "./dev-token-access";
import { normalizeEmail } from "./email";
import {
  CREDENTIAL_REPOSITORY,
  PASSWORD_CREDENTIAL_KIND,
} from "./persistence/credential.repository";
import type { CredentialRepository } from "./persistence/credential.repository";
import { VERIFICATION_TOKEN_REPOSITORY } from "./persistence/verification-token.repository";
import type { VerificationTokenRepository } from "./persistence/verification-token.repository";
import { SessionService } from "./session/session.service";
import {
  ACCOUNT_THROTTLE_LIMITS,
  SOURCE_THROTTLE_LIMITS,
  ThrottleService,
} from "./throttle/throttle.service";
import type {
  ChangePasswordError,
  ConfirmEmailVerificationError,
  ConfirmPasswordResetError,
  EmailAlreadyRegisteredError,
  LoginError,
  LogoutError,
  RegisterError,
  RequestEmailVerificationError,
  RequestPasswordResetError,
} from "./auth.errors";

/**
 * A fixed, precomputed Argon2id hash of a value that is not, and will
 * never be, anyone's password. Verified against on a login attempt for an
 * email with NO credential row, so that "no such account" and "wrong
 * password" cost the same wall-clock time — an Argon2id verify against a
 * missing row would otherwise return in microseconds while a real mismatch
 * takes the KDF's full cost, and that timing gap is itself an enumeration
 * oracle even though the *response* is already identical
 * (`InvalidCredentialsError` has one case, not two). Computed once, ahead
 * of time, rather than at each cold path: hashing it per-request would
 * defeat the point by adding a SECOND KDF call to the branch that is
 * already the cheap one.
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$cqXfEYHu4vkW5EqeruruJg$rEdcH3NnTDRCLe8JgjzOoh1sEUBduP5wqVLbutFbdB0";

/** 1 hour — short, because a reset link is meant to be used immediately. */
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/** 24 hours — long, because an inbox is not always checked right away. */
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger("AuthService");

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(VERIFICATION_TOKEN_REPOSITORY)
    private readonly verificationTokens: VerificationTokenRepository,
    private readonly sessions: SessionService,
    private readonly throttle: ThrottleService,
    private readonly devTokenAccess: DevTokenAccess,
  ) {}

  async register(
    email: string,
    password: string,
  ): Promise<Result<{ userId: string }, RegisterError>> {
    const identifier = normalizeEmail(email);
    return this.guarded(async () => {
      // Opaque, minted here — never derived from `identifier` — see the
      // migration header for why `user_id` cannot be the email itself.
      const userId = randomUUID();
      const secretHash = await hashPassword(password);
      const created = await this.credentials.create({
        userId,
        kind: PASSWORD_CREDENTIAL_KIND,
        identifier,
        secretHash,
      });
      if (!created) {
        const conflict: EmailAlreadyRegisteredError = { type: "email_already_registered" };
        return err(conflict);
      }
      return ok({ userId });
    });
  }

  /**
   * Throttled on account (by a hash of the normalised email — never the
   * plaintext address, so a Valkey `KEYS`/`SCAN` by an operator does not
   * turn into an email list) AND source (the caller's IP) independently.
   * Either being over its limit refuses the attempt before Argon2id is
   * ever invoked — see `ThrottleService.peek`'s own doc comment for why
   * checking first matters.
   */
  async login(
    email: string,
    password: string,
    sourceIp: string,
    now: Date,
  ): Promise<Result<{ token: string; userId: string }, LoginError>> {
    const identifier = normalizeEmail(email);
    // Throttled on the ATTEMPTED identifier, not on `user_id` — a login
    // attempt for an email with no credential row still has to be rate
    // limited, and `user_id` does not exist yet (or ever, for a guess) to
    // key on.
    const accountKey = hashForThrottleKey(identifier);

    const [accountVerdict, sourceVerdict] = await Promise.all([
      this.throttle.peek("account", accountKey, ACCOUNT_THROTTLE_LIMITS),
      this.throttle.peek("source", sourceIp, SOURCE_THROTTLE_LIMITS),
    ]);
    const blocked = [accountVerdict, sourceVerdict].find((v) => v.blocked);
    if (blocked?.blocked === true) {
      return err({ type: "throttled", retryAfterSeconds: blocked.retryAfterSeconds ?? 900 });
    }

    return this.guarded(async () => {
      // The one indirection opacity costs: look up by (kind, identifier) to
      // learn `user_id`, THEN verify the hash — see the migration header.
      const credential = await this.credentials.findByKindAndIdentifier(
        PASSWORD_CREDENTIAL_KIND,
        identifier,
      );

      // Constant-shape check even when there is nothing to check against —
      // see `DUMMY_PASSWORD_HASH`'s own doc comment.
      const valid = await verifyPassword(credential?.secretHash ?? DUMMY_PASSWORD_HASH, password);

      if (credential === null || !valid) {
        await Promise.all([
          this.throttle.recordFailure("account", accountKey, ACCOUNT_THROTTLE_LIMITS),
          this.throttle.recordFailure("source", sourceIp, SOURCE_THROTTLE_LIMITS),
        ]);
        return err({ type: "invalid_credentials" });
      }

      // A genuine success clears the ACCOUNT counter only — never the
      // source counter. See `ThrottleService.reset`'s own doc comment.
      await this.throttle.reset("account", accountKey);
      const token = await this.sessions.issue(credential.userId, now);
      return ok({ token, userId: credential.userId });
    });
  }

  /** Idempotent: logging out twice, or logging out a token that was never
   * valid, both report success — there is nothing a caller could do wrong
   * here that is worth surfacing as an error. */
  async logout(token: string, now: Date): Promise<Result<void, LogoutError>> {
    return this.guarded(async () => {
      await this.sessions.revoke(token, now);
      return ok(undefined);
    });
  }

  /**
   * Rotation on privilege change: every OTHER session for this user is
   * revoked as part of the same operation, and the caller is handed a
   * fresh one — see `SessionService.revokeAllForUser`'s own doc comment
   * for why the caller's current session is not special-cased out of that.
   */
  async changePassword(
    sessionToken: string,
    currentPassword: string,
    newPassword: string,
    now: Date,
  ): Promise<Result<{ token: string }, ChangePasswordError>> {
    const validation = await this.sessions.validateAndTouch(sessionToken, now);
    if (!validation.valid) {
      return err({ type: "session_invalid" });
    }
    const { userId } = validation;

    return this.guarded(async () => {
      const credential = await this.credentials.findByUserAndKind(userId, PASSWORD_CREDENTIAL_KIND);
      // Defensive: a session cannot exist today for a user with no
      // password credential, because sessions are only ever minted after a
      // password authenticates (register/login/reset). Treated as a
      // credential mismatch rather than a crash if that ever stops being
      // true.
      const valid =
        credential !== null && (await verifyPassword(credential.secretHash, currentPassword));
      if (!valid) {
        return err({ type: "invalid_credentials" });
      }

      const newHash = await hashPassword(newPassword);
      await this.credentials.updateSecret(userId, PASSWORD_CREDENTIAL_KIND, newHash);
      await this.sessions.revokeAllForUser(userId, now);
      const token = await this.sessions.issue(userId, now);
      return ok({ token });
    });
  }

  /**
   * ALWAYS reports success, whether or not the email is registered — the
   * one operation in this module with no branch a caller can observe. A
   * response that differed for "no such account" would make this endpoint
   * an email-enumeration oracle, exactly the failure YT-0033's own AC names
   * for the phone-OTP flow this one precedes.
   */
  async requestPasswordReset(
    email: string,
    now: Date,
  ): Promise<Result<void, RequestPasswordResetError>> {
    const identifier = normalizeEmail(email);
    return this.guarded(async () => {
      const credential = await this.credentials.findByKindAndIdentifier(
        PASSWORD_CREDENTIAL_KIND,
        identifier,
      );
      if (credential !== null) {
        const { token, hash } = issueOpaqueToken();
        await this.verificationTokens.create({
          id: hash,
          userId: credential.userId,
          purpose: "password_reset",
          expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
        });
        this.deliver("password_reset", credential.userId, token);
      }
      return ok(undefined);
    });
  }

  /** Also rotates every session, and hands back a fresh one — a password
   * reset is exactly as privilege-relevant as a password change. */
  async confirmPasswordReset(
    rawToken: string,
    newPassword: string,
    now: Date,
  ): Promise<Result<{ token: string }, ConfirmPasswordResetError>> {
    const consumed = await this.verificationTokens.consume(
      hashOpaqueToken(rawToken),
      "password_reset",
      now,
    );
    if (!consumed.consumed) {
      this.logger.warn(`password reset token refused: ${consumed.refusal}`);
      return err({ type: "token_invalid" });
    }
    const { userId } = consumed;

    return this.guarded(async () => {
      const newHash = await hashPassword(newPassword);
      await this.credentials.updateSecret(userId, PASSWORD_CREDENTIAL_KIND, newHash);
      await this.sessions.revokeAllForUser(userId, now);
      const token = await this.sessions.issue(userId, now);
      return ok({ token });
    });
  }

  async requestEmailVerification(
    sessionToken: string,
    now: Date,
  ): Promise<Result<void, RequestEmailVerificationError>> {
    const validation = await this.sessions.validateAndTouch(sessionToken, now);
    if (!validation.valid) {
      return err({ type: "session_invalid" });
    }
    const { userId } = validation;

    return this.guarded(async () => {
      const { token, hash } = issueOpaqueToken();
      await this.verificationTokens.create({
        id: hash,
        userId,
        purpose: "email_verification",
        expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
      });
      this.deliver("email_verification", userId, token);
      return ok(undefined);
    });
  }

  /**
   * Consumes the token and nothing else. There is nowhere in the decided
   * schema to record "this address is verified" durably — no such column
   * exists on any of the four tables, and `principal.ts` has no
   * `isEmailVerified` attribute for Cerbos to read either. What this
   * proves is that, at this moment, whoever holds the token controls the
   * inbox `identity.verification_token.user_id` names; that fact is
   * auditable later only via `consumed_at` on this row. Recorded in this
   * ticket's report as a real gap, not silently worked around with an
   * invented column.
   */
  async confirmEmailVerification(
    rawToken: string,
    now: Date,
  ): Promise<Result<void, ConfirmEmailVerificationError>> {
    const consumed = await this.verificationTokens.consume(
      hashOpaqueToken(rawToken),
      "email_verification",
      now,
    );
    if (!consumed.consumed) {
      this.logger.warn(`email verification token refused: ${consumed.refusal}`);
      return err({ type: "token_invalid" });
    }
    return ok(undefined);
  }

  /**
   * Stand-in for a real delivery channel. `YT-0538`'s own AC for its
   * simulators states the pattern this now follows too: *"never printed
   * into ordinary logs"*. See `dev-token-access.ts`'s own doc for why that
   * used to be a `nodeEnv` branch and is not one any more — `token` is
   * passed to `devTokenAccess.record`, never to `this.logger`. Wiring this
   * to a real or simulated messaging boundary (the `messaging` boundary
   * `packages/drivers` already catalogues) is explicitly NOT done here —
   * see this ticket's report.
   */
  private deliver(
    purpose: "password_reset" | "email_verification",
    userId: string,
    token: string,
  ): void {
    // `userId` is already opaque (a minted UUID, not the email) — no
    // hashing needed here the way `hashForThrottleKey` needs it for the
    // ATTEMPTED identifier in `login`/throttle keys. Logged at both levels
    // — neither one gets the token; only that issuance happened.
    this.logger.log(`${purpose} token issued for ${userId}`);
    this.logger.debug(`${purpose} token issued for ${userId}`);
    this.devTokenAccess.record(purpose, userId, token);
  }

  /** One place every method wraps an unexpected store failure. */
  private async guarded<T, E extends { type: string }>(
    body: () => Promise<Result<T, E>>,
  ): Promise<Result<T, E | { type: "persistence_failed"; cause: string }>> {
    try {
      return await body();
    } catch (cause) {
      return err({ type: "persistence_failed", cause: String(cause) });
    }
  }
}

/**
 * Never the plaintext email as a Valkey key — an operator listing throttle
 * keys should not get a mailing list for free. Takes the normalised
 * identifier being attempted (not `user_id`, which is opaque and may not
 * even exist yet for a guessed email) — throttling has to key on what a
 * caller presents, not on an account record that might not be there.
 */
function hashForThrottleKey(identifier: string): string {
  return createHash("sha256").update(identifier, "utf8").digest("hex");
}
