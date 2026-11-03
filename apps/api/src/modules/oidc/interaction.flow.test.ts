import { generateKeyPairSync } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { createServer, Socket } from "node:net";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthMethod } from "../auth/session/amr";
import type { OidcAccount } from "./claims";
import { findAccountFrom } from "./find-account";
import { InteractionError, InteractionService } from "./interaction.service";
import type { RawHttp } from "./interaction.service";
import { OidcRuntime } from "./oidc-runtime";
import type { AppConsent, OidcStore } from "./oidc-store";
import { pairwiseIdentifierFor } from "./pairwise";
import { NO_TEEN_INVITES } from "./sign-in-checks";
import { Browser, followToApp, startSignIn } from "./testing/sign-in-driver";
import type { StartedSignIn } from "./testing/sign-in-driver";
import { buildTestProvider } from "./testing/oidc-test-kit";
import type { TestProvider } from "./testing/oidc-test-kit";

/**
 * The interaction service and the provider together, with no database: the
 * same sign-in as oidc.e2e.test.ts, over an in-memory store, so a broken flow
 * shows up in seconds rather than in the Integration run.
 */
const WEB_REDIRECT = "https://snap-apps.gaiada.com/auth/yourtal/callback";
const FTR_REDIRECT = "https://freetaxreturns.com.au/api/auth/oauth2/callback/yourtal";

function memoryStore(accounts: Map<string, OidcAccount>) {
  const subjects = new Map<string, string>();
  const consents = new Map<string, AppConsent>();
  const log: { userId: string; clientId: string; result: string }[] = [];
  const store: OidcStore = {
    findAccount: (userId) => Promise.resolve(accounts.get(userId) ?? null),
    findSubject: (sector, userId) => Promise.resolve(subjects.get(`${sector}|${userId}`) ?? null),
    subjectFor: (sector, userId, fresh) => {
      const key = `${sector}|${userId}`;
      if (!subjects.has(key)) subjects.set(key, fresh());
      return Promise.resolve(subjects.get(key) ?? "");
    },
    findAppConsent: (userId, sector) =>
      Promise.resolve(consents.get(`${userId}|${sector}`) ?? null),
    grantAppConsent: (input) => {
      consents.set(`${input.userId}|${input.sector}`, {
        scopes: input.scopes,
        policyVersionId: input.policyVersionId,
        grantedVia: "consent_screen",
        inviteId: null,
        endedAt: null,
      });
      return Promise.resolve(true);
    },
    logSignIn: (userId, clientId, result) => {
      log.push({ userId, clientId, result });
      return Promise.resolve();
    },
  };
  return { store, subjects, consents, log };
}

const ADULT: OidcAccount = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Ana",
  region: "AU",
  dateOfBirth: "1990-01-01",
  email: "ana@example.com",
  emailVerified: true,
  suspended: false,
};
const TEEN: OidcAccount = {
  ...ADULT,
  userId: "22222222-2222-4222-8222-222222222222",
  dateOfBirth: "2012-01-01",
};
const HELD: OidcAccount = { ...ADULT, userId: "33333333-3333-4333-8333-333333333333" };
const BOB: OidcAccount = {
  ...ADULT,
  userId: "44444444-4444-4444-8444-444444444444",
  displayName: "Bob",
  email: "bob@example.com",
};
interface FakeSession {
  readonly userId: string;
  readonly amr: readonly AuthMethod[];
  readonly authTime: Date;
}
/** A minute ago, at a millisecond that is not a whole second. */
const EARLIER = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000 + 250);
const SESSIONS = new Map<string, FakeSession>([
  ["adult-token", { userId: ADULT.userId, amr: ["pwd"], authTime: EARLIER }],
  ["teen-token", { userId: TEEN.userId, amr: ["pwd"], authTime: EARLIER }],
  ["held-token", { userId: HELD.userId, amr: ["pwd"], authTime: EARLIER }],
  ["bob-token", { userId: BOB.userId, amr: ["pwd"], authTime: EARLIER }],
]);
const ACCOUNTS = new Map([ADULT, TEEN, HELD, BOB].map((account) => [account.userId, account]));

