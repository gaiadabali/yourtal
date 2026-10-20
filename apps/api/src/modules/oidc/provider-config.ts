import { errors, interactionPolicy } from "oidc-provider";
import type {
  AdapterFactory,
  ClientMetadata,
  Configuration,
  FindAccount,
  KoaContextWithOIDC,
} from "oidc-provider";
import type { ProviderKeys } from "./keys";
import { REQUIRED_SIGN_IN_SCOPES } from "./clients";
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
  readonly pairwiseIdentifier: (accountId: string, clientId: string) => Promise<string>;
}

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

const TEEN_INVITE_PARAM = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Runs on every authorization request, after the client and redirect URI are
 * confirmed (the library calls each extraParams validator whether or not its
 * parameter is present). A scope outside the client's allowlist, or one the
 * library does not know, is refused rather than silently dropped (docs/26 §1.4):
 * the library itself refuses known scopes but drops unknown ones.
 */
function validateAuthorizationRequest(
  ctx: KoaContextWithOIDC,
  teenInvite: string | undefined,
): void {
  const client = ctx.oidc.client;
  // The query as sent: the library has already dropped scopes it does not know
  // from its own params. Authorization is GET only, with no request objects or PAR.
  const scopeParam = ctx.query["scope"];
  const requested =
    typeof scopeParam === "string" ? scopeParam.split(" ").filter((scope) => scope.length > 0) : [];
  const allowed = new Set((client?.scope ?? "").split(" "));
  const outside = requested.filter((scope) => !allowed.has(scope));
  if (outside.length > 0) {
    throw new errors.InvalidScope("requested scope is not allowed", outside.join(" "));
  }
  for (const scope of REQUIRED_SIGN_IN_SCOPES) {
    if (!requested.includes(scope)) {
      throw new errors.InvalidScope(`the ${scope} scope is required`, scope);
    }
  }
  if (teenInvite !== undefined && !TEEN_INVITE_PARAM.test(teenInvite)) {
    throw new errors.InvalidRequest("invalid teen_invite parameter");
  }
}

/**
 * The library's prompts, plus two of YourTal's: `create` (OpenID Connect
 * "Initiating User Registration", docs/26 §1.7), and a login check that is
 * only met by a sign-in finished on YourTal's screen in this very request.
 * So every sign-in shows the person which app and which account, and
 * `prompt=none` answers `login_required` (docs/26 §1.4: no silent sign-in).
 */
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
          ctx.oidc.result?.login === undefined ? Check.REQUEST_PROMPT : Check.NO_NEED_TO_PROMPT,
      ),
      0,
    );
  policy.add(new Prompt({ name: "create", requestable: true }), 0);
  return policy;
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
    pairwiseIdentifier: (_ctx, accountId, client) =>
      deps.pairwiseIdentifier(accountId, client.clientId),
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
