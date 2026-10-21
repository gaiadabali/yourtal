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
  resetPassword,
  securityNotices,
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
    const session = await accountFor(app, PASSWORD);
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
      available: true,
    });
  });

  it("ends the account's other sessions when an app is switched on", async () => {
    const session = await accountFor(app, PASSWORD);
    const elsewhere = await login(session.email);
    const otherToken = elsewhere.json<{ token: string }>().token;
    await switchOn(session);
    const other = await app.inject({ method: "GET", url: "/api/me", headers: bearer(otherToken) });
    expect(other.statusCode).toBe(401);
    const own = await app.inject({ method: "GET", url: "/api/me", headers: bearer(session.token) });
    expect(own.statusCode).toBe(200);
    expect((await securityNotices(owner, session.email))[0]).toContain(
      "An authenticator app was set up for YourTal",
    );
  });

  it("refuses a code already used, on a new pending sign-in", async () => {
    const session = await accountFor(app, PASSWORD);
    const seed = await switchOn(session);
    const code = codeAt(seed, 0);
    const first = await login(session.email);
    const ok = await app.inject({
      method: "POST",
      url: "/api/auth/totp/sign-in",
      payload: { pendingToken: first.json<{ pendingToken: string }>().pendingToken, code },
    });
    expect(ok.statusCode, ok.body).toBe(201);
    const second = await login(session.email);
    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/totp/sign-in",
      payload: { pendingToken: second.json<{ pendingToken: string }>().pendingToken, code },
    });
    expect(replay.statusCode).toBe(401);
    expect(errorCode(replay)).toBe("factor_invalid");
  });

  it("checks at most five codes even when twenty arrive at once", async () => {
    const session = await accountFor(app, PASSWORD);
    await switchOn(session);
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () =>
        app.inject({
          method: "POST",
          url: "/api/auth/totp/disable",
          headers: bearer(session.token),
          payload: { code: "000000" },
        }),
      ),
    );
    const statuses = outcomes.map((outcome) => outcome.statusCode);
    expect(statuses.filter((status) => status === 401)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(15);
  });

  describe("a password reset", () => {
    it("removes an app added from a password alone in the last 72 hours", async () => {
      const victim = await accountFor(app, PASSWORD);
      await switchOn(victim);
      const reset = await resetPassword(app, victim);
      expect(reset.statusCode, reset.body).toBe(201);
      const body = reset.json<{ token?: string; secondFactor?: string }>();
      expect(body.secondFactor).toBeUndefined();
      expect(body.token).toBeDefined();
      const methods = await app.inject({
        method: "GET",
        url: "/api/auth/sign-in-methods",
        headers: bearer(body.token ?? ""),
      });
      expect(
        methods.json<{ authenticatorApp: { enabled: boolean } }>().authenticatorApp.enabled,
      ).toBe(false);
      const notices = await securityNotices(owner, victim.email);
      expect(notices.some((notice) => notice.includes("authenticator app was removed"))).toBe(true);
    });

    it("asks for the code once that app is older than 72 hours, and lists it", async () => {
      const session = await accountFor(app, PASSWORD);
      await switchOn(session);
      await owner.execute(
        sql`UPDATE identity.credential SET verified_at = now() - interval '73 hours'
            WHERE user_id = ${session.userId} AND kind = 'totp'`,
      );
      const reset = await resetPassword(app, session);
      expect(reset.statusCode, reset.body).toBe(201);
      expect(reset.json<{ secondFactor?: string }>().secondFactor).toBe("totp");
      expect(reset.json<{ token?: string }>().token).toBeUndefined();
      const notices = await securityNotices(owner, session.email);
      expect(notices.at(-1)).toContain("Check how you sign in to YourTal");
      expect(notices.at(-1)).toContain("an authenticator app");
    });

    it("asks for the code of an app added with proof of another factor", async () => {
      const session = await accountFor(app, PASSWORD);
      const registerOptions = await app.inject({
        method: "POST",
        url: "/api/auth/passkeys/register/options",
        headers: bearer(session.token),
      });
      const device = new SoftAuthenticator(E2E_RP_ID, E2E_ORIGIN);
      await app.inject({
        method: "POST",
        url: "/api/auth/passkeys/register",
        headers: bearer(session.token),
        payload: {
          response: device.register(
            registerOptions.json<{ options: PublicKeyCredentialCreationOptionsJSON }>().options,
          ),
        },
      });
      // Signed in with the passkey (amr hwk), so the app is not bootstrapped.
      const options = await app.inject({
        method: "POST",
        url: "/api/auth/passkeys/sign-in/options",
        remoteAddress: testIp(),
      });
      const ceremony = options.json<{
        challengeId: string;
        options: PublicKeyCredentialRequestOptionsJSON;
      }>();
      const hwk = await app.inject({
        method: "POST",
        url: "/api/auth/passkeys/sign-in",
        remoteAddress: testIp(),
        payload: { challengeId: ceremony.challengeId, response: device.assert(ceremony.options) },
      });
      await switchOn({ ...session, token: hwk.json<{ token: string }>().token });
      const reset = await resetPassword(app, session);
      expect(reset.json<{ secondFactor?: string }>().secondFactor).toBe("totp");
    });
  });

  it("finishes an enrolment only from the session that started it", async () => {
    const session = await accountFor(app, PASSWORD);
    const enrolled = await app.inject({
      method: "POST",
      url: "/api/auth/totp/enrol",
      headers: bearer(session.token),
    });
    const { secret } = enrolled.json<{ secret: string }>();
    const elsewhere = await login(session.email);
    const otherToken = elsewhere.json<{ token: string }>().token;
    const refused = await app.inject({
      method: "POST",
      url: "/api/auth/totp/confirm",
      headers: bearer(otherToken),
      payload: { code: codeAt(secret, 0) },
    });
    expect(refused.statusCode).toBe(401);
    expect(errorCode(refused)).toBe("factor_invalid");
    const { rows } = await owner.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM identity.credential
          WHERE user_id = ${session.userId} AND kind = 'totp'`,
    );
    expect(rows[0]?.n).toBe(0);
  });

  it("turns off only with a fresh code or a passkey, and then a password is enough again", async () => {
    const session = await accountFor(app, PASSWORD);
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
    const session = await accountFor(app, PASSWORD);
    const seed = await switchOn(session);
    // The account has an app now, so adding a passkey needs a code first.
    const refused = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/register/options",
      headers: bearer(session.token),
    });
    expect(refused.statusCode).toBe(403);
    expect(errorCode(refused)).toBe("step_up_required");
    const stepUp = await app.inject({
      method: "POST",
      url: "/api/auth/step-up",
      headers: bearer(session.token),
      payload: { code: codeAt(seed, 0) },
    });
    expect(stepUp.statusCode, stepUp.body).toBe(201);
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

    const passkeyOptions = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/step-up/options",
      headers: bearer(session.token),
    });
    const ceremony = passkeyOptions.json<{
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
    const session = await accountFor(app, PASSWORD);
    const seed = await switchOn(session);
    // A password-only session must prove the app it already has first.
    const unproved = await app.inject({
      method: "POST",
      url: "/api/auth/totp/enrol",
      headers: bearer(session.token),
    });
    expect(unproved.statusCode).toBe(403);
    expect(errorCode(unproved)).toBe("step_up_required");
    const stepUp = await app.inject({
      method: "POST",
      url: "/api/auth/step-up",
      headers: bearer(session.token),
      payload: { code: codeAt(seed, 0) },
    });
    expect(stepUp.statusCode, stepUp.body).toBe(201);
    const again = await app.inject({
      method: "POST",
      url: "/api/auth/totp/enrol",
      headers: bearer(session.token),
    });
    expect(again.statusCode).toBe(409);
    expect(errorCode(again)).toBe("totp_already_enabled");

    const stale = await accountFor(app, PASSWORD);
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
    const session = await accountFor(app, PASSWORD);
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