/** Two signing keys, as mid-rotation: the first signs, the second is only published. */
function signingKey(kid: string) {
  const jwk = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
    format: "jwk",
  });
  return { ...jwk, kid, alg: "RS256", use: "sig" };
}
const SIGNING_KID = "2026-10-21-sign";

let kit: TestProvider;
let issuer: string;
let service: InteractionService;
let memory: ReturnType<typeof memoryStore>;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        resolve(typeof address === "object" && address !== null ? address.port : 0),
      );
    });
  });
}

/** What Nest hands the controller: the raw request with the cookies the web server forwarded. */
function http(browser: Browser, uid: string): RawHttp {
  const req = new IncomingMessage(new Socket());
  req.headers = { cookie: browser.cookieHeader(`/connect/${uid}`) };
  return { req, res: new ServerResponse(req) };
}

beforeAll(async () => {
  const port = await freePort();
  issuer = `http://127.0.0.1:${String(port)}/oidc`;
  memory = memoryStore(ACCOUNTS);
  let registered: TestProvider["registered"] = [];
  kit = await buildTestProvider({
    issuer,
    findAccount: findAccountFrom(memory.store, () => registered, NO_TEEN_INVITES),
    store: memory.store,
    keys: {
      jwks: { keys: [signingKey(SIGNING_KID), signingKey("2026-10-21-next")] },
      cookieKeys: ["c".repeat(43)],
      ephemeral: false,
    },
    pairwiseIdentifier: (accountId, clientId, create) =>
      pairwiseIdentifierFor(memory.store, registered)(accountId, clientId, create),
  });
  registered = kit.registered;
  await kit.fastify.listen({ port, host: "127.0.0.1" });
  service = new InteractionService(
    new OidcRuntime(kit.provider, kit.registered, memory.store, null),
    {
      validateWithSignIn: (token) => {
        const session = SESSIONS.get(token);
        return Promise.resolve(
          session === undefined
            ? { valid: false, reason: "not_found" }
            : { valid: true, ...session },
        );
      },
    },
    NO_TEEN_INVITES,
  );
});

afterAll(async () => {
  await kit.fastify.close();
});

async function rp(clientId: string, auth: client.ClientAuth) {
  return client.discovery(new URL(issuer), clientId, undefined, auth, {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the test server is plain http on loopback
    execute: [client.allowInsecureRequests],
  });
}

const webApp = () =>
  rp(
    "snapapp-staging-web",
    client.PrivateKeyJwt({
      key: kit.keys.webKey.toCryptoKey({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
        "sign",
      ]),
      kid: "web-1",
    }),
  );

