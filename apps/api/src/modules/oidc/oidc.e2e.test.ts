import { createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import * as client from "openid-client";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  interactionDetailsSchema,
  interactionRedirectSchema,
} from "@yourtal/contracts/oidc/interaction";
import { AppModule } from "../../app.module";
import { hashOpaqueToken } from "../auth/crypto/opaque-token";
import { E2E_ORIGIN, E2E_RP_ID, accountFor, bearer, testIp } from "../auth/factors/testing/e2e-app";
import { SoftAuthenticator } from "../auth/factors/testing/soft-authenticator";
import { totpCodeAt } from "../auth/factors/totp-code";
import { SessionService } from "../auth/session/session.service";
import { mountOidc } from "./mount-oidc";
import { OIDC_RUNTIME } from "./oidc-runtime";
import type { OidcRuntime } from "./oidc-runtime";
import { followToApp, startSignIn, webServerCall } from "./testing/sign-in-driver";

/**
 * Group 3.9 end to end, against Postgres: the real AppModule serving the
 * provider on a real port, openid-client as each app, and the interaction API
 * driven with the browser's cookies the way YourTal's /connect page will.
 */
const WEB_REDIRECT = "https://snap-apps.gaiada.com/auth/yourtal/callback";
const MOBILE_REDIRECT = "au.com.snapapps.app:/oauth/yourtal";
const FTR_REDIRECT = "https://freetaxreturns.com.au/api/auth/oauth2/callback/yourtal";
const ENV_KEYS = [
  "OIDC_ENABLED",
  "OIDC_ISSUER",
  "OIDC_CLIENT_KEYS_DIR",
  "OIDC_JWKS_PATH",
  "WEBAUTHN_RP_ID",
  "WEBAUTHN_ORIGIN",
];

let app: NestFastifyApplication;
let pool: pg.Pool;
let base: string;
let issuer: string;
let keysDir: string;
let webKey: CryptoKey;
let serverKey: CryptoKey;
let ftrSecret: string;
/** Every route the real app mounts, Nest's and the provider's. */
const mountedUrls: string[] = [];
const savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
  });
}

