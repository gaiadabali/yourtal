import { sql } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionFor } from "../../../shared/testing/session-for";
import type { TestSession } from "../../../shared/testing/session-for";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { AuthService } from "../auth.service";
import { DevTokenAccess } from "../dev-token-access";
import { SoftAuthenticator } from "./testing/soft-authenticator";
import {
  E2E_ORIGIN,
  E2E_RP_ID,
  ageSessions,
  amrOf,
  bearer,
  bootFactorsApp,
  errorCode,
  testIp,
} from "./testing/e2e-app";
import { totpCodeAt } from "./totp-code";

/**
 * Authenticator-app codes end to end. Each code is taken from a different
 * 30-second step (now - 30 s, now, now + 30 s), all inside the allowed drift,
 * because a step once used is refused.
 */
let app: NestFastifyApplication;
let close: () => Promise<void>;
const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
const PASSWORD = "totp-e2e-not-a-real-secret-1";

beforeAll(async () => {
  ({ app, close } = await bootFactorsApp());
});

afterAll(async () => {
  await close();
});

const codeAt = (seed: string, offsetSeconds: number) =>
  totpCodeAt(seed, new Date(Date.now() + offsetSeconds * 1000));

/** Sets up and confirms an authenticator app (with the previous step's code); returns its seed. */
async function switchOn(session: TestSession): Promise<string> {
  const enrolled = await app.inject({
    method: "POST",
    url: "/api/auth/totp/enrol",
    headers: bearer(session.token),
  });
  expect(enrolled.statusCode, enrolled.body).toBe(201);
  const { otpauthUri, secret } = enrolled.json<{ otpauthUri: string; secret: string }>();
  expect(new URL(otpauthUri).searchParams.get("secret")).toBe(secret);

  const confirmed = await app.inject({
    method: "POST",
    url: "/api/auth/totp/confirm",
    headers: bearer(session.token),
    payload: { code: codeAt(secret, -30) },
  });
  expect(confirmed.statusCode, confirmed.body).toBe(201);
  return secret;
}

async function login(email: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    remoteAddress: testIp(),
    payload: { email, password: PASSWORD },
  });
}

