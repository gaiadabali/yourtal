import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Logger } from "@nestjs/common";
import { Redis } from "ioredis";
import { eq } from "drizzle-orm";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppConfig } from "../../config/app-config";
import { AuthService } from "./auth.service";
import { SessionService } from "./session/session.service";
import {
  ThrottleService,
  ACCOUNT_THROTTLE_LIMITS,
  SOURCE_THROTTLE_LIMITS,
} from "./throttle/throttle.service";
import { DrizzleCredentialRepository } from "./persistence/drizzle-credential.repository";
import { DrizzleSessionRepository } from "./persistence/drizzle-session.repository";
import { DrizzleVerificationTokenRepository } from "./persistence/drizzle-verification-token.repository";
import { sessions as sessionsTable } from "./persistence/schema/session.table";
import { verificationTokens as verificationTokensTable } from "./persistence/schema/verification-token.table";
import { hashOpaqueToken, issueOpaqueToken } from "./crypto/opaque-token";

/**
 * `AuthService`, against the REAL Postgres and REAL Valkey this app runs
 * against everywhere else in `apps/api` (`TEST_DATABASE_URL`,
 * `env.schema.test.ts`'s own default for `REDIS_URL`) — not fakes. This
 * ticket's own verification bar is "prove it by breaking it, not by
 * reading it", so every test below either breaks a property directly
 * (reads the stored session row and checks it is not the raw token; feeds
 * back a tampered token; drives the throttle past its limit) or asserts a
 * concrete refusal reason — never `expect(x).not.toBe(...)` alone, which
 * would pass on an unrelated failure just as happily as on the real one.
 *
 * A helper `registerOk`/`loginAttempt` below wraps every setup call that
 * this file does not itself assert on — `must-use-result` (this repo's own
 * ESLint rule, YT-0500/docs/13b §4) refuses to let a `Result` go unread
 * even in a test, and `void (await ...)` at each call site would say
 * "discarding is intended" about calls whose failure WOULD in fact be a
 * bug in the fixture. The helpers assert success once, centrally, instead.
 */
const DATABASE_URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal";
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://127.0.0.1:26379";

const CONFIG = { nodeEnv: "test" } as unknown as AppConfig;

const db = createAppDb(DATABASE_URL);
const redis = new Redis(REDIS_URL);

const credentials = new DrizzleCredentialRepository(db);
const sessionRepo = new DrizzleSessionRepository(db);
const verificationTokens = new DrizzleVerificationTokenRepository(db);
const sessionService = new SessionService(sessionRepo);
const throttle = new ThrottleService(redis);
const auth = new AuthService(CONFIG, credentials, verificationTokens, sessionService, throttle);

function freshEmail(): string {
  return `auth-test-${randomUUID()}@example.com`;
}

/**
 * A unique per-call "source" for the throttle to key on. Not a real IPv4 —
 * `ThrottleService` treats it as an opaque string — and deliberately NOT
 * `203.0.113.x` with one random octet: 255 buckets across a dozen call
 * sites in this file collide constantly (the birthday problem, found by
 * running this suite rather than by reasoning about it), and a collision
 * silently merges two tests' throttle counters into one shared bucket.
 */
