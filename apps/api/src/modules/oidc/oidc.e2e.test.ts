import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { compactDecrypt, createRemoteJWKSet, jwtVerify } from "jose";
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
import { receiversFor } from "@yourtal/contracts/oidc/event-receivers";
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
import { ftrOpenTransfer } from "./testing/ftr-transfer-check";
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
    // 3.7 Y3: the end goes through `end_app_access`, so its evidence carries the reason as its source.
    expect(
      await rows(
        `SELECT source, audience FROM identity.consent_record WHERE user_id = $1 AND state = 'withdrawn'`,
        [teen.userId],
      ),
    ).toEqual([{ source: "parent_ended", audience: "snapapp-staging" }]);
    expect(
      await rows("SELECT end_reason FROM oidc.app_consent WHERE user_id = $1", [teen.userId]),
    ).toEqual([{ end_reason: "parent_ended" }]);
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

/** Me → Linked apps, called with the person's own session. */
async function meApps(method: "GET" | "DELETE", who: Person, app = "") {
  const response = await inject(
    method,
    `/api/me/connected-apps${app === "" ? "" : `/${app}`}`,
    who,
  );
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

function inject(method: "GET" | "DELETE", url: string, who: Person) {
  return app.inject({ method, url, remoteAddress: testIp(), headers: bearer(who.token) });
}

const outboxOf = (sub: string | undefined) =>
  rows("SELECT client_id, payload FROM oidc.event_outbox WHERE sub = $1", [sub]);

describe("removing an app from Me -> Linked apps (3.7 Y3)", () => {
  it("lists live consents only, with the app and company from the registry and no sub", async () => {
    const adult = await person();
    expect(await meApps("GET", adult)).toEqual({ status: 200, body: { connectedApps: [] } });
    const { tokens } = await signIn(await webApp(), WEB_REDIRECT, adult, "consent");
    const ftr = await signIn(await ftrApp(), FTR_REDIRECT, adult, "consent");

    const listed = await meApps("GET", adult);
    expect(listed.status).toBe(200);
    const apps = z
      .array(z.looseObject({ app: z.string(), name: z.string(), operator: z.string() }))
      .parse(listed.body["connectedApps"]);
    // Oldest grant first.
    expect(apps.map(({ app, name, operator }) => ({ app, name, operator }))).toEqual([
      { app: "snapapp", name: "SnapApp", operator: "SnapApp" },
      { app: "ftr", name: "Free Tax Returns", operator: "Free Tax Returns" },
    ]);
    const text = JSON.stringify(listed.body);
    for (const sub of [tokens.claims()?.sub, ftr.tokens.claims()?.sub]) {
      expect(text).not.toContain(sub ?? "no sub");
    }

    expect((await meApps("DELETE", adult, "snapapp")).status).toBe(200);
    expect(
      z
        .array(z.looseObject({ app: z.string() }))
        .parse((await meApps("GET", adult)).body["connectedApps"]),
    ).toMatchObject([{ app: "ftr" }]);
  });

  it("an adult's removal records user_removed once, keeps their app account, and the next sign-in asks again", async () => {
    const adult = await person();
    const sub = (await signIn(await webApp(), WEB_REDIRECT, adult, "consent")).tokens.claims()?.sub;

    const removed = await meApps("DELETE", adult, "snapapp");
    expect(removed).toEqual({ status: 200, body: { app: "snapapp", connected: false } });
    expect(
      await rows("SELECT end_reason FROM oidc.app_consent WHERE user_id = $1", [adult.userId]),
    ).toEqual([{ end_reason: "user_removed" }]);
    expect(
      await rows(
        `SELECT source, audience FROM identity.consent_record WHERE user_id = $1 AND state = 'withdrawn'`,
        [adult.userId],
      ),
    ).toEqual([{ source: "user_removed", audience: "snapapp-staging" }]);
    expect(await outboxOf(sub)).toEqual([
      {
        client_id: "snapapp-staging-server",
        payload: {
          "urn:yourtal:event:access-ended": { reason: "user_removed", erase_data: false },
        },
      },
    ]);

    // A repeat changes nothing.
    expect((await meApps("DELETE", adult, "snapapp")).status).toBe(200);
    expect(await outboxOf(sub)).toHaveLength(1);
    expect(
      await rows(
        "SELECT count(*)::int AS n FROM identity.consent_record WHERE user_id = $1 AND state = 'withdrawn'",
        [adult.userId],
      ),
    ).toEqual([{ n: 1 }]);

    // The same sub, and the consent screen again.
    const again = await signIn(await webApp(), WEB_REDIRECT, adult, "consent");
    expect(again.tokens.claims()?.sub).toBe(sub);
  });

  it("a teen's removal records teen_removed, ends the invite, and needs a new invite", async () => {
    const parent = await snapParent();
    const teen = await teenOf(parent.email);
    const token = await serverToken();
    const { code, inviteId } = await invite(token, parent.sub);
    const sub = (await (await teenJoins(teen, code)).redeem()).claims()?.sub;

    expect((await meApps("GET", teen)).body["connectedApps"]).toHaveLength(1);
    expect((await meApps("DELETE", teen, "snapapp")).status).toBe(200);
    expect(
      await rows("SELECT end_reason FROM oidc.app_consent WHERE user_id = $1", [teen.userId]),
    ).toEqual([{ end_reason: "teen_removed" }]);
    expect(await rows("SELECT end_reason FROM oidc.teen_invite WHERE id = $1", [inviteId])).toEqual(
      [{ end_reason: "teen_removed" }],
    );
    expect(await outboxOf(sub)).toEqual([
      {
        client_id: "snapapp-staging-server",
        payload: {
          "urn:yourtal:event:access-ended": { reason: "teen_removed", erase_data: true },
        },
      },
    ]);
    expect((await meApps("GET", teen)).body["connectedApps"]).toEqual([]);

    expect((await meApps("DELETE", teen, "snapapp")).status).toBe(200);
    expect(await outboxOf(sub)).toHaveLength(1);
    expect((await teenScreen(teen)).shown).toMatchObject({
      screen: "refused",
      inviteProblem: "no_invite",
    });
  });

  it("a teen's consent that no invite stands behind still ends, as an ordinary removal", async () => {
    const teen = await teenOf("someone@example.test");
    const sub = randomUUID();
    await pool.query("INSERT INTO oidc.subject (sector, user_id, sub) VALUES ($1, $2, $3)", [
      "snapapp-staging",
      teen.userId,
      sub,
    ]);
    await pool.query(
      `INSERT INTO oidc.app_consent (user_id, sector, scopes, policy_version_id, granted_via, granted_at)
       VALUES ($1, 'snapapp-staging', '{openid}', 'pv-1', 'consent_screen', now())`,
      [teen.userId],
    );
    expect((await meApps("GET", teen)).body["connectedApps"]).toHaveLength(1);
    expect((await meApps("DELETE", teen, "snapapp")).status).toBe(200);
    expect(
      await rows("SELECT end_reason FROM oidc.app_consent WHERE user_id = $1", [teen.userId]),
    ).toEqual([{ end_reason: "user_removed" }]);
    expect((await meApps("GET", teen)).body["connectedApps"]).toEqual([]);
    expect(await outboxOf(sub)).toHaveLength(1);
  });

  it("answers 404 for an app YourTal does not know, and 401 without a session", async () => {
    const adult = await person();
    expect((await meApps("DELETE", adult, "not-an-app")).status).toBe(404);
    const anonymous = await app.inject({ method: "GET", url: "/api/me/connected-apps" });
    expect(anonymous.statusCode).toBe(401);
  });

  it("the data export lists the person's app consents, live and ended, and never a sub", async () => {
    const adult = await person();
    const snap = (await signIn(await webApp(), WEB_REDIRECT, adult, "consent")).tokens.claims()
      ?.sub;
    const ftr = (await signIn(await ftrApp(), FTR_REDIRECT, adult, "consent")).tokens.claims()?.sub;
    await meApps("DELETE", adult, "ftr");

    const exported = await inject("GET", "/api/me/data-export", adult);
    expect(exported.statusCode, exported.body).toBe(200);
    const body = exported.json<{ connectedApps: Record<string, unknown>[] }>();
    expect(body.connectedApps.map((row) => [row["app"], row["ended"] === null]).sort()).toEqual([
      ["ftr", false],
      ["snapapp", true],
    ]);
    expect(Object.keys(body.connectedApps[0] ?? {}).sort()).toEqual([
      "app",
      "ended",
      "granted",
      "scopes",
    ]);
    expect(exported.body).not.toContain(snap ?? "no sub");
    expect(exported.body).not.toContain(ftr ?? "no sub");
  });
});

/** SnapApp's server calling the transfer API. */
async function transferApi(token: string, path: string, body: Record<string, unknown>) {
  const response = await fetch(`${base}/api/oidc-clients/transfers${path}`, {
    method: "POST",
    headers: {
      "x-forwarded-for": testIp(),
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function transferToken(scope = "app_transfers"): Promise<string> {
  return (await client.clientCredentialsGrant(await serverApp(), { scope })).access_token;
}

const BUNDLE_SHA256 = createHash("sha256").update("a bundle").digest("hex");
const transfersOf = () => {
  const transfers = app.get<OidcRuntime>(OIDC_RUNTIME).transfers;
  if (transfers === null) throw new Error("transfers are off");
  return transfers;
};

/** The person's Send, on a screen started by a SnapApp client unless `sector` says otherwise. */
const approve = (
  transferId: string,
  userId: string,
  now = new Date(),
  sector = "snapapp-staging",
) => transfersOf().approve({ sector, transferId, userId, now });

/** An adult in AU signed in to SnapApp and, unless `ftr` is false, to FTR: both their subs. */
async function sender(ftr = true) {
  const who = await person();
  const snapSub = (await signIn(await webApp(), WEB_REDIRECT, who, "consent")).tokens.claims()?.sub;
  const ftrSub = ftr
    ? (await signIn(await ftrApp(), FTR_REDIRECT, who, "consent")).tokens.claims()?.sub
    : undefined;
  return { ...who, snapSub: snapSub ?? "", ftrSub };
}

async function openTransfer(token: string, fromSub: string): Promise<string> {
  const made = await transferApi(token, "", {
    fromSub,
    to: "ftr",
    financialYear: "2025-26",
    bundleSha256: BUNDLE_SHA256,
    lineCount: 7,
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  return z.object({ transferId: z.uuid() }).parse(made.body).transferId;
}

/** Opened as FTR will: dir/A256GCM with SHA-256 of its secret, then RS256 against the JWKS. */
async function openAssertion(assertion: string) {
  const { plaintext, protectedHeader } = await compactDecrypt(
    assertion,
    createHash("sha256").update(ftrSecret).digest(),
  );
  expect(protectedHeader).toEqual({ alg: "dir", enc: "A256GCM", cty: "JWT" });
  const jws = new TextDecoder().decode(plaintext);
  const verified = await jwtVerify(jws, createRemoteJWKSet(new URL(`${issuer}/jwks`)), {
    issuer,
    audience: "ftr-web",
    typ: "transfer+jwt",
    algorithms: ["RS256"],
  });
  return { jws, payload: verified.payload, header: verified.protectedHeader };
}

describe("app transfers: SnapApp to FTR (docs/30 §5, 4.8 Y1)", () => {
  it("opens a transfer for SnapApp's own sub; the assertion follows the person's Send, for FTR's sub only", async () => {
    const token = await transferToken();
    const ana = await sender();
    const before = Date.now();
    const made = await transferApi(token, "", {
      fromSub: ana.snapSub,
      to: "ftr",
      financialYear: "2025-26",
      bundleSha256: BUNDLE_SHA256,
      lineCount: 7,
    });
    expect(made.status).toBe(201);
    const { transferId, expiresAt } = z
      .object({ transferId: z.uuid(), expiresAt: z.iso.datetime() })
      .parse(made.body);
    const ttl = Date.parse(expiresAt) - before;
    expect(ttl).toBeGreaterThan(14 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000 + 5000);
    // Held as the provider's own kind of row: no amount, no sub, the person by user id.
    expect(
      await rows("SELECT payload FROM oidc.model WHERE kind = 'AppTransfer' AND id = $1", [
        transferId,
      ]),
    ).toEqual([
      {
        payload: {
          accountId: ana.userId,
          fromSector: "snapapp-staging",
          toClientId: "ftr-web",
          kind: "deduction-bundle-v1",
          financialYear: "2025-26",
          bundleSha256: BUNDLE_SHA256,
          lineCount: 7,
        },
      },
    ]);

    const early = await transferApi(token, `/${transferId}/assertion`, { fromSub: ana.snapSub });
    expect(early).toMatchObject({ status: 409, body: { code: "not_approved" } });

    const approvedAt = new Date();
    expect(await approve(transferId, ana.userId, approvedAt)).toBeNull();
    const first = await transferApi(token, `/${transferId}/assertion`, { fromSub: ana.snapSub });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.cacheControl).toBe("no-store");
    expect(first.body["expiresAt"]).toBe(expiresAt);
    const assertion = z.string().parse(first.body["assertion"]);
    // Ciphertext to SnapApp: neither FTR's sub nor the claims show.
    expect(assertion.split(".")).toHaveLength(5);
    expect(Buffer.from(assertion.replaceAll(".", ""), "base64url").toString()).not.toContain(
      ana.ftrSub,
    );

    const opened = await openAssertion(assertion);
    expect(opened.header).toMatchObject({ alg: "RS256", typ: "transfer+jwt" });
    const exp = Math.floor(Date.parse(expiresAt) / 1000);
    expect(opened.payload).toEqual({
      iss: issuer,
      aud: "ftr-web",
      azp: "snapapp-staging-server",
      sub: ana.ftrSub,
      jti: transferId,
      iat: Math.floor(approvedAt.getTime() / 1000),
      exp,
      region: "AU",
      age_band: "adult",
      kind: "deduction-bundle-v1",
      source: "snapapp",
      financial_year: "2025-26",
      bundle_sha256: BUNDLE_SHA256,
    });
    expect(exp - (opened.payload.iat ?? 0)).toBeLessThanOrEqual(15 * 60);
    expect(opened.payload.sub).not.toBe(ana.snapSub);
    // Another key cannot open it.
    await expect(
      compactDecrypt(assertion, createHash("sha256").update("not-ftr").digest()),
    ).rejects.toThrow();

    // A second call: a fresh encryption of the same signed claims, and a second approval changes nothing.
    expect(await approve(transferId, ana.userId, new Date(Date.now() + 5000))).toBeNull();
    const second = await transferApi(token, `/${transferId}/assertion`, { fromSub: ana.snapSub });
    expect(second.status).toBe(200);
    expect(second.body["assertion"]).not.toBe(assertion);
    expect((await openAssertion(z.string().parse(second.body["assertion"]))).jws).toBe(opened.jws);
    // Never kept by the idempotency layer.
    expect(
      await rows("SELECT 1 FROM platform.idempotency t WHERE t::text LIKE $1", [
        `%${assertion.slice(0, 40)}%`,
      ]),
    ).toEqual([]);
  });

  it("makes an assertion FTR's own check accepts, for the bundle's bytes", async () => {
    const token = await transferToken();
    const ana = await sender();
    const bundle = Buffer.from(JSON.stringify({ version: 1, financialYear: "2025-26", lines: [] }));
    const made = await transferApi(token, "", {
      fromSub: ana.snapSub,
      to: "ftr",
      financialYear: "2025-26",
      bundleSha256: createHash("sha256").update(bundle).digest("hex"),
      lineCount: 0,
    });
    const transferId = z.object({ transferId: z.uuid() }).parse(made.body).transferId;
    expect(await approve(transferId, ana.userId)).toBeNull();
    const minted = await transferApi(token, `/${transferId}/assertion`, { fromSub: ana.snapSub });
    const assertion = z.string().parse(minted.body["assertion"]);
    const jwks = createRemoteJWKSet(new URL(`${issuer}/jwks`));
    // FTR reads its secret from an env value it trims.
    expect(await ftrOpenTransfer(assertion, issuer, "ftr-web", `${ftrSecret}\n`, jwks)).toEqual({
      ok: true,
      sub: ana.ftrSub,
      jti: transferId,
      financialYear: "2025-26",
      bundleSha256: createHash("sha256").update(bundle).digest("hex"),
    });
    for (const [wrongIssuer, clientId, secret] of [
      [`${issuer}/x`, "ftr-web", ftrSecret],
      [issuer, "snapapp-staging-web", ftrSecret],
      [issuer, "ftr-web", `${ftrSecret}x`],
    ] as const) {
      expect(await ftrOpenTransfer(assertion, wrongIssuer, clientId, secret, jwks)).toEqual({
        ok: false,
        err: "invalid_token",
      });
    }
  });

  it("answers 404 for a sub that is no one in SnapApp, another person's sub, another app's transfer or an unknown one", async () => {
    const token = await transferToken();
    const ana = await sender();
    const ben = await sender();
    for (const fromSub of [ana.ftrSub, "nobody"]) {
      const made = await transferApi(token, "", {
        fromSub,
        to: "ftr",
        financialYear: "2025-26",
        bundleSha256: BUNDLE_SHA256,
        lineCount: 1,
      });
      expect(made).toMatchObject({ status: 404, body: { code: "unknown_subject" } });
    }
    const bad = await transferApi(token, "", {
      fromSub: ana.snapSub,
      to: "ftr",
      financialYear: "2025-27",
      bundleSha256: "ABC",
      lineCount: 1,
    });
    expect(bad.status).toBe(400);

    const transferId = await openTransfer(token, ana.snapSub);
    // The approval is Ana's alone, and only on a screen of the transfer's own app.
    expect(await approve(transferId, ben.userId)).toBe("wrong_account");
    expect(await approve(transferId, ana.userId, new Date(), "ftr")).toBe("expired");
    expect(
      await transferApi(token, `/${transferId}/assertion`, { fromSub: ana.snapSub }),
    ).toMatchObject({ status: 409, body: { code: "not_approved" } });
    expect(await approve(transferId, ana.userId)).toBeNull();
    for (const [path, fromSub] of [
      [`/${transferId}/assertion`, ben.snapSub],
      [`/${transferId}/assertion`, ana.ftrSub],
      [`/${randomUUID()}/assertion`, ana.snapSub],
      ["/not-a-uuid/assertion", ana.snapSub],
    ] as const) {
      expect(await transferApi(token, path, { fromSub })).toMatchObject({
        status: 404,
        body: { code: "transfer_not_found" },
      });
    }
    // A transfer opened by another app's sector is not SnapApp's to fetch.
    const foreign = randomUUID();
    await pool.query(
      `INSERT INTO oidc.model (kind, id, payload, expires_at)
       SELECT 'AppTransfer', $1, payload || '{"fromSector": "ftr"}', expires_at
         FROM oidc.model WHERE kind = 'AppTransfer' AND id = $2`,
      [foreign, transferId],
    );
    expect(
      (await transferApi(token, `/${foreign}/assertion`, { fromSub: ana.snapSub })).status,
    ).toBe(404);

    // Another sector's client never sees it, even with a sub that maps to the same person there.
    expect(await transfersOf().find({ sector: "ftr", transferId, now: new Date() })).toBeNull();
    const server = app
      .get<OidcRuntime>(OIDC_RUNTIME)
      .clients.find((one) => one.clientId === "snapapp-staging-server");
    if (server?.kind !== "machine") throw new Error("no SnapApp server client");
    expect(
      await transfersOf().assertion({
        client: { ...server, clientId: "other-server", sector: "ftr" },
        transferId,
        fromSub: ana.ftrSub ?? "",
        now: new Date(),
      }),
    ).toEqual({ ok: false, error: "not_found" });

    // The screen's checks, for Y2.
    const transfer = await transfersOf().find({
      sector: "snapapp-staging",
      transferId,
      now: new Date(),
    });
    expect(transfer).not.toBeNull();
    if (transfer === null) return;
    expect(await transfersOf().check({ transfer, userId: ben.userId, now: new Date() })).toBe(
      "wrong_account",
    );
    expect(await transfersOf().check({ transfer, userId: ana.userId, now: new Date() })).toBeNull();
  });

  it("takes only SnapApp's server token with app_transfers", async () => {
    const ana = await sender(false);
    const body = {
      fromSub: ana.snapSub,
      to: "ftr",
      financialYear: "2025-26",
      bundleSha256: BUNDLE_SHA256,
      lineCount: 1,
    };
    expect((await transferApi("", "", body)).status).toBe(401);
    expect(await transferApi(await transferToken("teen_invites"), "", body)).toMatchObject({
      status: 403,
      body: { code: "insufficient_scope" },
    });
    // And the transfer token opens no teen invite.
    expect(
      (await inviteApi(await transferToken(), "", { parentSub: ana.snapSub })).body,
    ).toMatchObject({ code: "insufficient_scope" });
  });

  it("says nothing about FTR before the Send; someone never at FTR cannot send", async () => {
    const token = await transferToken();
    const ben = await sender(false);
    const transferId = await openTransfer(token, ben.snapSub);
    expect(
      await transferApi(token, `/${transferId}/assertion`, { fromSub: ben.snapSub }),
    ).toMatchObject({ status: 409, body: { code: "not_approved" } });
    // The Send runs the screen's checks again and approves nothing.
    expect(await approve(transferId, ben.userId)).toBe("not_connected");
    expect(
      await transferApi(token, `/${transferId}/assertion`, { fromSub: ben.snapSub }),
    ).toMatchObject({ status: 409, body: { code: "not_approved" } });
  });

  const changes: readonly [string, (who: Person) => Promise<unknown>][] = [
    ["FTR access ended", (who) => meApps("DELETE", who, "ftr")],
    ["SnapApp access ended", (who) => meApps("DELETE", who, "snapapp")],
    [
      "now a teen",
      (who) =>
        pool.query(
          "UPDATE identity.user_profile SET date_of_birth = (now() - interval '15 years')::date WHERE user_id = $1",
          [who.userId],
        ),
    ],
    [
      "an ID account",
      (who) =>
        pool.query("UPDATE identity.user_profile SET region = 'ID' WHERE user_id = $1", [
          who.userId,
        ]),
    ],
    [
      "suspended",
      (who) =>
        pool.query("UPDATE identity.user_profile SET suspended_at = now() WHERE user_id = $1", [
          who.userId,
        ]),
    ],
  ];
  it.each(changes)("409 not_allowed after the Send when %s", async (_, change) => {
    const token = await transferToken();
    const ana = await sender();
    const transferId = await openTransfer(token, ana.snapSub);
    expect(await approve(transferId, ana.userId)).toBeNull();
    await change(ana);
    expect(
      await transferApi(token, `/${transferId}/assertion`, { fromSub: ana.snapSub }),
    ).toMatchObject({ status: 409, body: { code: "not_allowed" } });
  });

  it("lasts 15 minutes, and the person's deletion takes it", async () => {
    const token = await transferToken();
    const ana = await sender();
    const transferId = await openTransfer(token, ana.snapSub);
    expect(await approve(transferId, ana.userId)).toBeNull();
    await pool.query(
      "UPDATE oidc.model SET expires_at = now() - interval '1 second' WHERE kind = 'AppTransfer' AND id = $1",
      [transferId],
    );
    expect(
      await transferApi(token, `/${transferId}/assertion`, { fromSub: ana.snapSub }),
    ).toMatchObject({ status: 404, body: { code: "transfer_not_found" } });

    const ben = await sender();
    const live = await openTransfer(token, ben.snapSub);
    await pool.query("SELECT oidc.forget_subject($1, $2::jsonb)", [
      ben.userId,
      JSON.stringify(receiversFor("dev")),
    ]);
    expect(await rows("SELECT 1 FROM oidc.model WHERE id = $1", [live])).toEqual([]);
  });
});

/** Whether the person's Send is on the transfer row. */
async function approvedAt(transferId: string): Promise<unknown> {
  const [row] = await rows(
    "SELECT payload->'approvedAt' AS at FROM oidc.model WHERE kind = 'AppTransfer' AND id = $1",
    [transferId],
  );
  return (row as { at: unknown } | undefined)?.at ?? null;
}

/** The person's rows in the sign-in log at SnapApp's website. */
const logged = (userId: string) =>
  rows(
    "SELECT result FROM oidc.sign_in_log WHERE user_id = $1 AND client_id = 'snapapp-staging-web' ORDER BY id",
    [userId],
  );

/** SnapApp's website starting a sign-in that carries the transfer, and the screen it shows. */
async function sendScreen(who: Person, transferId: string, extra: Record<string, string> = {}) {
  const started = await startSignIn(await webApp(), WEB_REDIRECT, {
    transfer: transferId,
    ...extra,
  });
  return { started, shown: await details(await webServerCall(base, started, who.token, "")) };
}

describe("the send screen (docs/30 §5, 4.8 Y2)", () => {
  it("Send approves the transfer and a code follows, for SnapApp's own sub; other taps change nothing", async () => {
    const token = await transferToken();
    const ana = await sender();
    const transferId = await openTransfer(token, ana.snapSub);
    const { started, shown } = await sendScreen(ana, transferId);
    expect(shown).toMatchObject({
      screen: "send",
      client: { clientId: "snapapp-staging-web" },
      account: { name: "Ana", email: ana.email },
      refusal: null,
      sendProblem: null,
      send: {
        financialYear: "2025-26",
        lineCount: 7,
        to: {
          clientId: "ftr-web",
          name: "Free Tax Returns",
          externalOperator: true,
          privacyUrl: "https://freetaxreturns.com.au/privacy",
        },
      },
    });

    // Continue or consent on the send screen approves nothing.
    for (const screen of ["continue", "consent"]) {
      const tapped = await webServerCall(base, started, ana.token, "/continue", { screen });
      expect(tapped.status).toBe(409);
      expect(await errorBody(tapped)).toMatchObject({ code: "screen_changed" });
    }
    expect(await approvedAt(transferId)).toBeNull();

    const sent = await webServerCall(base, started, ana.token, "/continue", { screen: "send" });
    expect(sent.status, await sent.clone().text()).toBe(200);
    expect(await approvedAt(transferId)).toEqual(expect.any(Number));
    const callback = await followToApp(started, await redirectOf(sent));
    const tokens = await client.authorizationCodeGrant(await webApp(), callback, {
      pkceCodeVerifier: started.verifier,
      expectedState: started.state,
      expectedNonce: started.nonce,
    });
    expect(tokens.claims()?.sub).toBe(ana.snapSub);
    expect(
      await rows(
        "SELECT result FROM oidc.sign_in_log WHERE user_id = $1 AND client_id = 'snapapp-staging-web' ORDER BY id",
        [ana.userId],
      ),
    ).toEqual([{ result: "signed_in" }, { result: "send_approved" }, { result: "signed_in" }]);
    expect(
      (await transferApi(token, `/${transferId}/assertion`, { fromSub: ana.snapSub })).status,
    ).toBe(200);
  });

  it("a send tap on any other screen is screen_changed", async () => {
    const ana = await sender(false);
    const started = await startSignIn(await webApp(), WEB_REDIRECT);
    expect((await details(await webServerCall(base, started, ana.token, ""))).screen).toBe(
      "continue",
    );
    const tapped = await webServerCall(base, started, ana.token, "/continue", { screen: "send" });
    expect(tapped.status).toBe(409);
  });

  it("without a covering consent, the consent screen shows and nothing is approved", async () => {
    const token = await transferToken();
    const ana = await sender();
    const transferId = await openTransfer(token, ana.snapSub);
    const { started, shown } = await sendScreen(ana, transferId, { prompt: "consent" });
    expect(shown).toMatchObject({ screen: "consent", send: null });
    const tapped = await webServerCall(base, started, ana.token, "/continue", {
      screen: "consent",
    });
    expect(tapped.status).toBe(200);
    await followToApp(started, await redirectOf(tapped));
    expect(await approvedAt(transferId)).toBeNull();
    expect(
      await transferApi(token, `/${transferId}/assertion`, { fromSub: ana.snapSub }),
    ).toMatchObject({ status: 409, body: { code: "not_approved" } });
  });

  it("Cancel goes back to SnapApp as send_refused, and nothing is approved", async () => {
    const token = await transferToken();
    const ana = await sender();
    const transferId = await openTransfer(token, ana.snapSub);
    const { started, shown } = await sendScreen(ana, transferId);
    expect(shown.screen).toBe("send");
    const cancelled = await webServerCall(base, started, ana.token, "/cancel", {});
    const back = await followToApp(started, await redirectOf(cancelled));
    expect(back.searchParams.get("error")).toBe("access_denied");
    // As for a refused send: SnapApp cannot tell that the person reached the screen (D4).
    expect(back.searchParams.get("error_description")).toBe("send_refused");
    expect(await approvedAt(transferId)).toBeNull();
    expect(await logged(ana.userId)).toContainEqual({ result: "send_refused:user_cancelled" });
  });

  it("FTR access ending after the screen showed: Send is refused and nothing is approved", async () => {
    const token = await transferToken();
    const ana = await sender();
    const transferId = await openTransfer(token, ana.snapSub);
    const { started, shown } = await sendScreen(ana, transferId);
    expect(shown.screen).toBe("send");
    await meApps("DELETE", ana, "ftr");
    const sent = await webServerCall(base, started, ana.token, "/continue", { screen: "send" });
    expect(sent.status).toBe(403);
    expect(await errorBody(sent)).toMatchObject({
      code: "sign_in_refused",
      refusal: "send_refused",
    });
    expect(await approvedAt(transferId)).toBeNull();
    expect(await logged(ana.userId)).toContainEqual({ result: "send_refused:not_connected" });
    expect(await logged(ana.userId)).not.toContainEqual({ result: "send_approved" });
  });

  const problems: readonly [
    string,
    (token: string) => Promise<{ who: Person; transferId: string }>,
  ][] = [
    [
      "not_connected",
      async (token) => {
        const ben = await sender(false);
        return { who: ben, transferId: await openTransfer(token, ben.snapSub) };
      },
    ],
    [
      "wrong_account",
      async (token) => {
        const ana = await sender();
        const ben = await sender();
        return { who: ben, transferId: await openTransfer(token, ana.snapSub) };
      },
    ],
    [
      "expired",
      async (token) => {
        const ana = await sender();
        const transferId = await openTransfer(token, ana.snapSub);
        await pool.query(
          "UPDATE oidc.model SET expires_at = now() - interval '1 second' WHERE kind = 'AppTransfer' AND id = $1",
          [transferId],
        );
        return { who: ana, transferId };
      },
    ],
    [
      "not_allowed",
      async (token) => {
        // SnapApp takes Indonesia; FTR, and so the route, does not.
        const budi = await person({ region: "ID" });
        const { tokens } = await signIn(await webApp(), WEB_REDIRECT, budi, "consent");
        return { who: budi, transferId: await openTransfer(token, tokens.claims()?.sub ?? "") };
      },
    ],
  ];
  it.each(problems)(
    "%s: refused with send_refused, Send cannot force it, and SnapApp hears only send_refused",
    async (problem, arrange) => {
      const token = await transferToken();
      const { who, transferId } = await arrange(token);
      const { started, shown } = await sendScreen(who, transferId);
      expect(shown).toMatchObject({
        screen: "refused",
        refusal: "send_refused",
        sendProblem: problem,
        inviteProblem: null,
        send: null,
      });
      const forced = await webServerCall(base, started, who.token, "/continue", {
        screen: "send",
      });
      expect(forced.status).toBe(403);
      expect(await errorBody(forced)).toMatchObject({
        code: "sign_in_refused",
        refusal: "send_refused",
      });
      expect(await approvedAt(transferId)).toBeNull();
      const back = await followToApp(
        started,
        await redirectOf(await webServerCall(base, started, who.token, "/cancel", {})),
      );
      expect(back.searchParams.get("error_description")).toBe("send_refused");
      // The real cause stays in YourTal's own log.
      expect(await logged(who.userId)).toContainEqual({ result: `send_refused:${problem}` });
    },
  );

  it("FTR's own sign-in cannot carry a transfer", async () => {
    const token = await transferToken();
    const ana = await sender();
    const transferId = await openTransfer(token, ana.snapSub);
    // No route starts from FTR, so its request is refused before any screen.
    const config = await ftrApp();
    await expect(startSignIn(config, FTR_REDIRECT, { transfer: transferId })).rejects.toThrow(
      /expected the \/connect page/,
    );
    expect(await approvedAt(transferId)).toBeNull();
  });
});
