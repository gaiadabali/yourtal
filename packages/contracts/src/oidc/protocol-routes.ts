/**
 * Group 3.9 (docs/26 §1.1): the routes the OpenID Connect provider serves
 * under `/oidc`. They are the library's (oidc-provider), authenticated by the
 * protocol itself (client authentication, PKCE, the interaction cookies), so
 * they never pass Nest's guards and are not in the OpenAPI document: discovery
 * describes them. `apps/api`'s oidc tests fail if the provider serves anything
 * else, or if anything else is mounted under `/oidc`.
 */
export const OIDC_PREFIX = "/oidc";

export interface OidcProtocolRoute {
  readonly method: "GET" | "POST" | "OPTIONS";
  /** Below `OIDC_PREFIX`, in the library's own `:param` form. */
  readonly path: string;
  readonly what: string;
}

export const OIDC_PROTOCOL_ROUTES: readonly OidcProtocolRoute[] = [
  { method: "GET", path: "/.well-known/openid-configuration", what: "Discovery" },
  { method: "GET", path: "/.well-known/oauth-authorization-server", what: "Discovery (RFC 8414)" },
  { method: "GET", path: "/auth", what: "Authorization" },
  { method: "GET", path: "/auth/:uid", what: "Resume after the sign-in screens" },
  { method: "POST", path: "/token", what: "Token (codes and client credentials)" },
  { method: "GET", path: "/me", what: "Userinfo" },
  { method: "POST", path: "/me", what: "Userinfo" },
  { method: "GET", path: "/jwks", what: "Signing keys" },
  {
    method: "POST",
    path: "/session/end/confirm",
    what: "Always mounted by the library; inert, since logout is off and nothing issues its form",
  },
  { method: "OPTIONS", path: "/.well-known/openid-configuration", what: "CORS preflight" },
  { method: "OPTIONS", path: "/.well-known/oauth-authorization-server", what: "CORS preflight" },
  { method: "OPTIONS", path: "/token", what: "CORS preflight (closed: no client gets CORS)" },
  { method: "OPTIONS", path: "/me", what: "CORS preflight (closed: no client gets CORS)" },
  { method: "OPTIONS", path: "/jwks", what: "CORS preflight" },
];

/** Library routes that must stay off: logout, registration, PAR, device flow, CIBA, introspection, revocation. */
export const OIDC_DISABLED_ROUTES: readonly OidcProtocolRoute[] = [
  { method: "GET", path: "/session/end", what: "RP-initiated logout" },
  { method: "POST", path: "/reg", what: "Dynamic registration" },
  { method: "POST", path: "/request", what: "Pushed authorization requests" },
  { method: "POST", path: "/device/auth", what: "Device flow" },
  { method: "POST", path: "/backchannel", what: "CIBA" },
  { method: "POST", path: "/token/introspection", what: "Introspection" },
  { method: "POST", path: "/token/revocation", what: "Revocation" },
  { method: "GET", path: "/interaction/x", what: "devInteractions" },
];