describe("a sign-in through the interaction service", () => {
  it("consents, then issues an ID token with the pairwise sub and the agreed claims", async () => {
    const config = await webApp();
    const started = await startSignIn(config, WEB_REDIRECT);
    const shown = await service.details(
      http(started.browser, started.uid),
      started.uid,
      "adult-token",
    );
    expect(shown).toMatchObject({
      screen: "consent",
      account: { name: "Ana", email: "ana@example.com" },
    });

    const { redirectTo } = await service.continue(
      http(started.browser, started.uid),
      started.uid,
      "adult-token",
      "consent",
    );
    const callback = await followToApp(started, redirectTo);
    expect(callback.searchParams.get("iss")).toBe(issuer);
    const tokens = await client.authorizationCodeGrant(config, callback, {
      pkceCodeVerifier: started.verifier,
      expectedState: started.state,
      expectedNonce: started.nonce,
    });
    const header = JSON.parse(
      Buffer.from((tokens.id_token ?? "").split(".")[0] ?? "", "base64url").toString(),
    ) as { kid?: string };
    expect(header.kid).toBe(SIGNING_KID);
    const claims = tokens.claims();
    expect(claims?.sub).toBe(memory.subjects.get(`snapapp-staging|${ADULT.userId}`));
    expect(claims).toMatchObject({
      email: "ana@example.com",
      email_verified: true,
      name: "Ana",
      region: "AU",
      age_band: "adult",
      amr: ["pwd"],
      aud: "snapapp-staging-web",
      iss: issuer,
    });
    expect(Object.keys(claims ?? {}).sort()).toEqual(
      [
        "age_band",
        "amr",
        "aud",
        "auth_time",
        "email",
        "email_verified",
        "exp",
        "iat",
        "iss",
        "name",
        "nonce",
        "region",
        "sub",
      ].sort(),
    );
    expect(memory.consents.get(`${ADULT.userId}|snapapp-staging`)?.scopes).toEqual([
      "openid",
      "email",
      "profile",
      "account",
    ]);
    expect(memory.log).toContainEqual({
      userId: ADULT.userId,
      clientId: "snapapp-staging-web",
      result: "signed_in",
    });

    const again = await startSignIn(config, WEB_REDIRECT);
    expect(
      (await service.details(http(again.browser, again.uid), again.uid, "adult-token")).screen,
    ).toBe("continue");
  });

  it("a refused teen goes back to the app with access_denied and the refusal", async () => {
    const config = await rp("ftr-web", client.ClientSecretBasic(kit.keys.ftrSecret));
    const started = await startSignIn(config, FTR_REDIRECT);
    const shown = await service.details(
      http(started.browser, started.uid),
      started.uid,
      "teen-token",
    );
    expect(shown).toMatchObject({ screen: "refused", refusal: "teen_not_allowed" });
    await expect(
      service.continue(http(started.browser, started.uid), started.uid, "teen-token", "consent"),
    ).rejects.toEqual(new InteractionError("sign_in_refused", "teen_not_allowed"));

    const { redirectTo } = await service.cancel(
      http(started.browser, started.uid),
      started.uid,
      "teen-token",
    );
    const back = await followToApp(started, redirectTo);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("error_description")).toBe("teen_not_allowed");
  });

  it("finds nothing for a uid the browser's cookie does not name", async () => {
    const started = await startSignIn(await webApp(), WEB_REDIRECT);
    await expect(
      service.details(http(started.browser, started.uid), "some-other-uid", "adult-token"),
    ).rejects.toEqual(new InteractionError("interaction_not_found"));
    await expect(
      service.details(http(new Browser(), started.uid), started.uid, "adult-token"),
    ).rejects.toEqual(new InteractionError("interaction_not_found"));
  });

  it("refuses id_token_hint, and makes no sub for an app the person never used", async () => {
    const snap = await webApp();
    const started = await startSignIn(snap, WEB_REDIRECT);
    const { redirectTo } = await service.continue(
      http(started.browser, started.uid),
      started.uid,
      "adult-token",
      "consent",
    );
    const tokens = await client.authorizationCodeGrant(
      snap,
      await followToApp(started, redirectTo),
      {
        pkceCodeVerifier: started.verifier,
        expectedState: started.state,
        expectedNonce: started.nonce,
      },
    );
    const ftr = await rp("ftr-web", client.ClientSecretBasic(kit.keys.ftrSecret));
    const url = client.buildAuthorizationUrl(ftr, {
      redirect_uri: FTR_REDIRECT,
      scope: "openid email profile account",
      code_challenge: await client.calculatePKCECodeChallenge(client.randomPKCECodeVerifier()),
      code_challenge_method: "S256",
      state: "s-hint",
      id_token_hint: tokens.id_token ?? "",
    });
    const back = new URL((await started.browser.get(url)).headers.get("location") ?? "");
    expect(back.searchParams.get("error")).toBe("invalid_request");
    expect(memory.subjects.has(`ftr|${ADULT.userId}`)).toBe(false);
  });

  it("checks the person again at resume: put on hold after Continue, they go back to YourTal's screen", async () => {
    ACCOUNTS.set(HELD.userId, HELD);
    const started = await startSignIn(await webApp(), WEB_REDIRECT);
    const { redirectTo } = await service.continue(
      http(started.browser, started.uid),
      started.uid,
      "held-token",
      "consent",
    );
    ACCOUNTS.set(HELD.userId, { ...HELD, suspended: true });
    const response = await started.browser.get(redirectTo);
    expect(response.headers.get("location") ?? "").toMatch(/^http:\/\/localhost:3000\/connect\//);
  });

  it("checks the person again at the token endpoint: on hold after the code, no tokens", async () => {
    ACCOUNTS.set(HELD.userId, HELD);
    const config = await webApp();
    const started = await startSignIn(config, WEB_REDIRECT);
    const { redirectTo } = await service.continue(
      http(started.browser, started.uid),
      started.uid,
      "held-token",
      "consent",
    );
    const callback = await followToApp(started, redirectTo);
    ACCOUNTS.set(HELD.userId, { ...HELD, suspended: true });
    await expect(
      client.authorizationCodeGrant(config, callback, {
        pkceCodeVerifier: started.verifier,
        expectedState: started.state,
        expectedNonce: started.nonce,
      }),
    ).rejects.toMatchObject({ error: "invalid_grant" });
  });
});

