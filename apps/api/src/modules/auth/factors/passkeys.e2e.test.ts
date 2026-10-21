import { randomUUID } from "node:crypto";
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
  ageSessions,
  amrOf,
  securityNotices,
  signedInAtOf,
  bearer,
  bootFactorsApp,
  errorCode,
  testIp,
} from "./testing/e2e-app";

/**
 * Passkeys end to end: real routes, the real PDP, Postgres and Valkey, and a
 * software authenticator whose responses go through the real WebAuthn checks.
 */
let app: NestFastifyApplication;
let close: () => Promise<void>;
const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");

beforeAll(async () => {
  ({ app, close } = await bootFactorsApp());
});

afterAll(async () => {
  await close();
});

async function addPasskey(session: TestSession, name?: string): Promise<SoftAuthenticator> {
  const options = await app.inject({
    method: "POST",
    url: "/api/auth/passkeys/register/options",
    headers: bearer(session.token),
  });
  expect(options.statusCode, options.body).toBe(201);
  const device = new SoftAuthenticator(E2E_RP_ID, E2E_ORIGIN);
  const response = device.register(
    options.json<{ options: PublicKeyCredentialCreationOptionsJSON }>().options,
  );
  const added = await app.inject({
    method: "POST",
    url: "/api/auth/passkeys/register",
    headers: bearer(session.token),
    payload: { response, ...(name === undefined ? {} : { name }) },
  });
  expect(added.statusCode, added.body).toBe(201);
  return device;
}

async function signInWith(device: SoftAuthenticator) {
  const remoteAddress = testIp();
  const options = await app.inject({
    method: "POST",
    url: "/api/auth/passkeys/sign-in/options",
    remoteAddress,
  });
  expect(options.statusCode, options.body).toBe(201);
  const ceremony = options.json<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }>();
  const payload = { challengeId: ceremony.challengeId, response: device.assert(ceremony.options) };
  const signedIn = await app.inject({
    method: "POST",
    url: "/api/auth/passkeys/sign-in",
    remoteAddress,
    payload,
  });
  return { signedIn, payload };
}