function randomIp(): string {
  return `test-source-${randomUUID()}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Registers an account and asserts it actually succeeded — a fixture
 * helper failing silently would make every test built on it meaningless. */
async function registerOk(email: string, password: string): Promise<void> {
  const result = await auth.register(email, password);
  expect(result.isOk()).toBe(true);
}

/** A login attempt whose outcome this particular call site does not care
 * about (only that the counters it drives get bumped) — still reads the
 * `Result` so `must-use-result` has something other than a bare call to
 * approve of. */
async function attemptLogin(email: string, password: string, ip: string): Promise<boolean> {
  const result = await auth.login(email, password, ip, new Date());
  return result.isOk();
}

afterAll(() => {
  redis.disconnect();
});

describe("register", () => {
  it("creates a credential and refuses a second registration for the same email", async () => {
    const email = freshEmail();
    const first = await auth.register(email, "correct-horse-battery-staple");
    expect(first.isOk()).toBe(true);

    const second = await auth.register(email, "a-totally-different-password");
    expect(second.isErr()).toBe(true);
    expect(second.isErr() && second.error.type).toBe("email_already_registered");
  });

  it("never stores the plaintext password", async () => {
    const email = freshEmail();
    const password = "correct-horse-battery-staple";
    await registerOk(email, password);

    const row = await credentials.findByKindAndIdentifier("password", email);
    expect(row).not.toBeNull();
    expect(row?.secretHash).not.toContain(password);
    expect(row?.secretHash.startsWith("$argon2id$")).toBe(true);
    // `user_id` is opaque now — prove it, rather than assume it: it must
    // not be (or contain) the email this credential was registered with.
    expect(row?.userId).not.toBe(email);
    expect(row?.userId).not.toContain("@");
  });
});

describe("login", () => {
  it("issues a token whose STORED session id is not the token itself", async () => {
    const email = freshEmail();
    const password = "correct-horse-battery-staple";
    await registerOk(email, password);

    const result = await auth.login(email, password, randomIp(), new Date());
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const { token } = result.value;
    // Broken, not read: look up the row Postgres actually holds and prove
    // the raw token is not recoverable from it.
    const expectedHash = hashOpaqueToken(token);
    const [row] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, expectedHash));
    expect(row).toBeDefined();
    expect(row?.id).not.toBe(token);
    expect(row?.id).toBe(expectedHash);
    expect(JSON.stringify(row)).not.toContain(token);
    // `user_id` is opaque — the stored session row must not carry the
    // email this account registered with, in any form.
    expect(JSON.stringify(row)).not.toContain(email);
    expect(row?.userId).not.toContain("@");
  });

  it("refuses a wrong password and a nonexistent account identically", async () => {
    const email = freshEmail();
    await registerOk(email, "correct-horse-battery-staple");
    const ip = randomIp();

    const wrongPassword = await auth.login(email, "not-the-password", ip, new Date());
    const noSuchAccount = await auth.login(freshEmail(), "not-the-password", ip, new Date());

    expect(wrongPassword.isErr() && wrongPassword.error.type).toBe("invalid_credentials");
    expect(noSuchAccount.isErr() && noSuchAccount.error.type).toBe("invalid_credentials");
  });

  it("locks out the ACCOUNT after repeated failures, independently of source", async () => {
    const email = freshEmail();
    await registerOk(email, "correct-horse-battery-staple");
    const attackerIp = randomIp();

    for (let i = 0; i < ACCOUNT_THROTTLE_LIMITS.maxAttempts; i += 1) {
      const attempt = await auth.login(email, "still-not-the-password", attackerIp, new Date());
      expect(attempt.isErr() && attempt.error.type).toBe("invalid_credentials");
    }

    // The NEXT attempt — even with the CORRECT password — is throttled, not
    // authenticated. A lockout that only blocks wrong passwords is not a
    // lockout at all.
    const blocked = await auth.login(email, "correct-horse-battery-staple", attackerIp, new Date());
    expect(blocked.isErr()).toBe(true);
    expect(blocked.isErr() && blocked.error.type).toBe("throttled");

    // A DIFFERENT account, attempted from the SAME source, is unaffected —
    // proving the account lock is per-account, not a blanket source ban.
    const otherEmail = freshEmail();
    await registerOk(otherEmail, "a-different-password-entirely");
    const otherAccount = await auth.login(
      otherEmail,
      "a-different-password-entirely",
      attackerIp,
      new Date(),
    );
    expect(otherAccount.isOk()).toBe(true);
  });

  it("locks out the SOURCE after repeated failures across DIFFERENT accounts", async () => {
    const attackerIp = randomIp();

    // A DISTINCT, never-registered email on every single attempt — each
    // one is a fresh "account" from the throttle's point of view, so no
    // individual account ever gets anywhere near its OWN limit
    // (`ACCOUNT_THROTTLE_LIMITS.maxAttempts`, five). What accumulates is
    // only the source counter, which is exactly the property this test is
    // about: one attacker trying many different accounts from one place.
    for (let i = 0; i <= SOURCE_THROTTLE_LIMITS.maxAttempts; i += 1) {
      const succeeded = await attemptLogin(freshEmail(), "nope", attackerIp);
      expect(succeeded).toBe(false);
    }

    // A brand-new, never-before-tried account, from the SAME source, gets
    // throttled purely on the strength of the source counter.
    const freshTarget = freshEmail();
    await registerOk(freshTarget, "another-irrelevant-password");
    const blocked = await auth.login(
      freshTarget,
      "another-irrelevant-password",
      attackerIp,
      new Date(),
    );
    expect(blocked.isErr() && blocked.error.type).toBe("throttled");

    // The SAME never-tried account, from a DIFFERENT source, succeeds —
    // proving this was the source limit, not some other coincidence.
    const otherIp = randomIp();
    const stillFine = await auth.login(
      freshTarget,
      "another-irrelevant-password",
      otherIp,
      new Date(),
    );
    expect(stillFine.isOk()).toBe(true);
  });

  it("a genuine success clears the account counter but leaves the source counter alone", async () => {
    const email = freshEmail();
    const password = "correct-horse-battery-staple";
    await registerOk(email, password);
    const ip = randomIp();

    const firstFailed = await attemptLogin(email, "wrong-once", ip);
    const secondFailed = await attemptLogin(email, "wrong-twice", ip);
    expect(firstFailed).toBe(false);
    expect(secondFailed).toBe(false);
    const success = await auth.login(email, password, ip, new Date());
    expect(success.isOk()).toBe(true);

    const accountCounter = await redis.get(`yt:auth:throttle:account:${sha256(email)}`);
    expect(accountCounter).toBeNull();

    const sourceCounter = await redis.get(`yt:auth:throttle:source:${ip}`);
    // The source counter is NOT cleared by the same success — it recorded
    // two real failures and a login-clears-account rule must not erase them.
    expect(sourceCounter).toBe("2");
  });
});

describe("session lifecycle — validated by breaking it, not reading it", () => {
  it("an expired session is refused even though it was never revoked", async () => {
    const userId = `expired-${randomUUID()}`;
    const { token, hash } = issueOpaqueToken();
    await sessionRepo.create({ id: hash, userId, absoluteExpiresAt: new Date(Date.now() - 1000) });

    const result = await sessionService.validateAndTouch(token, new Date());
    expect(result.valid).toBe(false);
    expect(!result.valid && result.reason).toBe("expired");
  });

  it("a revoked session is refused, and stays refused", async () => {
    const userId = `revoked-${randomUUID()}`;
    const token = await sessionService.issue(userId, new Date());

    const beforeRevoke = await sessionService.validateAndTouch(token, new Date());
    expect(beforeRevoke.valid).toBe(true);

    await sessionService.revoke(token, new Date());
    const afterRevoke = await sessionService.validateAndTouch(token, new Date());
    expect(afterRevoke.valid).toBe(false);
    expect(!afterRevoke.valid && afterRevoke.reason).toBe("revoked");

    // Revoking an ALREADY-revoked session must not throw and must not
    // resurrect it — idempotent by construction.
    await sessionService.revoke(token, new Date());
    const stillRevoked = await sessionService.validateAndTouch(token, new Date());
    expect(stillRevoked.valid).toBe(false);
  });

  it("a session id cannot be forged by editing the token", async () => {
    const userId = `forge-${randomUUID()}`;
    const token = await sessionService.issue(userId, new Date());
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");

    const result = await sessionService.validateAndTouch(tampered, new Date());
    expect(result.valid).toBe(false);
    expect(!result.valid && result.reason).toBe("not_found");
  });

  it("rotation on privilege change revokes every OTHER session for the user", async () => {
    const email = freshEmail();
    const password = "correct-horse-battery-staple";
    await registerOk(email, password);

    const loginA = await auth.login(email, password, randomIp(), new Date());
    const loginB = await auth.login(email, password, randomIp(), new Date());
    if (!loginA.isOk() || !loginB.isOk()) {
      expect(loginA.isOk()).toBe(true);
      expect(loginB.isOk()).toBe(true);
      return;
    }

    const changed = await auth.changePassword(
      loginA.value.token,
      password,
      "a-brand-new-password-entirely",
      new Date(),
    );
    expect(changed.isOk()).toBe(true);

    // Session B, minted before the change and never itself presented to
    // `changePassword`, is now dead.
    const stillB = await sessionService.validateAndTouch(loginB.value.token, new Date());
    expect(stillB.valid).toBe(false);
    expect(!stillB.valid && stillB.reason).toBe("revoked");

    // Session A's OWN original token is revoked too — the caller is handed
    // a FRESH one rather than keeping the old one alive.
    const stillA = await sessionService.validateAndTouch(loginA.value.token, new Date());
    expect(stillA.valid).toBe(false);

    if (changed.isOk()) {
      const fresh = await sessionService.validateAndTouch(changed.value.token, new Date());
      expect(fresh.valid).toBe(true);
    }
  });
});

describe("password reset — single-use, and a replay is refused", () => {
  it("a reset token can be consumed exactly once; a replay and a forgery are refused the SAME way", async () => {
    const email = freshEmail();
    await registerOk(email, "the-original-password");

    let issuedToken = "";
    // eslint-disable-next-line @typescript-eslint/unbound-method -- captured only to `.apply(this, ...)` below, which explicitly rebinds it
    const originalDebug = Logger.prototype.debug;
    Logger.prototype.debug = function patched(this: Logger, message?: unknown, ...rest: unknown[]) {
      if (typeof message === "string" && message.includes("password_reset token for")) {
        issuedToken = message.split(": ").pop() ?? "";
      }
      return originalDebug.apply(this, [message, ...rest] as Parameters<typeof originalDebug>);
    };

    try {
      const requested = await auth.requestPasswordReset(email, new Date());
      expect(requested.isOk()).toBe(true);
      expect(issuedToken.length).toBeGreaterThan(0);
    } finally {
      Logger.prototype.debug = originalDebug;
    }

    // `user_id` is opaque — the stored verification-token row must not
    // carry the email this reset was requested for, in any form. Read
    // BEFORE consuming, since consume mutates the row.
    const [tokenRow] = await db
      .select()
      .from(verificationTokensTable)
      .where(eq(verificationTokensTable.id, hashOpaqueToken(issuedToken)));
    expect(tokenRow).toBeDefined();
    expect(JSON.stringify(tokenRow)).not.toContain(email);
    expect(tokenRow?.userId).not.toContain("@");

    const first = await auth.confirmPasswordReset(
      issuedToken,
      "a-brand-new-reset-password",
      new Date(),
    );
    expect(first.isOk()).toBe(true);

    const replay = await auth.confirmPasswordReset(issuedToken, "yet-another-password", new Date());
    expect(replay.isErr() && replay.error.type).toBe("token_invalid");

    const neverIssued = await auth.confirmPasswordReset(
      "not-a-real-token-nobody-ever-issued",
      "irrelevant",
      new Date(),
    );
    expect(neverIssued.isErr() && neverIssued.error.type).toBe("token_invalid");
  });

  it("the repository tells a replay apart from a token that never existed", async () => {
    const userId = `resettoken-${randomUUID()}`;
    const { hash } = issueOpaqueToken();
    await verificationTokens.create({
      id: hash,
      userId,
      purpose: "password_reset",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const first = await verificationTokens.consume(hash, "password_reset", new Date());
    expect(first.consumed).toBe(true);

    const replay = await verificationTokens.consume(hash, "password_reset", new Date());
    expect(replay.consumed).toBe(false);
    const replayRefusal = !replay.consumed ? replay.refusal : undefined;
    expect(replayRefusal).toBe("already_consumed");

    const { hash: neverIssuedHash } = issueOpaqueToken();
    const neverExisted = await verificationTokens.consume(
      neverIssuedHash,
      "password_reset",
      new Date(),
    );
    expect(neverExisted.consumed).toBe(false);
    const neverExistedRefusal = !neverExisted.consumed ? neverExisted.refusal : undefined;
    expect(neverExistedRefusal).toBe("not_found");

    // The load-bearing assertion: these are NOT the same refusal, even
    // though the HTTP boundary later collapses both to one message.
    expect(replayRefusal).not.toBe(neverExistedRefusal);
  });

  it("an expired-but-unconsumed token is refused, and distinguishably from a replay", async () => {
    const userId = `expiredtoken-${randomUUID()}`;
    const { hash } = issueOpaqueToken();
    await verificationTokens.create({
      id: hash,
      userId,
      purpose: "email_verification",
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await verificationTokens.consume(hash, "email_verification", new Date());
    expect(result.consumed).toBe(false);
    const refusal = !result.consumed ? result.refusal : undefined;
    expect(refusal).toBe("expired");
  });
});
