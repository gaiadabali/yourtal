import { interactionPolicy } from "oidc-provider";
import type {
  AdapterFactory,
  ClientMetadata,
  Configuration,
  FindAccount,
  KoaContextWithOIDC,
} from "oidc-provider";
import type { ProviderKeys } from "./keys";
import { validateAuthorizationRequest } from "./authorization-request";
import { SCOPE_CLAIMS } from "./claims";
import { renderError } from "./render-error";

/**
 * Group 3.9: the provider's settings, exactly as docs/26 §1.1 and §1.6 set
 * them. Every protocol piece is the library's (oidc-provider, OpenID
 * Certified); this file only chooses. Each setting has its own test in
 * provider-config.test.ts.
 */
export interface ProviderConfigDeps {
  readonly clients: ClientMetadata[];
  readonly keys: ProviderKeys;
  /** `/connect/<uid>` is a page on YourTal's web origin. */
  readonly webOrigin: string;
  readonly adapter: AdapterFactory;
  readonly findAccount: FindAccount;
  /** `create` is true only when a token or userinfo is being issued (see pairwise.ts). */
  readonly pairwiseIdentifier: (
    accountId: string,
    clientId: string,
    create: boolean,
  ) => Promise<string>;
}

/** The routes that hand a `sub` to an app: the ID token and userinfo. */
const ISSUING_ROUTES = new Set(["token", "userinfo"]);

/** docs/26 §1.6, in seconds. */
export const TTL = {
  AuthorizationCode: 60,
  IdToken: 5 * 60,
  AccessToken: 10 * 60,
  ClientCredentials: 10 * 60,
  // The sign-in screen. The provider's own session and grant only need to
  // outlive one sign-in: YourTal's session is the single sign-on session.
  Interaction: 60 * 60,
  Session: 60 * 60,
  Grant: 60 * 60,
} as const;

export const SCOPES = ["openid", "email", "profile", "account", "teen_invites"] as const;

/**
 * The library's prompts, plus two of YourTal's: `create` (OpenID Connect
 * "Initiating User Registration", docs/26 §1.7), and a login check that is
 * only met by a sign-in finished on YourTal's screen in this very request.
 * So every sign-in shows the person which app and which account, and
 * `prompt=none` answers `login_required` (docs/26 §1.4: no silent sign-in).
 * The same check sends the person back to YourTal's screen when findAccount
 * refuses them at resume (on hold, wrong region, a teen), rather than going on.
 */
/** Typed as always there; it is not when findAccount refused the person. */
function accountOf(ctx: KoaContextWithOIDC): unknown {
  return (ctx.oidc as { account?: unknown }).account;
}

export function signInPolicy(): interactionPolicy.DefaultPolicy {
  const { Check, Prompt, base } = interactionPolicy;
  const policy = base();
  policy
    .get("login")
    ?.checks.add(
      new Check(
        "yourtal_confirm",
        "every sign-in is confirmed on YourTal's screen",
        "login_required",
        (ctx) =>
          ctx.oidc.result?.login === undefined || accountOf(ctx) === undefined
            ? Check.REQUEST_PROMPT
            : Check.NO_NEED_TO_PROMPT,
      ),
      0,
    );
  policy.add(new Prompt({ name: "create", requestable: true }), 0);
  return policy;
}

/** The JWT access token format calls the hook without a request; treat that as not issuing. */
function routeOf(ctx: KoaContextWithOIDC | undefined): string | undefined {
  return ctx?.oidc.route;
}

export function providerConfiguration(deps: ProviderConfigDeps): Configuration {
  return {
    adapter: deps.adapter,
    clients: deps.clients,
    jwks: deps.keys.jwks,
    cookies: {
      keys: deps.keys.cookieKeys,
      long: { httpOnly: true, sameSite: "lax", signed: true },
      short: { httpOnly: true, sameSite: "lax", signed: true },
    },
    findAccount: deps.findAccount,
    pairwiseIdentifier: (ctx, accountId, client) =>
      deps.pairwiseIdentifier(accountId, client.clientId, ISSUING_ROUTES.has(routeOf(ctx) ?? "")),
    // Static clients only, so there is no sector document to fetch.
    sectorIdentifierUriValidate: () => false,

    responseTypes: ["code"],
    subjectTypes: ["pairwise"],
    clientAuthMethods: ["private_key_jwt", "client_secret_basic", "none"],
    pkce: { required: () => true },
    conformIdTokenClaims: false,
    allowOmittingSingleRegisteredRedirectUri: false,
    issueRefreshToken: () => false,
    // Codes are redeemed on servers; no browser calls the token or userinfo endpoints.
    clientBasedCORS: () => false,
    clientDefaults: {
      grant_types: ["authorization_code"],
      response_types: ["code"],
      id_token_signed_response_alg: "RS256",
      subject_type: "pairwise",
      token_endpoint_auth_method: "private_key_jwt",
    },

    scopes: [...SCOPES],
    claims: {
      // auth_time and amr ride on openid, so every ID token carries them (docs/26 §1.3);
      // the library only includes a claim that some granted scope names.
      openid: [...SCOPE_CLAIMS.openid, "auth_time", "amr"],
      email: [...SCOPE_CLAIMS.email],
      profile: [...SCOPE_CLAIMS.profile],
      account: [...SCOPE_CLAIMS.account],
    },
    extraParams: { teen_invite: validateAuthorizationRequest },
    ttl: { ...TTL },

    enabledJWA: {
      idTokenSigningAlgValues: ["RS256"],
      userinfoSigningAlgValues: ["RS256"],
      authorizationSigningAlgValues: ["RS256"],
      clientAuthSigningAlgValues: ["RS256", "PS256", "ES256", "EdDSA"],
    },

    features: {
      devInteractions: { enabled: false },
      clientCredentials: { enabled: true },
      userinfo: { enabled: true },
      registration: { enabled: false },
      registrationManagement: { enabled: false },
      requestObjects: { enabled: false },
      pushedAuthorizationRequests: { enabled: false },
      rpInitiatedLogout: { enabled: false },
      backchannelLogout: { enabled: false },
      encryption: { enabled: false },
      jwtResponseModes: { enabled: false },
      claimsParameter: { enabled: false },
      dPoP: { enabled: false },
      resourceIndicators: { enabled: false },
      introspection: { enabled: false },
      revocation: { enabled: false },
      deviceFlow: { enabled: false },
      ciba: { enabled: false },
    },

    interactions: {
      policy: signInPolicy(),
      url: (_ctx, interaction) =>
        `${deps.webOrigin}/connect/${encodeURIComponent(interaction.uid)}`,
    },
    renderError,
  };
}
