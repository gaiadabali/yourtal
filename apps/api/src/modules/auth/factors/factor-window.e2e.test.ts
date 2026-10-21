import { sql } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestSession } from "../../../shared/testing/session-for";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { SoftAuthenticator } from "./testing/soft-authenticator";
import {
  E2E_ORIGIN,
  E2E_RP_ID,
  accountFor,
  bearer,
  bootFactorsApp,
  resetPassword,
  securityNotices,
  testIp,
} from "./testing/e2e-app";
import { totpCodeAt } from "./totp-code";

/**
 * The account's factor window, end to end: for 72 hours after an account's
 * first factor is added with a password alone, a password reset removes every
 * passkey and app and ends every session; after that, factors stay.
 */
let app: NestFastifyApplication;
let close: () => Promise<void>;
const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
const PASSWORD = "factors-e2e-not-a-real-secret-1";

beforeAll(async () => {
  ({ app, close } = await bootFactorsApp());
});

afterAll(async () => {
  await close();
});

async function addPasskey(token: string): Promise<SoftAuthenticator> {
  const options = await app.inject({
    method: "POST",
    url: "/api/auth/passkeys/register/options",
    headers: bearer(token),
  });
  expect(options.statusCode, options.body).toBe(201);
  const device = new SoftAuthenticator(E2E_RP_ID, E2E_ORIGIN);
  const added = await app.inject({
    method: "POST",
    url: "/api/auth/passkeys/register",
    headers: bearer(token),
    payload: {
      response: device.register(
        options.json<{ options: PublicKeyCredentialCreationOptionsJSON }>().options,
      ),
    },
  });
  expect(added.statusCode, added.body).toBe(201);
  return device;
}

/** Signs in with a passkey; returns the session token (amr hwk). */
async function signInWith(device: SoftAuthenticator): Promise<string> {
  const remoteAddress = testIp();
  const options = await app.inject({
    method: "POST",
    url: "/api/auth/passkeys/sign-in/options",
    remoteAddress,
  });
  const ceremony = options.json<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }>();
  const signedIn = await app.inject({
    method: "POST",
    url: "/api/auth/passkeys/sign-in",
    remoteAddress,
    payload: { challengeId: ceremony.challengeId, response: device.assert(ceremony.options) },
  });
  expect(signedIn.statusCode, signedIn.body).toBe(201);
  return signedIn.json<{ token: string }>().token;
}

/** Sets up an authenticator app from `token`'s session; returns its seed. */
async function addApp(token: string): Promise<string> {
  const enrolled = await app.inject({
    method: "POST",
    url: "/api/auth/totp/enrol",
    headers: bearer(token),
  });
  expect(enrolled.statusCode, enrolled.body).toBe(201);
  const { secret } = enrolled.json<{ secret: string }>();
  const confirmed = await app.inject({
    method: "POST",
    url: "/api/auth/totp/confirm",
    headers: bearer(token),
    payload: { code: totpCodeAt(secret, new Date(Date.now() - 30_000)) },
  });
  expect(confirmed.statusCode, confirmed.body).toBe(201);
  return secret;
}

async function windowOf(userId: string): Promise<Date | null> {
  const { rows } = await owner.execute<{ factors_open_until: string | null }>(
    sql`SELECT factors_open_until FROM identity.credential
        WHERE user_id = ${userId} AND kind = 'password'`,
  );
  const value = rows[0]?.factors_open_until ?? null;
  return value === null ? null : new Date(value);
}

async function factorCount(userId: string): Promise<number> {
  const { rows } = await owner.execute<{ n: string }>(
    sql`SELECT (SELECT count(*) FROM identity.passkey WHERE user_id = ${userId})
             + (SELECT count(*) FROM identity.credential WHERE user_id = ${userId} AND kind = 'totp')
             AS n`,
  );
  return Number(rows[0]?.n ?? -1);
}

async function signedIn(token: string): Promise<boolean> {
  const me = await app.inject({ method: "GET", url: "/api/me", headers: bearer(token) });
  return me.statusCode === 200;
}

async function closeWindow(userId: string): Promise<void> {
  await owner.execute(
    sql`UPDATE identity.credential SET factors_open_until = now() - interval '1 minute'
        WHERE user_id = ${userId} AND kind = 'password'`,
  );
}