describe("authenticator codes", () => {
  it("stores the seed sealed, and asks for a code after the password (amr pwd otp mfa)", async () => {
    const session = await sessionFor(app, { password: PASSWORD });
    const seed = await switchOn(session);

    const { rows } = await owner.execute<{ secret_hash: string; verified_at: Date | null }>(
      sql`SELECT secret_hash, verified_at FROM identity.credential
          WHERE user_id = ${session.userId} AND kind = 'totp'`,
    );
    expect(rows[0]?.verified_at).not.toBeNull();
    expect(rows[0]?.secret_hash.startsWith("v1.")).toBe(true);
    expect(rows[0]?.secret_hash).not.toContain(seed);

    const step = await login(session.email);
    expect(step.statusCode, step.body).toBe(201);
    const pending = step.json<{ secondFactor?: string; pendingToken: string; token?: string }>();
    expect(pending.secondFactor).toBe("totp");
    expect(pending.token).toBeUndefined();

    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/totp/sign-in",
      payload: { pendingToken: pending.pendingToken, code: "000000" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(errorCode(wrong)).toBe("factor_invalid");

    const right = await app.inject({
      method: "POST",
      url: "/api/auth/totp/sign-in",
      payload: { pendingToken: pending.pendingToken, code: codeAt(seed, 0) },
    });
    expect(right.statusCode, right.body).toBe(201);
    const { token, userId } = right.json<{ token: string; userId: string }>();
    expect(userId).toBe(session.userId);
    expect(await amrOf(owner, token)).toEqual(["pwd", "otp", "mfa"]);

    const reused = await app.inject({
      method: "POST",
      url: "/api/auth/totp/sign-in",
      payload: { pendingToken: pending.pendingToken, code: codeAt(seed, 30) },
    });
    expect(reused.statusCode).toBe(401);

    const methods = await app.inject({
      method: "GET",
      url: "/api/auth/sign-in-methods",
      headers: bearer(token),
    });
    expect(methods.json<{ authenticatorApp: { enabled: boolean } }>().authenticatorApp).toEqual({
      enabled: true,
    });
  });

  it("asks for a code after a password reset too", async () => {
    const session = await sessionFor(app, { password: PASSWORD });
    await switchOn(session);
    const auth = app.get(AuthService);
    const requested = await auth.requestPasswordReset(session.email, new Date());
    expect(requested.isOk()).toBe(true);
    const resetToken = app
      .get(DevTokenAccess)
      .peekToken("password_reset", session.userId, Date.now());
    const reset = await app.inject({
      method: "POST",
      url: "/api/auth/password/reset/confirm",
      payload: { token: resetToken, newPassword: "a-brand-new-password-for-totp" },
    });
    expect(reset.statusCode, reset.body).toBe(201);
    expect(reset.json<{ secondFactor?: string; token?: string }>()).toMatchObject({
      secondFactor: "totp",
    });
    expect(reset.json<{ token?: string }>().token).toBeUndefined();
  });

  it("turns off only with a fresh code or a passkey, and then a password is enough again", async () => {
    const session = await sessionFor(app, { password: PASSWORD });
    const seed = await switchOn(session);

    const noProof = await app.inject({
      method: "POST",
      url: "/api/auth/totp/disable",
      headers: bearer(session.token),
      payload: {},
    });
    expect(noProof.statusCode).toBe(401);
    const off = await app.inject({
      method: "POST",
      url: "/api/auth/totp/disable",
      headers: bearer(session.token),
      payload: { code: codeAt(seed, 30) },
    });
    expect(off.statusCode, off.body).toBe(201);

    const step = await login(session.email);
    const signedIn = step.json<{ token?: string }>();
    expect(signedIn.token).toBeDefined();
    expect(await amrOf(owner, signedIn.token ?? "")).toEqual(["pwd"]);
  });

  it("turns off with a passkey instead of a code", async () => {
    const session = await sessionFor(app, { password: PASSWORD });
    await switchOn(session);
    const registerOptions = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/register/options",
      headers: bearer(session.token),
    });
    const device = new SoftAuthenticator(E2E_RP_ID, E2E_ORIGIN);
    const added = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/register",
      headers: bearer(session.token),
      payload: {
        response: device.register(
          registerOptions.json<{ options: PublicKeyCredentialCreationOptionsJSON }>().options,
        ),
      },
    });
    expect(added.statusCode, added.body).toBe(201);

    const stepUp = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/step-up/options",
      headers: bearer(session.token),
    });
    const ceremony = stepUp.json<{
      challengeId: string;
      options: PublicKeyCredentialRequestOptionsJSON;
    }>();
    const off = await app.inject({
      method: "POST",
      url: "/api/auth/totp/disable",
      headers: bearer(session.token),
      payload: { challengeId: ceremony.challengeId, response: device.assert(ceremony.options) },
    });
    expect(off.statusCode, off.body).toBe(201);
    expect(off.json()).toEqual({ enabled: false });
  });

  it("needs a recent sign-in to set up, and will not replace an app that is on", async () => {
    const session = await sessionFor(app, { password: PASSWORD });
    await switchOn(session);
    const again = await app.inject({
      method: "POST",
      url: "/api/auth/totp/enrol",
      headers: bearer(session.token),
    });
    expect(again.statusCode).toBe(409);
    expect(errorCode(again)).toBe("totp_already_enabled");

    const stale = await sessionFor(app, { password: PASSWORD });
    await ageSessions(owner, stale.userId);
    const refused = await app.inject({
      method: "POST",
      url: "/api/auth/totp/enrol",
      headers: bearer(stale.token),
    });
    expect(refused.statusCode).toBe(403);
    expect(errorCode(refused)).toBe("reauthentication_required");
  });

  it("throttles guessing: after five wrong codes even the right one is refused", async () => {
    const session = await sessionFor(app, { password: PASSWORD });
    const seed = await switchOn(session);
    const step = await login(session.email);
    const { pendingToken } = step.json<{ pendingToken: string }>();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await app.inject({
        method: "POST",
        url: "/api/auth/totp/sign-in",
        payload: { pendingToken, code: "000000" },
      });
      expect(wrong.statusCode).toBe(401);
    }
    const fresh = await login(session.email);
    const right = await app.inject({
      method: "POST",
      url: "/api/auth/totp/sign-in",
      payload: {
        pendingToken: fresh.json<{ pendingToken: string }>().pendingToken,
        code: codeAt(seed, 0),
      },
    });
    expect(right.statusCode).toBe(429);
  });
});