describe("passkeys", () => {
  it("adds a passkey, lists it, and signs in with it as amr hwk", async () => {
    const session = await accountFor(app);
    expect(await amrOf(owner, session.token)).toEqual(["pwd"]);
    const device = await addPasskey(session, "Work laptop");

    const methods = await app.inject({
      method: "GET",
      url: "/api/auth/sign-in-methods",
      headers: bearer(session.token),
    });
    expect(methods.statusCode, methods.body).toBe(200);
    const body = methods.json<{
      password: boolean;
      passkeys: { id: string; name: string; synced: boolean; lastUsedAt: string | null }[];
      authenticatorApp: { enabled: boolean };
    }>();
    expect(body.password).toBe(true);
    expect(body.authenticatorApp).toEqual({ enabled: false, available: true });
    expect(body.passkeys).toEqual([
      expect.objectContaining({ id: device.credentialId, name: "Work laptop", synced: true }),
    ]);
    expect(methods.body).not.toContain("publicKey");

    const { signedIn, payload } = await signInWith(device);
    expect(signedIn.statusCode, signedIn.body).toBe(201);
    const { token, userId } = signedIn.json<{ token: string; userId: string }>();
    expect(userId).toBe(session.userId);
    expect(await amrOf(owner, token)).toEqual(["hwk"]);

    const me = await app.inject({ method: "GET", url: "/api/me", headers: bearer(token) });
    expect(me.statusCode, me.body).toBe(200);

    // The same answer a second time finds its challenge already spent.
    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/sign-in",
      remoteAddress: testIp(),
      payload,
    });
    expect(replay.statusCode).toBe(401);
    expect(errorCode(replay)).toBe("factor_invalid");
  });

  it("stores only the public key, under a random user handle", async () => {
    const session = await accountFor(app);
    const device = await addPasskey(session);
    const { rows } = await owner.execute<{ user_id: string; name: string; transports: string[] }>(
      sql`SELECT user_id, name, transports FROM identity.passkey WHERE credential_id = ${device.credentialId}`,
    );
    expect(rows).toEqual([
      { user_id: session.userId, name: "Passkey", transports: ["internal", "hybrid"] },
    ]);
    const marker = await owner.execute<{ identifier: string; secret_hash: string }>(
      sql`SELECT identifier, secret_hash FROM identity.credential
          WHERE user_id = ${session.userId} AND kind = 'passkey'`,
    );
    expect(marker.rows[0]?.secret_hash).toBe("");
    expect(marker.rows[0]?.identifier).not.toContain(session.userId);
  });

  it("needs a recent sign-in to add one", async () => {
    const session = await accountFor(app);
    await ageSessions(owner, session.userId);
    const options = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/register/options",
      headers: bearer(session.token),
    });
    expect(options.statusCode).toBe(403);
    expect(errorCode(options)).toBe("reauthentication_required");
  });

  it("refuses a passkey sign-in from a signed-in caller, and the list to a signed-out one", async () => {
    const session = await accountFor(app);
    const signedInCaller = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/sign-in/options",
      headers: bearer(session.token),
    });
    expect(signedInCaller.statusCode).toBe(403);
    // A signed-out caller is asked to sign in.
    const anonymous = await app.inject({ method: "GET", url: "/api/auth/sign-in-methods" });
    expect(anonymous.statusCode).toBe(401);
  });

  it("removes a passkey only with proof of a factor, and never someone else's", async () => {
    const session = await accountFor(app);
    const other = await accountFor(app);
    const device = await addPasskey(session);
    const path = `/api/auth/passkeys/${device.credentialId}`;

    // A password-only session cannot remove it, even a fresh one.
    const unproved = await app.inject({
      method: "DELETE",
      url: path,
      headers: bearer(session.token),
    });
    expect(unproved.statusCode).toBe(403);
    expect(errorCode(unproved)).toBe("step_up_required");
    const notYours = await app.inject({
      method: "DELETE",
      url: path,
      headers: bearer(other.token),
    });
    expect(notYours.statusCode).toBe(403);

    // Proving the passkey again on this session unlocks the change.
    const stepUp = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/step-up/options",
      headers: bearer(session.token),
    });
    expect(stepUp.statusCode, stepUp.body).toBe(201);
    const ceremony = stepUp.json<{
      challengeId: string;
      options: PublicKeyCredentialRequestOptionsJSON;
    }>();
    expect(ceremony.options.allowCredentials?.map((c) => c.id)).toEqual([device.credentialId]);
    const proved = await app.inject({
      method: "POST",
      url: "/api/auth/step-up",
      headers: bearer(session.token),
      payload: { challengeId: ceremony.challengeId, response: device.assert(ceremony.options) },
    });
    expect(proved.statusCode, proved.body).toBe(201);

    const removed = await app.inject({
      method: "DELETE",
      url: path,
      headers: bearer(session.token),
    });
    expect(removed.statusCode, removed.body).toBe(200);
    const again = await app.inject({ method: "DELETE", url: path, headers: bearer(session.token) });
    expect(again.statusCode).toBe(404);

    const { signedIn } = await signInWith(device);
    expect(signedIn.statusCode).toBe(401);
    const notices = await securityNotices(owner, session.email);
    expect(notices).toHaveLength(2);
    expect(notices[0]).toContain("A passkey was added to your YourTal account");
    expect(notices[1]).toContain("A passkey was removed from your YourTal account");
    expect(notices.join("\n")).not.toContain("token");
  });

  it("asks a password-only session to prove the existing passkey before adding another", async () => {
    const session = await accountFor(app);
    const first = await addPasskey(session);
    const refused = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/register/options",
      headers: bearer(session.token),
    });
    expect(refused.statusCode).toBe(403);
    expect(errorCode(refused)).toBe("step_up_required");

    // A session signed in with the passkey (amr hwk) may add one directly.
    const { signedIn } = await signInWith(first);
    const hwk = signedIn.json<{ token: string }>().token;
    await addPasskey({ ...session, token: hwk }, "Second device");
    const { rows } = await owner.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM identity.passkey WHERE user_id = ${session.userId}`,
    );
    expect(rows[0]?.n).toBe(2);
  });

  it("writes nothing when only registration options were asked for", async () => {
    const session = await accountFor(app);
    const options = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/register/options",
      headers: bearer(session.token),
    });
    expect(options.statusCode).toBe(201);
    const { rows } = await owner.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM identity.credential
          WHERE user_id = ${session.userId} AND kind = 'passkey'`,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it("keeps how and when the person signed in across a password change", async () => {
    const password = "factors-e2e-not-a-real-secret-1";
    const session = await accountFor(app, password);
    await ageSessions(owner, session.userId);
    const before = await signedInAtOf(owner, session.token);
    const changed = await app.inject({
      method: "POST",
      url: "/api/auth/password/change",
      headers: bearer(session.token),
      payload: { currentPassword: password, newPassword: "a-new-password-for-this-e2e" },
    });
    expect(changed.statusCode, changed.body).toBe(201);
    const { token } = changed.json<{ token: string }>();
    expect(await amrOf(owner, token)).toEqual(["pwd"]);
    expect(await signedInAtOf(owner, token)).toEqual(before);
    // So the replacement is not a fresh sign-in for adding a passkey.
    const options = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/register/options",
      headers: bearer(token),
    });
    expect(options.statusCode).toBe(403);
    expect(errorCode(options)).toBe("reauthentication_required");
  });

  it("is erased with the account", async () => {
    const leaving = await accountFor(app);
    const device = await addPasskey(leaving);
    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { cookie: leaving.cookie, "idempotency-key": randomUUID() },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    const { rows } = await owner.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM identity.passkey WHERE user_id = ${leaving.userId}`,
    );
    expect(rows[0]?.n).toBe(0);
    const credentials = await owner.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM identity.credential WHERE user_id = ${leaving.userId}`,
    );
    expect(credentials.rows[0]?.n).toBe(0);
    const { signedIn } = await signInWith(device);
    expect(signedIn.statusCode).toBe(401);
  });
});