async function rsaKeyFile(clientId: string): Promise<CryptoKey> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const keys = [{ ...jwk, kid: `${clientId}-1`, alg: "RS256", use: "sig" }];
  writeFileSync(path.join(keysDir, `${clientId}.jwks.json`), JSON.stringify({ keys }));
  return pair.privateKey;
}

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${String(port)}`;
  issuer = `${base}/oidc`;
  keysDir = mkdtempSync(path.join(tmpdir(), "yt-oidc-"));
  webKey = await rsaKeyFile("snapapp-staging-web");
  serverKey = await rsaKeyFile("snapapp-staging-server");
  ftrSecret = randomBytes(32).toString("base64url");
  writeFileSync(path.join(keysDir, "ftr-web.secret"), ftrSecret);

  process.env["OIDC_ENABLED"] = "true";
  process.env["OIDC_ISSUER"] = issuer;
  process.env["OIDC_CLIENT_KEYS_DIR"] = keysDir;
  // Absent on purpose: dev makes throwaway signing keys.
  process.env["OIDC_JWKS_PATH"] = path.join(keysDir, "none", "jwks.json");
  // The relying party the soft authenticator answers for.
  process.env["WEBAUTHN_RP_ID"] = E2E_RP_ID;
  process.env["WEBAUTHN_ORIGIN"] = E2E_ORIGIN;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  // Loopback is the trusted proxy, so each call's x-forwarded-for is its own IP for the rate limits.
  app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: "127.0.0.1" }),
  );
  app
    .getHttpAdapter()
    .getInstance()
    .addHook("onRoute", (route) => {
      mountedUrls.push(route.url);
    });
  app.useGlobalPipes(new ZodValidationPipe());
  expect(
    await mountOidc(app.getHttpAdapter().getInstance(), app.get<OidcRuntime>(OIDC_RUNTIME)),
  ).toBe(true);
  await app.listen(port, "127.0.0.1");
  pool = new pg.Pool({ connectionString: process.env["DATABASE_URL"], max: 2 });
});

afterAll(async () => {
  await app.close();
  await pool.end();
  rmSync(keysDir, { recursive: true, force: true });
  for (const [key, value] of savedEnv) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
});

interface Person {
  readonly userId: string;
  readonly token: string;
  readonly email: string;
}

/**
 * A YourTal account and a live session, written straight to the tables rather
 * than through /api/auth/register, whose route-wide hourly limit the rest of
 * the suite already leans on.
 */
async function person(options: { region?: "AU" | "ID"; teen?: boolean; verified?: boolean } = {}) {
  const region = options.region ?? "AU";
  const userId = randomUUID();
  const email = `oidc-${randomUUID()}@example.test`;
  await pool.query(
    `INSERT INTO identity.credential (user_id, kind, identifier, secret_hash, verified_at)
     VALUES ($1, 'password', $2, 'not-a-password-hash', $3)`,
    [userId, email, options.verified === false ? null : new Date()],
  );
  await pool.query(
    `INSERT INTO identity.user_profile
       (user_id, region, display_locale, display_name, date_of_birth, timezone, parent_consent_status)
     VALUES ($1, $2, $3, 'Ana',
             CASE WHEN $4 THEN (now() - interval '15 years')::date ELSE DATE '1990-01-01' END,
             'Australia/Sydney', CASE WHEN $4 THEN 'granted' ELSE 'not_required' END)`,
    [userId, region, region === "AU" ? "en-AU" : "id-ID", options.teen === true],
  );
  const token = await app
    .get(SessionService, { strict: false })
    .issue(userId, new Date(), "consumer", ["pwd"]);
  return { userId, token, email } satisfies Person;
}

function rp(clientId: string, auth: client.ClientAuth): Promise<client.Configuration> {
  return client.discovery(new URL(issuer), clientId, undefined, auth, {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the test server is plain http on loopback
    execute: [client.allowInsecureRequests],
  });
}

const webApp = () =>
  rp("snapapp-staging-web", client.PrivateKeyJwt({ key: webKey, kid: "snapapp-staging-web-1" }));
const mobileApp = () => rp("snapapp-staging-mobile", client.None());
const ftrApp = () => rp("ftr-web", client.ClientSecretBasic(ftrSecret));

/** A whole sign-in: start, the screen, the tap, the redirect back, the code redeemed. */
async function signIn(
  config: client.Configuration,
  redirectUri: string,
  who: Person,
  expectScreen: "consent" | "continue",
) {
  const started = await startSignIn(config, redirectUri);
  const shown = await webServerCall(base, started, who.token, "");
  expect(shown.status).toBe(200);
  const body = await details(shown);
  expect(body.screen).toBe(expectScreen);
  const tapped = await webServerCall(base, started, who.token, "/continue", {
    screen: expectScreen,
  });
  expect(tapped.status, await tapped.clone().text()).toBe(200);
  const callback = await followToApp(started, await redirectOf(tapped));
  expect(callback.searchParams.get("iss")).toBe(issuer);
  const tokens = await client.authorizationCodeGrant(config, callback, {
    pkceCodeVerifier: started.verifier,
    expectedState: started.state,
    expectedNonce: started.nonce,
  });
  return { tokens, details: body, callback };
}

async function verifySignature(idToken: string): Promise<{ alg: string; kid: string }> {
  const [header = "", payload = "", signature = ""] = idToken.split(".");
  const parsed = z
    .object({ alg: z.string(), kid: z.string() })
    .parse(JSON.parse(Buffer.from(header, "base64url").toString()));
  const jwks = jwksSchema.parse(await (await fetch(`${issuer}/jwks`)).json());
  const jwk = jwks.keys.find((key) => key.kid === parsed.kid);
  expect(jwk).toBeDefined();
  const ok = verify(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    createPublicKey({ key: { kty: "RSA", n: jwk?.n ?? "", e: jwk?.e ?? "" }, format: "jwk" }),
    Buffer.from(signature, "base64url"),
  );
  expect(ok).toBe(true);
  return parsed;
}

async function rows(sql: string, params: unknown[]): Promise<unknown[]> {
  const result = await pool.query<Record<string, unknown>>(sql, params);
  return result.rows;
}

const details = async (response: Response) => interactionDetailsSchema.parse(await response.json());
const redirectOf = async (response: Response) =>
  interactionRedirectSchema.parse(await response.json()).redirectTo;
const errorBody = async (response: Response) =>
  z.object({ code: z.string(), refusal: z.string().optional() }).parse(await response.json());
const jwksSchema = z.object({
  keys: z.array(z.looseObject({ kid: z.string(), n: z.string(), e: z.string() })),
});

describe("sign in with YourTal, end to end", () => {
  it("SnapApp's website (private_key_jwt): consent, then a signed ID token with the agreed claims", async () => {
    const ana = await person();
    const { tokens, details } = await signIn(await webApp(), WEB_REDIRECT, ana, "consent");
    expect(details.client).toMatchObject({ clientId: "snapapp-staging-web", name: "SnapApp" });
    expect(details.sharing).toEqual({
      claims: ["name", "email", "age_band", "region"],
      ageBand: "adult",
      region: "AU",
    });

    const claims = tokens.claims();
    expect(claims).toBeDefined();
    expect(claims?.sub).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(claims?.sub).not.toBe(ana.userId);
    expect(claims).toMatchObject({
      iss: issuer,
      aud: "snapapp-staging-web",
      email: ana.email,
      email_verified: true,
      name: "Ana",
      region: "AU",
      age_band: "adult",
      amr: ["pwd"],
    });
    expect(Number(claims?.exp) - Number(claims?.iat)).toBe(300);
    // Exactly the protocol's claims and docs/26 §1.3's: never the date of birth or the user id.
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
    expect(JSON.stringify(claims)).not.toContain(ana.userId);
    expect(tokens.refresh_token).toBeUndefined();
    expect(tokens.expires_in).toBeGreaterThan(590);
    expect(tokens.expires_in).toBeLessThanOrEqual(600);
    expect(await verifySignature(tokens.id_token ?? "")).toMatchObject({ alg: "RS256" });

    expect(
      await rows("SELECT sub FROM oidc.subject WHERE user_id = $1 AND sector = 'snapapp-staging'", [
        ana.userId,
      ]),
    ).toEqual([{ sub: claims?.sub }]);
    expect(
      await rows(
        `SELECT purpose, source, audience, state FROM identity.consent_record
          WHERE user_id = $1 AND purpose = 'sister_app_profile_sharing'`,
        [ana.userId],
      ),
    ).toEqual([
      {
        purpose: "sister_app_profile_sharing",
        source: "oidc_consent_screen",
        audience: "snapapp-staging",
        state: "granted",
      },
    ]);
    expect(
      await rows("SELECT client_id, result FROM oidc.sign_in_log WHERE user_id = $1", [ana.userId]),
    ).toEqual([{ client_id: "snapapp-staging-web", result: "signed_in" }]);

    const userinfo = await client.fetchUserInfo(
      await webApp(),
      tokens.access_token,
      claims?.sub ?? "",
    );
    expect(userinfo).toMatchObject({ sub: claims?.sub, email: ana.email, age_band: "adult" });
  });

  it("SnapApp's phone app (public, PKCE): consent is per app, and the sub is the website's", async () => {
    const ana = await person();
    const first = await signIn(await webApp(), WEB_REDIRECT, ana, "consent");
    const phone = await signIn(await mobileApp(), MOBILE_REDIRECT, ana, "continue");
    expect(phone.tokens.claims()?.sub).toBe(first.tokens.claims()?.sub);
    expect(phone.tokens.claims()?.aud).toBe("snapapp-staging-mobile");
  });

  it("FTR (client_secret_basic) gets its own sub for the same person", async () => {
    const ana = await person();
    const snap = await signIn(await webApp(), WEB_REDIRECT, ana, "consent");
    const ftr = await signIn(await ftrApp(), FTR_REDIRECT, ana, "consent");
    expect(ftr.tokens.claims()?.sub).not.toBe(snap.tokens.claims()?.sub);
    expect(ftr.details.client).toMatchObject({
      externalOperator: true,
      returnHost: "freetaxreturns.com.au",
    });
  });

  it("a code works once", async () => {
    const ana = await person();
    const config = await webApp();
    const started = await startSignIn(config, WEB_REDIRECT);
    const tapped = await webServerCall(base, started, ana.token, "/continue", {
      screen: "consent",
    });
    const callback = await followToApp(started, await redirectOf(tapped));
    const checks = {
      pkceCodeVerifier: started.verifier,
      expectedState: started.state,
      expectedNonce: started.nonce,
    };
    const first = await client.authorizationCodeGrant(config, callback, checks);
    const me = () =>
      fetch(`${issuer}/me`, { headers: { authorization: `Bearer ${first.access_token}` } });
    expect((await me()).status).toBe(200);
    await expect(client.authorizationCodeGrant(config, callback, checks)).rejects.toMatchObject({
      error: "invalid_grant",
    });
    // A reused code revokes what its first use issued.
    expect((await me()).status).toBe(401);
  });
});

describe("the real app's routes", () => {
  it("mount nothing under /oidc except the provider's catch-all", () => {
    expect(mountedUrls.length).toBeGreaterThan(50);
    expect([...new Set(mountedUrls.filter((url) => url.startsWith("/oidc")))]).toEqual(["/oidc/*"]);
  });
});

describe("what the provider refuses", () => {
  it("an inexact redirect URI is shown on a YourTal page, never redirected", async () => {
    const config = await webApp();
    const started = client.buildAuthorizationUrl(config, {
      redirect_uri: `${WEB_REDIRECT}/extra`,
      scope: "openid email profile account",
      code_challenge: await client.calculatePKCECodeChallenge(client.randomPKCECodeVerifier()),
      code_challenge_method: "S256",
      state: "s",
    });
    const response = await fetch(started, { redirect: "manual" });
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toContain("YourTal");
  });

  it("an unknown client is shown on a YourTal page, never redirected", async () => {
    const url = new URL(`${issuer}/auth`);
    url.search = new URLSearchParams({
      client_id: "evil-app",
      redirect_uri: "https://evil.example/cb",
      response_type: "code",
      scope: "openid account",
    }).toString();
    const response = await fetch(url, { redirect: "manual" });
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("prompt=none answers login_required", async () => {
    const config = await webApp();
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: WEB_REDIRECT,
      scope: "openid email profile account",
      code_challenge: await client.calculatePKCECodeChallenge(client.randomPKCECodeVerifier()),
      code_challenge_method: "S256",
      state: "s-none",
      prompt: "none",
    });
    const location = new URL(
      (await fetch(url, { redirect: "manual" })).headers.get("location") ?? "",
    );
    expect(location.origin + location.pathname).toBe(WEB_REDIRECT);
    expect(location.searchParams.get("error")).toBe("login_required");
    expect(location.searchParams.get("iss")).toBe(issuer);
  });

  it.each([
    ["a teen", { teen: true }, "teen_not_allowed"],
    ["an Indonesian account", { region: "ID" as const }, "region_not_supported"],
  ])("%s is refused at FTR, and the app hears access_denied", async (_who, options, refusal) => {
    const someone = await person(options);
    const config = await ftrApp();
    const started = await startSignIn(config, FTR_REDIRECT);
    const shown = await details(await webServerCall(base, started, someone.token, ""));
    expect(shown).toMatchObject({ screen: "refused", refusal, sharing: null });

    const forced = await webServerCall(base, started, someone.token, "/continue", {
      screen: "consent",
    });
    expect(forced.status).toBe(403);
    expect(await errorBody(forced)).toMatchObject({ code: "sign_in_refused", refusal });

    const cancelled = await webServerCall(base, started, someone.token, "/cancel", {});
    const back = await followToApp(started, await redirectOf(cancelled));
    expect(back.origin + back.pathname).toBe(FTR_REDIRECT);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("error_description")).toBe(refusal);
    expect(back.searchParams.get("state")).toBe(started.state);
    expect(back.searchParams.get("iss")).toBe(issuer);
    expect(back.searchParams.get("code")).toBeNull();

    const logged = await rows("SELECT client_id, result FROM oidc.sign_in_log WHERE user_id = $1", [
      someone.userId,
    ]);
    expect(logged).toContainEqual({ client_id: "ftr-web", result: refusal });
    expect(await rows("SELECT 1 FROM oidc.subject WHERE user_id = $1", [someone.userId])).toEqual(
      [],
    );
  });

  it("client credentials: SnapApp's server gets a teen_invites token; the website gets none", async () => {
    const server = await rp(
      "snapapp-staging-server",
      client.PrivateKeyJwt({ key: serverKey, kid: "snapapp-staging-server-1" }),
    );
    const token = await client.clientCredentialsGrant(server, { scope: "teen_invites" });
    expect(token.scope).toBe("teen_invites");
    expect(token.expires_in).toBeLessThanOrEqual(600);
    await expect(
      client.clientCredentialsGrant(await webApp(), { scope: "teen_invites" }),
    ).rejects.toMatchObject({
      // The library's answer for a grant the client is not registered for.
      error: "invalid_request",
      error_description: "requested grant type is not allowed for this client",
    });
    await expect(client.clientCredentialsGrant(server, { scope: "openid" })).rejects.toMatchObject({
      error: "invalid_scope",
    });
  });
});

describe("the interaction API", () => {
  it("shows the login screen without a YourTal session, and continue needs one", async () => {
    const started = await startSignIn(await webApp(), WEB_REDIRECT);
    const shown = await details(await webServerCall(base, started, null, ""));
    expect(shown).toMatchObject({ screen: "login", account: null, refusal: null });
    const tapped = await webServerCall(base, started, null, "/continue", { screen: "consent" });
    expect(tapped.status).toBe(401);
  });

  it("shows sign-up for prompt=create, verify for an unverified email, on hold for a suspended account", async () => {
    const create = await startSignIn(await webApp(), WEB_REDIRECT, { prompt: "create" });
    expect((await details(await webServerCall(base, create, null, ""))).screen).toBe("create");

    const unverified = await person({ verified: false });
    const verify = await startSignIn(await webApp(), WEB_REDIRECT);
    expect((await details(await webServerCall(base, verify, unverified.token, ""))).screen).toBe(
      "verify_email",
    );

    const held = await person();
    await pool.query("UPDATE identity.user_profile SET suspended_at = now() WHERE user_id = $1", [
      held.userId,
    ]);
    const hold = await startSignIn(await webApp(), WEB_REDIRECT);
    expect(await details(await webServerCall(base, hold, held.token, ""))).toMatchObject({
      screen: "refused",
      refusal: "account_on_hold",
    });
  });

  it("will not record consent from the continue screen", async () => {
    const ana = await person();
    const started = await startSignIn(await webApp(), WEB_REDIRECT);
    const tapped = await webServerCall(base, started, ana.token, "/continue", {
      screen: "continue",
    });
    expect(tapped.status).toBe(409);
    expect(await rows("SELECT 1 FROM oidc.app_consent WHERE user_id = $1", [ana.userId])).toEqual(
      [],
    );
  });

  it("opens nothing without the browser's interaction cookie, or for another uid", async () => {
    const ana = await person();
    const started = await startSignIn(await webApp(), WEB_REDIRECT);
    const bare = await fetch(`${base}/api/connect/${started.uid}`, {
      headers: { cookie: `yt_session=${ana.token}` },
    });
    expect(bare.status).toBe(404);
    // Another sign-in's cookie, presented for this uid.
    const other = await startSignIn(await webApp(), WEB_REDIRECT);
    const swapped = await fetch(`${base}/api/connect/${started.uid}`, {
      headers: {
        cookie: `${other.browser.cookieHeader(`/connect/${other.uid}`)}; yt_session=${ana.token}`,
      },
    });
    expect(swapped.status).toBe(404);
  });

  it("the API itself refuses a POST whose Origin is another site", async () => {
    const ana = await person();
    const started = await startSignIn(await webApp(), WEB_REDIRECT);
    const cookie = `${started.browser.cookieHeader(`/connect/${started.uid}`)}; yt_session=${ana.token}`;
    const response = await fetch(`${base}/api/connect/${started.uid}/continue`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ screen: "consent" }),
    });
    expect(response.status).toBe(403);
  });
});

/** A route of the real app, called as YourTal's web server calls it. */
async function api(
  url: string,
  options: { token?: string; payload?: Record<string, unknown> } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.inject({
    method: "POST",
    url,
    remoteAddress: testIp(),
    headers: options.token === undefined ? {} : bearer(options.token),
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

const tokenOf = (reply: { status: number; body: Record<string, unknown> }) => {
  expect(reply.status, JSON.stringify(reply.body)).toBe(201);
  return z.string().parse(reply.body["token"]);
};

/** When the session a token names says the person signed in, as auth_time counts it. */
async function authTimeOf(token: string): Promise<number> {
  const [row] = z
    .array(z.object({ signed_in_at: z.date() }))
    .parse(
      await rows("SELECT signed_in_at FROM identity.session WHERE id = $1", [
        hashOpaqueToken(token),
      ]),
    );
  return Math.floor((row?.signed_in_at.getTime() ?? 0) / 1000);
}

/** The person's sessions that still work. */
async function liveSessions(userId: string): Promise<unknown[]> {
  return rows("SELECT id FROM identity.session WHERE user_id = $1 AND revoked_at IS NULL", [
    userId,
  ]);
}

/** A real account, signed in with its password through the real route, email confirmed. */
async function verifiedAccount() {
  const account = await accountFor(app);
  await pool.query(
    "UPDATE identity.credential SET verified_at = now() WHERE user_id = $1 AND kind = 'password'",
    [account.userId],
  );
  return account;
}

async function passkeyFor(token: string): Promise<SoftAuthenticator> {
  const device = new SoftAuthenticator(E2E_RP_ID, E2E_ORIGIN);
  const options = await api("/api/auth/passkeys/register/options", { token });
  expect(options.status, JSON.stringify(options.body)).toBe(201);
  const response = device.register(
    options.body["options"] as PublicKeyCredentialCreationOptionsJSON,
  );
  expect((await api("/api/auth/passkeys/register", { token, payload: { response } })).status).toBe(
    201,
  );
  return device;
}

async function signInWithPasskey(device: SoftAuthenticator): Promise<string> {
  const ceremony = await api("/api/auth/passkeys/sign-in/options");
  const challengeId = z.string().parse(ceremony.body["challengeId"]);
  const options = ceremony.body["options"] as PublicKeyCredentialRequestOptionsJSON;
  return tokenOf(
    await api("/api/auth/passkeys/sign-in", {
      payload: { challengeId, response: device.assert(options) },
    }),
  );
}

describe("auth_time and amr come from the YourTal sign-in", () => {
  it("after a password, a passkey, and a password and code", async () => {
    const ana = await verifiedAccount();
    const password = await signIn(await webApp(), WEB_REDIRECT, ana, "consent");
    expect(password.tokens.claims()).toMatchObject({
      amr: ["pwd"],
      auth_time: await authTimeOf(ana.token),
    });

    const device = await passkeyFor(ana.token);
    const passkey = await signInWithPasskey(device);
    const withPasskey = await signIn(
      await webApp(),
      WEB_REDIRECT,
      { ...ana, token: passkey },
      "continue",
    );
    expect(withPasskey.tokens.claims()).toMatchObject({
      amr: ["hwk"],
      auth_time: await authTimeOf(passkey),
    });

    const bo = await verifiedAccount();
    const enrolled = await api("/api/auth/totp/enrol", { token: bo.token });
    const seed = z.string().parse(enrolled.body["secret"]);
    const code = (offset: number) => totpCodeAt(seed, new Date(Date.now() + offset * 1000));
    expect(
      (await api("/api/auth/totp/confirm", { token: bo.token, payload: { code: code(-30) } }))
        .status,
    ).toBe(201);
    const pending = await api("/api/auth/login", {
      payload: { email: bo.email, password: "factors-e2e-not-a-real-secret-1" },
    });
    const withCode = tokenOf(
      await api("/api/auth/totp/sign-in", {
        payload: { pendingToken: pending.body["pendingToken"], code: code(0) },
      }),
    );
    const mfa = await signIn(await ftrApp(), FTR_REDIRECT, { ...bo, token: withCode }, "consent");
    expect(mfa.tokens.claims()).toMatchObject({
      amr: ["pwd", "otp", "mfa"],
      auth_time: await authTimeOf(withCode),
    });
  });
});

describe("a fresh sign-in when the app asks for one", () => {
  const TWELVE_HOURS = 12 * 3600;

  it("max_age: an older sign-in is asked for again, without a second session", async () => {
    const ana = await verifiedAccount();
    await pool.query(
      "UPDATE identity.session SET signed_in_at = now() - interval '13 hours' WHERE user_id = $1",
      [ana.userId],
    );
    const config = await webApp();
    const started = await startSignIn(config, WEB_REDIRECT, { max_age: String(TWELVE_HOURS) });
    expect(await details(await webServerCall(base, started, ana.token, ""))).toMatchObject({
      screen: "sign_in_again",
      account: { email: ana.email },
      sharing: null,
    });
    const tapped = await webServerCall(base, started, ana.token, "/continue", {
      screen: "consent",
    });
    expect(tapped.status).toBe(401);

    // YourTal's sign-in takes signed-out callers only, so "Sign in again" signs out first.
    const credentials = { email: ana.email, password: "factors-e2e-not-a-real-secret-1" };
    expect((await api("/api/auth/login", { token: ana.token, payload: credentials })).status).toBe(
      403,
    );
    const before = await liveSessions(ana.userId);
    expect((await api("/api/auth/logout", { token: ana.token })).status).toBe(201);
    const again = tokenOf(await api("/api/auth/login", { payload: credentials }));
    // The old session ended and the new one took its place (registering left one of its own).
    const after = await liveSessions(ana.userId);
    expect(after).toHaveLength(before.length);
    expect(after).toContainEqual({ id: hashOpaqueToken(again) });
    expect(after).not.toContainEqual({ id: hashOpaqueToken(ana.token) });

    expect((await details(await webServerCall(base, started, again, ""))).screen).toBe("consent");
    const done = await webServerCall(base, started, again, "/continue", { screen: "consent" });
    const tokens = await client.authorizationCodeGrant(
      config,
      await followToApp(started, await redirectOf(done)),
      {
        pkceCodeVerifier: started.verifier,
        expectedState: started.state,
        expectedNonce: started.nonce,
        maxAge: TWELVE_HOURS,
      },
    );
    expect(tokens.claims()).toMatchObject({ amr: ["pwd"], auth_time: await authTimeOf(again) });
  });

  it("prompt=login: a sign-in from before the app asked is asked for again", async () => {
    const ana = await person();
    await pool.query(
      "UPDATE identity.session SET signed_in_at = now() - interval '1 minute' WHERE user_id = $1",
      [ana.userId],
    );
    const started = await startSignIn(await webApp(), WEB_REDIRECT, { prompt: "login" });
    expect((await details(await webServerCall(base, started, ana.token, ""))).screen).toBe(
      "sign_in_again",
    );
  });

  it("someone else signing in on the same browser gets their own sub, never the first's", async () => {
    const config = await webApp();
    const ana = await person();
    const first = await startSignIn(config, WEB_REDIRECT);
    const anaTapped = await webServerCall(base, first, ana.token, "/continue", {
      screen: "consent",
    });
    const anaSub = (
      await client.authorizationCodeGrant(
        config,
        await followToApp(first, await redirectOf(anaTapped)),
        {
          pkceCodeVerifier: first.verifier,
          expectedState: first.state,
          expectedNonce: first.nonce,
        },
      )
    ).claims()?.sub;
    expect(anaSub).toBeDefined();

    const bob = await person();
    const second = await startSignIn(config, WEB_REDIRECT, {}, first.browser);
    const tapped = await webServerCall(base, second, bob.token, "/continue", { screen: "consent" });
    // The provider's own session is still Ana's, so the library signs it out first.
    const signOut = await second.browser.get(await redirectOf(tapped));
    expect(signOut.status).toBe(200);
    const resumed = await second.browser.submitForm(await signOut.text());
    expect(resumed.status).toBe(303);
    const tokens = await client.authorizationCodeGrant(
      config,
      await followToApp(second, resumed.headers.get("location") ?? ""),
      {
        pkceCodeVerifier: second.verifier,
        expectedState: second.state,
        expectedNonce: second.nonce,
      },
    );
    expect(await rows("SELECT sub FROM oidc.subject WHERE user_id = $1", [bob.userId])).toEqual([
      { sub: tokens.claims()?.sub },
    ]);
    expect(tokens.claims()?.sub).not.toBe(anaSub);
  });
});

/** A teen whose guardian is `guardianEmail`, approved unless `approved` is false. */
async function teenOf(guardianEmail: string, approved = true): Promise<Person> {
  const teen = await person({ teen: true });
  await pool.query(
    `INSERT INTO identity.guardian_consent
       (user_id, token_hash, guardian_email, region, guardian_confirmed_adult_at, approved_at)
     VALUES ($1, $2, $3, 'AU', $4, $4)`,
    [teen.userId, randomBytes(32).toString("hex"), guardianEmail, approved ? new Date() : null],
  );
  if (!approved) {
    await pool.query(
      "UPDATE identity.user_profile SET parent_consent_status = 'pending' WHERE user_id = $1",
      [teen.userId],
    );
  }
  return teen;
}

const serverApp = () =>
  rp(
    "snapapp-staging-server",
    client.PrivateKeyJwt({ key: serverKey, kid: "snapapp-staging-server-1" }),
  );

async function serverToken(): Promise<string> {
  return (await client.clientCredentialsGrant(await serverApp(), { scope: "teen_invites" }))
    .access_token;
}

/** SnapApp's server calling the invite API. */
async function inviteApi(
  token: string,
  path: string,
  body?: Record<string, unknown>,
  key: string = randomUUID(),
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}/api/oidc-clients/teen-invites${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-forwarded-for": testIp(),
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json", "idempotency-key": key }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** A parent who has signed in to SnapApp, and their sub there. */
async function snapParent(): Promise<Person & { sub: string }> {
  const parent = await person();
  const { tokens } = await signIn(await webApp(), WEB_REDIRECT, parent, "consent");
  return { ...parent, sub: tokens.claims()?.sub ?? "" };
}

async function invite(
  token: string,
  parentSub: string,
): Promise<{ inviteId: string; code: string }> {
  const made = await inviteApi(token, "", { parentSub });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  return z.object({ inviteId: z.string(), code: z.string() }).parse(made.body);
}

/** The teen's screen at SnapApp, with this invite code if any. */
async function teenScreen(teen: Person, code?: string) {
  const started = await startSignIn(
    await webApp(),
    WEB_REDIRECT,
    code === undefined ? {} : { teen_invite: code },
  );
  return { started, shown: await details(await webServerCall(base, started, teen.token, "")) };
}

describe("teens (docs/26 §1.5 check 4, §3.3)", () => {
  it("a teen joins SnapApp with the approving guardian's invite, once, and the parent can end it", async () => {
    const token = await serverToken();
    const parent = await snapParent();
    const teen = await teenOf(parent.email.toUpperCase());
    const { inviteId, code } = await invite(token, parent.sub);
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // Kept only as a hash.
    expect(
      JSON.stringify(await rows("SELECT * FROM oidc.teen_invite WHERE id = $1", [inviteId])),
    ).not.toContain(code);
    expect((await inviteApi(token, `/${inviteId}`)).body).toEqual({
      inviteId,
      status: "pending",
      teenSub: null,
    });

    const { started, shown } = await teenScreen(teen, code);
    expect(shown).toMatchObject({
      screen: "consent",
      teenInvite: { parentName: "Ana" },
      sharing: { ageBand: "teen", region: "AU" },
    });
    const tapped = await webServerCall(base, started, teen.token, "/continue", {
      screen: "consent",
    });
    expect(tapped.status).toBe(200);
    const tokens = await client.authorizationCodeGrant(
      await webApp(),
      await followToApp(started, await redirectOf(tapped)),
      {
        pkceCodeVerifier: started.verifier,
        expectedState: started.state,
        expectedNonce: started.nonce,
      },
    );
    const claims = tokens.claims();
    expect(claims).toMatchObject({ age_band: "teen", region: "AU", email: teen.email });
    // The same §1.3 claims as an adult's, and nothing more.
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
    expect((await inviteApi(token, `/${inviteId}`)).body).toEqual({
      inviteId,
      status: "accepted",
      teenSub: claims?.sub,
    });
    expect(
      await rows(`SELECT source, audience, state FROM identity.consent_record WHERE user_id = $1`, [
        teen.userId,
      ]),
    ).toEqual([{ source: "guardian_invite", audience: "snapapp-staging", state: "granted" }]);

    // While it stands the teen signs in again with no invite; the used code opens nothing new.
    expect((await teenScreen(teen)).shown.screen).toBe("continue");
    const other = await teenOf("someone-else@example.test");
    expect((await teenScreen(other, code)).shown).toMatchObject({
      screen: "refused",
      refusal: "teen_invite_required",
      inviteProblem: "invite_expired",
    });
    // A standing SnapApp invite opens no other app.
    const ftr = await startSignIn(await ftrApp(), FTR_REDIRECT);
    expect(await details(await webServerCall(base, ftr, teen.token, ""))).toMatchObject({
      refusal: "teen_not_allowed",
    });

    // Someone else's sub cannot end it.
    const stranger = await snapParent();
    expect((await inviteApi(token, `/${inviteId}/end`, { parentSub: stranger.sub })).status).toBe(
      404,
    );
    const ended = await inviteApi(token, `/${inviteId}/end`, { parentSub: parent.sub });
    expect(ended).toEqual({
      status: 200,
      body: { inviteId, status: "ended", teenSub: claims?.sub },
    });
    expect(
      await rows(
        "SELECT client_id, sub, event_type, payload FROM oidc.event_outbox WHERE sub = $1",
        [claims?.sub],
      ),
    ).toEqual([
      {
        client_id: "snapapp-staging-server",
        sub: claims?.sub,
        event_type: "urn:yourtal:event:access-ended",
        payload: {
          "urn:yourtal:event:access-ended": { reason: "parent_ended", erase_data: true },
        },
      },
    ]);
    expect((await teenScreen(teen)).shown).toMatchObject({
      screen: "refused",
      inviteProblem: "no_invite",
    });
    // The token issued before the end no longer answers userinfo.
    const me = await fetch(`${issuer}/me`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(me.status).toBe(401);
  });

  it("a teen without an invite at SnapApp needs one, and hears why", async () => {
    const parent = await snapParent();
    expect((await teenScreen(await teenOf(parent.email))).shown).toMatchObject({
      screen: "refused",
      refusal: "teen_invite_required",
      inviteProblem: "no_invite",
    });
    const { code } = await invite(await serverToken(), parent.sub);
    expect((await teenScreen(await teenOf(parent.email, false), code)).shown).toMatchObject({
      refusal: "teen_invite_required",
      inviteProblem: "not_approved",
    });
  });

  it("an invite from someone who is not the teen's approving guardian is refused, and Continue cannot force it", async () => {
    const guardian = await snapParent();
    const stranger = await snapParent();
    const teen = await teenOf(guardian.email);
    const { code, inviteId } = await invite(await serverToken(), stranger.sub);
    const { started, shown } = await teenScreen(teen, code);
    expect(shown).toMatchObject({
      refusal: "teen_invite_required",
      inviteProblem: "wrong_inviter",
    });
    const forced = await webServerCall(base, started, teen.token, "/continue", {
      screen: "consent",
    });
    expect(forced.status).toBe(403);
    expect((await inviteApi(await serverToken(), `/${inviteId}`)).body).toMatchObject({
      status: "pending",
    });
  });

  it("an expired invite is refused", async () => {
    const token = await serverToken();
    const parent = await snapParent();
    const teen = await teenOf(parent.email);
    const { code, inviteId } = await invite(token, parent.sub);
    await pool.query(
      `UPDATE oidc.teen_invite SET created_at = now() - interval '8 days',
              expires_at = now() - interval '1 day' WHERE id = $1`,
      [inviteId],
    );
    expect((await teenScreen(teen, code)).shown).toMatchObject({ inviteProblem: "invite_expired" });
    expect((await inviteApi(token, `/${inviteId}`)).body).toMatchObject({ status: "expired" });
  });

  it("the invite API takes only SnapApp's server token with teen_invites", async () => {
    const parent = await snapParent();
    const anon = await fetch(`${base}/api/oidc-clients/teen-invites`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ parentSub: parent.sub }),
    });
    expect(anon.status).toBe(401);
    // A person's access token is not a client-credentials token.
    const { tokens } = await signIn(await webApp(), WEB_REDIRECT, await person(), "consent");
    expect((await inviteApi(tokens.access_token, "", { parentSub: parent.sub })).status).toBe(401);
    // SnapApp's server, without the scope.
    const bare = await client.clientCredentialsGrant(await serverApp(), {});
    expect((await inviteApi(bare.access_token, "", { parentSub: parent.sub })).body).toMatchObject({
      code: "insufficient_scope",
    });
  });

  it("refuses a parent who is not a verified adult, caps 10 a day, and replays without the code", async () => {
    const token = await serverToken();
    const unknown = await inviteApi(token, "", { parentSub: "not-a-sub" });
    expect(unknown).toMatchObject({ status: 403, body: { code: "parent_not_eligible" } });

    const parent = await snapParent();
    const key = randomUUID();
    const first = await inviteApi(token, "", { parentSub: parent.sub }, key);
    const replay = await inviteApi(token, "", { parentSub: parent.sub }, key);
    expect(first.body["code"]).toBeDefined();
    expect(replay.body).toEqual({
      inviteId: first.body["inviteId"],
      expiresAt: first.body["expiresAt"],
    });
    for (let made = 1; made < 10; made += 1) await invite(token, parent.sub);
    expect((await inviteApi(token, "", { parentSub: parent.sub })).body).toMatchObject({
      code: "too_many_invites",
    });
  });

  it("an adult is unaffected by a teen_invite parameter", async () => {
    const adult = await person();
    const { started, shown } = await teenScreen(adult, "made-up-code");
    expect(shown).toMatchObject({ screen: "consent", teenInvite: null, refusal: null });
    const tapped = await webServerCall(base, started, adult.token, "/continue", {
      screen: "consent",
    });
    expect(tapped.status).toBe(200);
  });
});

/** The teen taps Continue on their consent screen, and the browser comes back to SnapApp with a code. */
async function teenJoins(teen: Person, code: string) {
  const { started, shown } = await teenScreen(teen, code);
  expect(shown.screen).toBe("consent");
  const tapped = await webServerCall(base, started, teen.token, "/continue", { screen: "consent" });
  expect(tapped.status, await tapped.clone().text()).toBe(200);
  const callback = await followToApp(started, await redirectOf(tapped));
  const redeem = async () =>
    client.authorizationCodeGrant(await webApp(), callback, {
      pkceCodeVerifier: started.verifier,
      expectedState: started.state,
      expectedNonce: started.nonce,
    });
  return { redeem };
}

describe("teens: races and changes after acceptance", () => {
  it("two Continues racing on one code: one teen gets in, the other is refused", async () => {
    const parent = await snapParent();
    // A guardian with two teens: the link works for either, but only once.
    const [first, second] = [await teenOf(parent.email), await teenOf(parent.email)];
    const { code, inviteId } = await invite(await serverToken(), parent.sub);
    const screens = [await teenScreen(first, code), await teenScreen(second, code)];
    expect(screens.map(({ shown }) => shown.screen)).toEqual(["consent", "consent"]);
    const taps = await Promise.all(
      screens.map(({ started }, index) =>
        webServerCall(base, started, (index === 0 ? first : second).token, "/continue", {
          screen: "consent",
        }),
      ),
    );
    expect(taps.map((tap) => tap.status).sort()).toEqual([200, 403]);
    expect(
      await rows(
        `SELECT count(*)::int AS n FROM identity.consent_record
          WHERE user_id = ANY($1) AND source = 'guardian_invite'`,
        [[first.userId, second.userId]],
      ),
    ).toEqual([{ n: 1 }]);
    expect(
      await rows(
        "SELECT count(*)::int AS n FROM oidc.teen_invite WHERE id = $1 AND accepted_at IS NOT NULL",
        [inviteId],
      ),
    ).toEqual([{ n: 1 }]);
  });

  it("the guardian withdrawing approval after acceptance stops /connect and /me", async () => {
    const parent = await snapParent();
    const teen = await teenOf(parent.email);
    const { code } = await invite(await serverToken(), parent.sub);
    const tokens = await (await teenJoins(teen, code)).redeem();
    await pool.query(
      `UPDATE identity.guardian_consent SET approved_at = NULL, revoked_at = now() WHERE user_id = $1`,
      [teen.userId],
    );
    await pool.query(
      "UPDATE identity.user_profile SET parent_consent_status = 'revoked' WHERE user_id = $1",
      [teen.userId],
    );
    expect((await teenScreen(teen)).shown).toMatchObject({
      screen: "refused",
      inviteProblem: "not_approved",
    });
    const me = await fetch(`${issuer}/me`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(me.status).toBe(401);
  });

  it("/token refuses a code when the parent ends the invite before it is redeemed", async () => {
    const parent = await snapParent();
    const teen = await teenOf(parent.email);
    const token = await serverToken();
    const { code, inviteId } = await invite(token, parent.sub);
    const { redeem } = await teenJoins(teen, code);
    expect((await inviteApi(token, `/${inviteId}/end`, { parentSub: parent.sub })).status).toBe(
      200,
    );
    await expect(redeem()).rejects.toMatchObject({ error: "invalid_grant" });
  });

  it("a teen who turned 18 and agreed again as an adult is never erased by the parent's end", async () => {
    const parent = await snapParent();
    const teen = await teenOf(parent.email);
    const token = await serverToken();
    const { code, inviteId } = await invite(token, parent.sub);
    const sub = (await (await teenJoins(teen, code)).redeem()).claims()?.sub;

    await pool.query(
      "UPDATE identity.user_profile SET date_of_birth = DATE '2000-01-01' WHERE user_id = $1",
      [teen.userId],
    );
    // The parent's view has nothing to stand on any more.
    expect((await inviteApi(token, `/${inviteId}`)).body).toMatchObject({ status: "ended" });
    const adult = await signIn(await webApp(), WEB_REDIRECT, teen, "consent");
    expect(adult.details.teenInvite).toBeNull();
    expect(adult.tokens.claims()).toMatchObject({ sub, age_band: "adult" });

    const ended = await inviteApi(token, `/${inviteId}/end`, { parentSub: parent.sub });
    expect(ended).toMatchObject({ status: 200, body: { status: "ended" } });
    expect(await rows("SELECT 1 FROM oidc.event_outbox WHERE sub = $1", [sub])).toEqual([]);
    expect(
      await rows("SELECT granted_via, ended_at FROM oidc.app_consent WHERE user_id = $1", [
        teen.userId,
      ]),
    ).toEqual([{ granted_via: "consent_screen", ended_at: null }]);
    // And they still sign in.
    expect((await teenScreen(teen)).shown.screen).toBe("continue");
  });
});