describe("the factor window", () => {
  it("opens with the first factor, and later factors do not extend it", async () => {
    const session = await accountFor(app, PASSWORD);
    expect(await windowOf(session.userId)).toBeNull();
    const first = await addPasskey(session.token);
    const opened = await windowOf(session.userId);
    const hoursLeft = ((opened?.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(hoursLeft).toBeGreaterThan(71.9);
    expect(hoursLeft).toBeLessThanOrEqual(72);

    const hwk = await signInWith(first);
    await addPasskey(hwk);
    await addApp(hwk);
    expect(await windowOf(session.userId)).toEqual(opened);
  });

  it("lets a reset remove a planted passkey and everything added with it, sessions included", async () => {
    const victim: TestSession = await accountFor(app, PASSWORD);
    const planted = await addPasskey(victim.token);
    const attacker = await signInWith(planted);
    await addPasskey(attacker);
    await addApp(attacker);
    expect(await factorCount(victim.userId)).toBe(3);

    const reset = await resetPassword(app, victim);
    expect(reset.statusCode, reset.body).toBe(201);
    const body = reset.json<{ token?: string; secondFactor?: string }>();
    expect(body.secondFactor).toBeUndefined();
    expect(await factorCount(victim.userId)).toBe(0);
    expect(await windowOf(victim.userId)).toBeNull();
    expect(await signedIn(attacker)).toBe(false);
    expect(await signedIn(body.token ?? "")).toBe(true);
    const { rows } = await owner.execute<{ amr: string[] }>(
      sql`SELECT amr FROM identity.session WHERE user_id = ${victim.userId} AND revoked_at IS NULL`,
    );
    expect(rows).toEqual([{ amr: ["pwd"] }]);
    const notices = await securityNotices(owner, victim.email);
    expect(
      notices.some((notice) => notice.includes("were removed because your password was reset")),
    ).toBe(true);
  });

  it("removes the owner's own factors the same way during the window", async () => {
    const session = await accountFor(app, PASSWORD);
    const seed = await addApp(session.token);
    const stepUp = await app.inject({
      method: "POST",
      url: "/api/auth/step-up",
      headers: bearer(session.token),
      payload: { code: totpCodeAt(seed, new Date()) },
    });
    expect(stepUp.statusCode, stepUp.body).toBe(201);
    await addPasskey(session.token);
    expect(await factorCount(session.userId)).toBe(2);
    const reset = await resetPassword(app, session);
    expect(reset.json<{ secondFactor?: string }>().secondFactor).toBeUndefined();
    expect(await factorCount(session.userId)).toBe(0);
  });

  it("after the window, a reset keeps every factor and asks for the app's code", async () => {
    const session = await accountFor(app, PASSWORD);
    const first = await addPasskey(session.token);
    await addApp(await signInWith(first));
    await closeWindow(session.userId);
    const reset = await resetPassword(app, session);
    expect(reset.statusCode, reset.body).toBe(201);
    expect(reset.json<{ secondFactor?: string }>().secondFactor).toBe("totp");
    expect(await factorCount(session.userId)).toBe(2);
  });

  it("closes when the last factor goes, and the next first factor opens a new one", async () => {
    const session = await accountFor(app, PASSWORD);
    const only = await addPasskey(session.token);
    const hwk = await signInWith(only);
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/auth/passkeys/${only.credentialId}`,
      headers: bearer(hwk),
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(await windowOf(session.userId)).toBeNull();

    await addPasskey(hwk);
    expect(await windowOf(session.userId)).not.toBeNull();
  });
});

describe("removing a factor ends the account's other sessions", () => {
  it("for a passkey, keeping only the caller's", async () => {
    const session = await accountFor(app, PASSWORD);
    const first = await addPasskey(session.token);
    const caller = await signInWith(first);
    const second = await addPasskey(caller);
    const elsewhere = await signInWith(second);
    expect(await signedIn(session.token)).toBe(true);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/auth/passkeys/${second.credentialId}`,
      headers: bearer(caller),
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(await signedIn(elsewhere)).toBe(false);
    expect(await signedIn(session.token)).toBe(false);
    expect(await signedIn(caller)).toBe(true);
  });

  it("for an authenticator app", async () => {
    const session = await accountFor(app, PASSWORD);
    const seed = await addApp(session.token);
    const stepUp = await app.inject({
      method: "POST",
      url: "/api/auth/step-up",
      headers: bearer(session.token),
      payload: { code: totpCodeAt(seed, new Date()) },
    });
    expect(stepUp.statusCode, stepUp.body).toBe(201);
    const first = await addPasskey(session.token);
    const elsewhere = await signInWith(first);
    const off = await app.inject({
      method: "POST",
      url: "/api/auth/totp/disable",
      headers: bearer(session.token),
      payload: { code: totpCodeAt(seed, new Date(Date.now() + 30_000)) },
    });
    expect(off.statusCode, off.body).toBe(201);
    expect(await signedIn(elsewhere)).toBe(false);
    expect(await signedIn(session.token)).toBe(true);
  });
});
