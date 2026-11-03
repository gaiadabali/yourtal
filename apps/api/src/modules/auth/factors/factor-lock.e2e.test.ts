import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { hashOpaqueToken } from "../crypto/opaque-token";
import { AUTH_DB } from "../persistence/auth-db.token";
import { TOTP_CREDENTIAL_KIND } from "../persistence/credential.repository";
import { DrizzleCredentialRepository } from "../persistence/drizzle-credential.repository";
import { DrizzlePasskeyRepository } from "../persistence/drizzle-passkey.repository";
import { DrizzleSessionRepository } from "../persistence/drizzle-session.repository";
import { lockAccount } from "../persistence/factor-lock";
import type { Tx } from "../persistence/factor-lock";
import { PASSWORD_AMR } from "../session/amr";
import { SessionIssuer } from "../session/session-issuer";
import { accountFor, bootFactorsApp, resetPassword } from "./testing/e2e-app";

/**
 * The account lock (`persistence/factor-lock.ts`) against the orderings a
 * request can actually hit: a factor saved while a reset revokes the session
 * that added it, a reset reading a window that is closing, turning the app
 * off while a code sign-in holds the lock, and a password sign-in racing the
 * app being switched on. A second transaction holding the lock stands in for
 * the other request.
 */
let app: NestFastifyApplication;
let close: () => Promise<void>;
let credentials: DrizzleCredentialRepository;
let passkeys: DrizzlePasskeyRepository;
let sessions: DrizzleSessionRepository;
const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
const WINDOW = () => new Date(Date.now() + 72 * 3_600_000);

beforeAll(async () => {
  ({ app, close } = await bootFactorsApp());
  const db = app.get<AppDb>(AUTH_DB);
  credentials = new DrizzleCredentialRepository(db);
  passkeys = new DrizzlePasskeyRepository(db);
  sessions = new DrizzleSessionRepository(db);
});

afterAll(async () => {
  await close();
});

/** Holds the account lock in another transaction until the returned function is called. */
async function holdLock(
  userId: string,
  mode: "update" | "share",
  meanwhile?: (tx: Tx) => Promise<unknown>,
): Promise<() => Promise<void>> {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => (release = resolve));
  let locked = (): void => undefined;
  const isLocked = new Promise<void>((resolve) => (locked = resolve));
  const done = owner.transaction(async (tx) => {
    await lockAccount(tx, userId, mode);
    await meanwhile?.(tx);
    locked();
    await released;
  });
  await isLocked;
  return async () => {
    release();
    await done;
  };
}

/** True when `promise` has not settled after `ms` (it is waiting on a lock). */
async function stillWaiting(promise: Promise<unknown>, ms = 300): Promise<boolean> {
  const waiting = Symbol("waiting");
  const first = await Promise.race([
    promise.then(() => null),
    new Promise((resolve) => setTimeout(() => resolve(waiting), ms)),
  ]);
  return first === waiting;
}

const appRow = (userId: string) => ({
  userId,
  kind: TOTP_CREDENTIAL_KIND,
  identifier: userId,
  secretHash: "sealed-seed-not-used-here",
  verifiedAt: new Date(),
});

const passkeyFor = (userId: string) => ({
  credentialId: randomUUID(),
  userId,
  publicKey: Buffer.from("key"),
  signCount: 0,
  transports: [],
  deviceType: "multiDevice" as const,
  backedUp: true,
  name: "Planted",
});

async function factorCount(userId: string): Promise<number> {
  const { rows } = await owner.execute<{ n: string }>(
    sql`SELECT (SELECT count(*) FROM identity.passkey WHERE user_id = ${userId})
             + (SELECT count(*) FROM identity.credential WHERE user_id = ${userId} AND kind = 'totp')
             AS n`,
  );
  return Number(rows[0]?.n ?? -1);
}

