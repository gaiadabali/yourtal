import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientsFor } from "./clients";
import { loadClients } from "./client-keys";
import { TTL, providerConfiguration } from "./provider-config";
import type { ProviderConfigDeps } from "./provider-config";
import {
  CLIENT_KEYS_DIR,
  buildTestProvider,
  makeTestClientKeys,
  memoryAdapterFactory,
} from "./testing/oidc-test-kit";
import type { TestProvider } from "./testing/oidc-test-kit";

/**
 * Group 3.9: one test per setting in docs/26 §1.1 and §1.6, against the
 * library's own answers where it gives one (discovery, refusals), and the
 * configuration where it does not. No database: the provider runs on a
 * memory adapter here; the Postgres flow is oidc.e2e.test.ts.
 */
let kit: TestProvider;
let discovery: Record<string, unknown>;

const WEB = {
  client_id: "snapapp-staging-web",
  redirect_uri: "https://snap-apps.gaiada.com/auth/yourtal/callback",
};
const CHALLENGE = "E9Melhoe2OwvFrEMTJguCQaoeKelZ6Tfxtc-bk7xKMs";

function authorize(params: Record<string, string>) {
  const query = new URLSearchParams({
    response_type: "code",
    scope: "openid email profile account",
    state: "s-1",
    nonce: "n-1",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    ...WEB,
    ...params,
  });
  for (const [key, value] of Object.entries(params)) if (value === "") query.delete(key);
  return kit.fastify.inject({ method: "GET", url: `/oidc/auth?${query.toString()}` });
}

function errorOf(location: string | undefined): string | null {
  if (location === undefined) return null;
  return new URL(location).searchParams.get("error");
}

function deps(): ProviderConfigDeps {
  const keys = makeTestClientKeys();
  return {
    clients: loadClients(clientsFor("dev"), CLIENT_KEYS_DIR, keys.files).metadata,
    keys: { jwks: { keys: [] }, cookieKeys: ["x".repeat(32)], ephemeral: true },
    webOrigin: "http://localhost:3000",
    adapter: memoryAdapterFactory(),
    findAccount: () => undefined,
    pairwiseIdentifier: () => Promise.resolve("sub"),
  };
}

beforeAll(async () => {
  kit = await buildTestProvider();
  const response = await kit.fastify.inject({
    method: "GET",
    url: "/oidc/.well-known/openid-configuration",
  });
  discovery = response.json();
});

afterAll(async () => {
  await kit.fastify.close();
});

describe("docs/26 §1.1 provider settings", () => {
  it("issuer is the configured one, below /oidc", () => {
    expect(discovery["issuer"]).toBe("http://127.0.0.1:26999/oidc");
    expect(String(discovery["authorization_endpoint"])).toMatch(/\/oidc\/auth$/);
  });

  it("devInteractions is off: no test login page exists", async () => {
    expect(providerConfiguration(deps()).features?.devInteractions?.enabled).toBe(false);
    const page = await kit.fastify.inject({ method: "GET", url: "/oidc/interaction/abc" });
    expect(page.statusCode).toBe(404);
  });

  it("responseTypes is code only", async () => {
    expect(discovery["response_types_supported"]).toEqual(["code"]);
    const implicit = await authorize({ response_type: "id_token" });
    expect(implicit.headers.location ?? "").not.toContain("/connect/");
  });

  it("only the query response mode is allowed for any client", async () => {
    for (const metadata of deps().clients.filter((client) => client.redirect_uris?.length)) {
      expect(metadata.response_modes).toEqual(["query"]);
    }
    const fragment = await authorize({ response_mode: "fragment" });
    expect(fragment.headers.location ?? "").not.toContain("/connect/");
  });

  it("PKCE is required for every client, S256 only", async () => {
    expect(discovery["code_challenge_methods_supported"]).toEqual(["S256"]);
    const missing = await authorize({ code_challenge: "", code_challenge_method: "" });
    expect(errorOf(missing.headers.location)).toBe("invalid_request");
    const plain = await authorize({ code_challenge_method: "plain" });
    expect(errorOf(plain.headers.location)).toBe("invalid_request");
    expect(providerConfiguration(deps()).pkce?.required?.({} as never, {} as never)).toBe(true);
  });

  it("subjectTypes is pairwise only", () => {
    expect(discovery["subject_types_supported"]).toEqual(["pairwise"]);
    for (const metadata of deps().clients) expect(metadata.subject_type).toBe("pairwise");
  });

  it("clientAuthMethods are private_key_jwt, client_secret_basic and none", () => {
    expect(discovery["token_endpoint_auth_methods_supported"]).toEqual([
      "private_key_jwt",
      "client_secret_basic",
      "none",
    ]);
  });

  it("conformIdTokenClaims is false: the ID token carries the granted claims", () => {
    expect(providerConfiguration(deps()).conformIdTokenClaims).toBe(false);
  });

  it("clientCredentials is on, and only SnapApp's server may use it", () => {
    expect(discovery["grant_types_supported"]).toContain("client_credentials");
    const withCredentials = deps()
      .clients.filter((client) => client.grant_types?.includes("client_credentials"))
      .map((client) => client.client_id);
    expect(withCredentials).toEqual(["snapapp-staging-server"]);
  });

  it("dynamic registration, request objects, PAR and both logouts are off", () => {
    expect(discovery["registration_endpoint"]).toBeUndefined();
    expect(discovery["request_parameter_supported"]).not.toBe(true);
    expect(discovery["request_uri_parameter_supported"]).not.toBe(true);
    expect(discovery["pushed_authorization_request_endpoint"]).toBeUndefined();
    expect(discovery["end_session_endpoint"]).toBeUndefined();
    expect(discovery["backchannel_logout_supported"]).toBeUndefined();
    expect(discovery["introspection_endpoint"]).toBeUndefined();
    expect(discovery["revocation_endpoint"]).toBeUndefined();
  });

  it("signs ID tokens with RS256 only", () => {
    expect(discovery["id_token_signing_alg_values_supported"]).toEqual(["RS256"]);
  });

  it("puts the iss response parameter on every authorization response (RFC 9207)", () => {
    expect(discovery["authorization_response_iss_parameter_supported"]).toBe(true);
  });

  it("issues no refresh tokens", () => {
    expect(
      providerConfiguration(deps()).issueRefreshToken?.({} as never, {} as never, {} as never),
    ).toBe(false);
    for (const metadata of deps().clients)
      expect(metadata.grant_types).not.toContain("refresh_token");
  });

  it("accepts prompt=create for sign-up from an app", async () => {
    const response = await authorize({ prompt: "create" });
    expect(response.headers.location ?? "").toContain("/connect/");
  });

  it("publishes the claims of docs/26 §1.3 and nothing else beyond the protocol's", () => {
    expect(discovery["scopes_supported"]).toEqual([
      "openid",
      "email",
      "profile",
      "account",
      "teen_invites",
    ]);
    expect(new Set(discovery["claims_supported"] as string[])).toEqual(
      new Set([
        "sub",
        "sid",
        "auth_time",
        "amr",
        "iss",
        "email",
        "email_verified",
        "name",
        "region",
        "age_band",
      ]),
    );
  });

  it("lets the JWKS be cached for 10 minutes and discovery for 1 hour", async () => {
    const jwks = await kit.fastify.inject({ method: "GET", url: "/oidc/jwks" });
    expect(jwks.headers["cache-control"]).toBe("public, max-age=600");
    const config = await kit.fastify.inject({
      method: "GET",
      url: "/oidc/.well-known/openid-configuration",
    });
    expect(config.headers["cache-control"]).toBe("public, max-age=3600");
  });

  it("publishes public signing keys only", async () => {
    const jwks = (await kit.fastify.inject({ method: "GET", url: "/oidc/jwks" })).json();
    expect(jwks.keys.length).toBeGreaterThan(0);
    for (const key of jwks.keys) expect(key).not.toHaveProperty("d");
  });
});