/** Shows the screen, taps through it, follows the redirect and redeems the code, as the app would. */
async function finish(
  config: client.Configuration,
  started: StartedSignIn,
  token: string,
  checks: { maxAge?: number } = {},
) {
  const raw = () => http(started.browser, started.uid);
  const shown = await service.details(raw(), started.uid, token);
  const tapped = shown.screen === "consent" ? "consent" : "continue";
  const { redirectTo } = await service.continue(raw(), started.uid, token, tapped);
  return client.authorizationCodeGrant(config, await followToApp(started, redirectTo), {
    pkceCodeVerifier: started.verifier,
    expectedState: started.state,
    expectedNonce: started.nonce,
    ...checks,
  });
}

const epoch = (date: Date) => Math.floor(date.getTime() / 1000);
const TWELVE_HOURS = 12 * 3600;

describe("auth_time, amr and a fresh sign-in", () => {
  it("auth_time is when the person signed in to YourTal, and amr how", async () => {
    for (const amr of [["pwd"], ["hwk"], ["pwd", "otp", "mfa"]] as const) {
      const token = `amr-${amr.join("-")}`;
      SESSIONS.set(token, { userId: ADULT.userId, amr, authTime: EARLIER });
      const config = await webApp();
      const claims = (
        await finish(config, await startSignIn(config, WEB_REDIRECT), token)
      ).claims();
      expect(claims?.amr).toEqual(amr);
      expect(claims?.auth_time).toBe(epoch(EARLIER));
      expect(Number(claims?.iat)).toBeGreaterThan(epoch(EARLIER));
    }
  });

  it("max_age: a sign-in within it goes straight on", async () => {
    SESSIONS.set("eleven-hours", {
      userId: ADULT.userId,
      amr: ["hwk"],
      authTime: new Date(Date.now() - 11 * 3600_000),
    });
    const config = await webApp();
    const started = await startSignIn(config, WEB_REDIRECT, { max_age: String(TWELVE_HOURS) });
    const claims = (
      await finish(config, started, "eleven-hours", { maxAge: TWELVE_HOURS })
    ).claims();
    expect(claims?.amr).toEqual(["hwk"]);
  });

  it("max_age: an older sign-in is asked for again, and the new one is the ID token's", async () => {
    SESSIONS.set("thirteen-hours", {
      userId: ADULT.userId,
      amr: ["hwk"],
      authTime: new Date(Date.now() - 13 * 3600_000),
    });
    const config = await webApp();
    const started = await startSignIn(config, WEB_REDIRECT, { max_age: String(TWELVE_HOURS) });
    const raw = () => http(started.browser, started.uid);
    expect(await service.details(raw(), started.uid, "thirteen-hours")).toMatchObject({
      screen: "sign_in_again",
      account: { name: "Ana", email: "ana@example.com" },
      sharing: null,
    });
    for (const tapped of ["consent", "continue"] as const) {
      await expect(service.continue(raw(), started.uid, "thirteen-hours", tapped)).rejects.toEqual(
        new InteractionError("session_required"),
      );
    }

    // Signed out and in again on YourTal's own sign-in, with a password and a code.
    const again = new Date();
    SESSIONS.set("signed-in-again", {
      userId: ADULT.userId,
      amr: ["pwd", "otp", "mfa"],
      authTime: again,
    });
    const claims = (
      await finish(config, started, "signed-in-again", { maxAge: TWELVE_HOURS })
    ).claims();
    expect(claims?.auth_time).toBe(epoch(again));
    expect(claims?.amr).toEqual(["pwd", "otp", "mfa"]);
  });

  it("prompt=login, and max_age=0: only a sign-in after the app asked counts", async () => {
    const config = await webApp();
    for (const extra of [{ prompt: "login" }, { max_age: "0" }]) {
      const started = await startSignIn(config, WEB_REDIRECT, extra);
      const raw = () => http(started.browser, started.uid);
      // adult-token signed in a minute ago, before this sign-in began.
      expect((await service.details(raw(), started.uid, "adult-token")).screen).toBe(
        "sign_in_again",
      );
      const again = new Date();
      SESSIONS.set("login-again", { userId: ADULT.userId, amr: ["pwd"], authTime: again });
      const claims = (await finish(config, started, "login-again")).claims();
      expect(claims?.auth_time).toBe(epoch(again));
    }
  });

  it("someone else signing in again on the same browser gets their own sub, never the first's", async () => {
    const config = await webApp();
    const first = await startSignIn(config, WEB_REDIRECT);
    const ana = (await finish(config, first, "adult-token")).claims();
    expect(ana?.sub).toBe(memory.subjects.get(`snapapp-staging|${ADULT.userId}`));

    const second = await startSignIn(config, WEB_REDIRECT, { prompt: "login" }, first.browser);
    expect(
      (await service.details(http(second.browser, second.uid), second.uid, "adult-token")).screen,
    ).toBe("sign_in_again");
    // "Sign in again" signed Ana out of YourTal, and Bob signed in.
    SESSIONS.set("bob-again", { userId: BOB.userId, amr: ["hwk"], authTime: new Date() });
    const raw = () => http(second.browser, second.uid);
    expect(await service.details(raw(), second.uid, "bob-again")).toMatchObject({
      screen: "consent",
      account: { name: "Bob", email: "bob@example.com" },
    });
    const { redirectTo } = await service.continue(raw(), second.uid, "bob-again", "consent");
    // The provider's own session is still Ana's, so the library signs it out first.
    const signOut = await second.browser.get(redirectTo);
    expect(signOut.status).toBe(200);
    const resumed = await second.browser.submitForm(await signOut.text());
    expect(resumed.status).toBe(303);
    const callback = await followToApp(second, resumed.headers.get("location") ?? "");
    const tokens = await client.authorizationCodeGrant(config, callback, {
      pkceCodeVerifier: second.verifier,
      expectedState: second.state,
      expectedNonce: second.nonce,
    });
    const bob = tokens.claims();
    expect(bob?.sub).toBe(memory.subjects.get(`snapapp-staging|${BOB.userId}`));
    expect(bob?.sub).not.toBe(ana?.sub);
    expect(bob).toMatchObject({ name: "Bob", email: "bob@example.com", amr: ["hwk"] });
  });
});