async function revokeUnderLock(tx: Tx, userId: string): Promise<void> {
  await tx.execute(
    sql`UPDATE identity.session SET revoked_at = now()
        WHERE user_id = ${userId} AND revoked_at IS NULL`,
  );
}

describe("a factor saved for a session a reset ended", () => {
  it("is refused when the reset came first", async () => {
    const session = await accountFor(app);
    const sessionId = hashOpaqueToken(session.token);
    expect((await resetPassword(app, session)).statusCode).toBe(201);
    expect(await credentials.putVerified(appRow(session.userId), WINDOW(), sessionId)).toBe(
      "session_ended",
    );
    expect(await passkeys.create(passkeyFor(session.userId), "handle", WINDOW(), sessionId)).toBe(
      "session_ended",
    );
    expect(await factorCount(session.userId)).toBe(0);
  });

  it("is refused when it waited on the lock while the reset revoked the session", async () => {
    const session = await accountFor(app);
    const sessionId = hashOpaqueToken(session.token);
    const release = await holdLock(session.userId, "update", (tx) =>
      revokeUnderLock(tx, session.userId),
    );
    const saving = credentials.putVerified(appRow(session.userId), WINDOW(), sessionId);
    const key = passkeys.create(passkeyFor(session.userId), "handle", WINDOW(), sessionId);
    expect(await stillWaiting(saving)).toBe(true);
    await release();
    expect(await saving).toBe("session_ended");
    expect(await key).toBe("session_ended");
    expect(await factorCount(session.userId)).toBe(0);
  });

  it("makes the reset's revocation wait for a save already under way", async () => {
    const session = await accountFor(app);
    const release = await holdLock(session.userId, "update");
    const revoking = sessions.revokeAllForUser(session.userId, new Date());
    expect(await stillWaiting(revoking)).toBe(true);
    await release();
    await revoking;
    const { rows } = await owner.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM identity.session
          WHERE user_id = ${session.userId} AND revoked_at IS NULL`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });
});

describe("the reset's window check", () => {
  it("does nothing when the window closed while the reset waited on the lock", async () => {
    const session = await accountFor(app);
    const sessionId = hashOpaqueToken(session.token);
    expect(await credentials.putVerified(appRow(session.userId), WINDOW(), sessionId)).toBe(
      "stored",
    );
    const release = await holdLock(session.userId, "update", (tx) =>
      tx.execute(
        sql`UPDATE identity.credential SET factors_open_until = now() - interval '1 minute'
            WHERE user_id = ${session.userId} AND kind = 'password'`,
      ),
    );
    const removing = credentials.removeAllFactors(session.userId, new Date());
    expect(await stillWaiting(removing)).toBe(true);
    await release();
    expect(await removing).toBe(0);
    expect(await factorCount(session.userId)).toBe(1);
  });
});

describe("turning the app off", () => {
  it("waits for a code sign-in holding the lock", async () => {
    const session = await accountFor(app);
    await credentials.putVerified(appRow(session.userId), WINDOW(), hashOpaqueToken(session.token));
    const release = await holdLock(session.userId, "share");
    const off = credentials.deleteByUserAndKind(session.userId, TOTP_CREDENTIAL_KIND);
    expect(await stillWaiting(off)).toBe(true);
    await release();
    expect(await off).toBe(true);
  });
});

describe("a password sign-in racing the app being switched on", () => {
  it("issues no password-only session once the app is on", async () => {
    const session = await accountFor(app);
    const issuer = app.get(SessionIssuer);
    const release = await holdLock(session.userId, "update", (tx) =>
      tx.execute(
        sql`INSERT INTO identity.credential (user_id, kind, identifier, secret_hash, verified_at)
            VALUES (${session.userId}, 'totp', ${session.userId}, 'sealed', now())`,
      ),
    );
    const signIn = issuer.issueUnlessAppOn(session.userId, new Date(), PASSWORD_AMR);
    expect(await stillWaiting(signIn)).toBe(true);
    await release();
    expect(await signIn).toBeNull();
  });
});