describe("docs/26 §1.6 lifetimes", () => {
  it("code 60 s, ID token 5 min, access and client-credentials tokens 10 min, screen 1 hour", () => {
    expect(TTL).toEqual({
      AuthorizationCode: 60,
      IdToken: 300,
      AccessToken: 600,
      ClientCredentials: 600,
      Interaction: 3600,
      Session: 3600,
      Grant: 3600,
    });
    expect(providerConfiguration(deps()).ttl).toEqual(TTL);
  });
});

describe("authorization requests", () => {
  it("a good request goes to YourTal's /connect page with the interaction cookie scoped to it", async () => {
    const response = await authorize({});
    expect(response.statusCode).toBe(303);
    const location = new URL(response.headers.location ?? "");
    expect(location.origin).toBe("http://localhost:3000");
    expect(location.pathname).toMatch(/^\/connect\/[\w-]+$/);
    const cookies = String(response.headers["set-cookie"]);
    expect(cookies).toContain(`_interaction=`);
    expect(cookies).toContain(`path=${location.pathname}`);
  });

  it("prompt=none answers login_required: there is no silent sign-in", async () => {
    const response = await authorize({ prompt: "none" });
    expect(errorOf(response.headers.location)).toBe("login_required");
    expect(new URL(response.headers.location ?? "").searchParams.get("iss")).toBe(
      "http://127.0.0.1:26999/oidc",
    );
  });

  it("a scope outside the client's allowlist is refused, not dropped", async () => {
    const known = await authorize({ scope: "openid email profile account teen_invites" });
    expect(errorOf(known.headers.location)).toBe("invalid_scope");
    const unknown = await authorize({ scope: "openid email profile account phone" });
    expect(errorOf(unknown.headers.location)).toBe("invalid_scope");
  });

  it("the account scope is required", async () => {
    const response = await authorize({ scope: "openid email profile" });
    expect(errorOf(response.headers.location)).toBe("invalid_scope");
  });

  it("an unknown client gets YourTal's error page, never a redirect", async () => {
    const response = await authorize({ client_id: "not-a-client" });
    expect(response.statusCode).toBe(400);
    expect(response.headers.location).toBeUndefined();
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("This sign-in link doesn");
  });

  it("an inexact redirect URI gets the error page, never a redirect", async () => {
    for (const redirect_uri of [
      `${WEB.redirect_uri}/`,
      `${WEB.redirect_uri}?x=1`,
      "https://snap-apps.gaiada.com/auth/yourtal/callbacks",
      "https://evil.example/auth/yourtal/callback",
    ]) {
      const response = await authorize({ redirect_uri });
      expect(response.headers.location, redirect_uri).toBeUndefined();
      expect(response.statusCode).toBe(400);
    }
  });

  it("a missing redirect URI is refused even though each client has one", async () => {
    const response = await authorize({ redirect_uri: "" });
    expect(response.headers.location).toBeUndefined();
  });
});
