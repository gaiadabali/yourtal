import { IncomingMessage, ServerResponse } from "node:http";
import { createServer, Socket } from "node:net";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OidcAccount } from "./claims";
import { findAccountFrom } from "./find-account";
import { InteractionError, InteractionService } from "./interaction.service";
import type { RawHttp } from "./interaction.service";
import { OidcRuntime } from "./oidc-runtime";
import type { AppConsent, OidcStore } from "./oidc-store";
import { pairwiseIdentifierFor } from "./pairwise";
import { NO_TEEN_INVITES_YET } from "./sign-in-checks";
import { Browser, followToApp, startSignIn } from "./testing/sign-in-driver";
import { buildTestProvider } from "./testing/oidc-test-kit";
import type { TestProvider } from "./testing/oidc-test-kit";

/**
 * The interaction service and the provider together, with no database: the
 * same sign-in as oidc.e2e.test.ts, over an in-memory store, so a broken flow
 * shows up in seconds rather than in the Integration run.
 */
const WEB_REDIRECT = "https://snap-apps.gaiada.com/auth/yourtal/callback";
const FTR_REDIRECT = "https://freetaxreturns.gaiada.online/api/auth/oauth2/callback/yourtal";

function memoryStore(accounts: Map<string, OidcAccount>) {
  const subjects = new Map<string, string>();
  const consents = new Map<string, AppConsent>();
  const log: { userId: string; clientId: string; result: string }[] = [];
  const store: OidcStore = {
    findAccount: (userId) => Promise.resolve(accounts.get(userId) ?? null),
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
        endedAt: null,
      });
      return Promise.resolve();
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
const SESSIONS = new Map([
  ["adult-token", ADULT.userId],
  ["teen-token", TEEN.userId],
]);

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
  memory = memoryStore(new Map([ADULT, TEEN].map((account) => [account.userId, account])));
  let registered: TestProvider["registered"] = [];
  kit = await buildTestProvider({
    issuer,
    findAccount: findAccountFrom(memory.store),
    pairwiseIdentifier: (accountId, clientId) =>
      pairwiseIdentifierFor(memory.store, registered)(accountId, clientId),
  });
  registered = kit.registered;
  await kit.fastify.listen({ port, host: "127.0.0.1" });
  service = new InteractionService(
    new OidcRuntime(kit.provider, kit.registered, memory.store, null),
    {
      validateAndTouch: (token) => {
        const userId = SESSIONS.get(token);
        return Promise.resolve(
          userId === undefined ? { valid: false, reason: "not_found" } : { valid: true, userId },
        );
      },
    },
    NO_TEEN_INVITES_YET,
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
    const config = await rp("ftr-staging-web", client.ClientSecretBasic(kit.keys.ftrSecret));
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
});
