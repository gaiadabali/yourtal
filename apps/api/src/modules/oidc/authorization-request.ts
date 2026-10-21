import { errors } from "oidc-provider";
import type { KoaContextWithOIDC } from "oidc-provider";
import { REQUIRED_SIGN_IN_SCOPES } from "./clients";

const TEEN_INVITE_PARAM = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The longest any authorization parameter may be. Each one is stored in the
 * sign-in's interaction row, so an unbounded `state` would let anyone grow
 * the table at will. openid-client's state and nonce are 43 characters.
 */
export const MAX_PARAM_LENGTH = 512;

/**
 * Runs on every authorization request, after the client and redirect URI are
 * confirmed: the library calls each extraParams validator whether or not its
 * own parameter is present, so this is registered under `teen_invite`.
 *
 * - A scope outside the client's allowlist, or one the library does not know,
 *   is refused rather than dropped (docs/26 §1.4). oidc-provider 9.12 has
 *   already removed scopes it does not know from `ctx.oidc.params.scope` by
 *   now, so the query is read as sent; authorization is GET only (no POST,
 *   request objects or PAR), so the query is the whole request.
 * - `id_token_hint` is refused: no app needs it, and checking one would look
 *   up the person's pairwise sub for an app they may never have used.
 * - Every parameter is capped at MAX_PARAM_LENGTH.
 */
export function validateAuthorizationRequest(
  ctx: KoaContextWithOIDC,
  teenInvite: string | undefined,
): void {
  if (ctx.method !== "GET") {
    throw new errors.InvalidRequest("authorization requests must use GET");
  }
  for (const [name, value] of Object.entries(ctx.query)) {
    const values = Array.isArray(value) ? value : [value ?? ""];
    if (values.some((one) => one.length > MAX_PARAM_LENGTH)) {
      throw new errors.InvalidRequest(`${name} is too long`);
    }
  }
  if (ctx.oidc.params?.["id_token_hint"] !== undefined) {
    throw new errors.InvalidRequest("id_token_hint is not supported");
  }

  const scopeParam = ctx.query["scope"];
  const requested =
    typeof scopeParam === "string" ? scopeParam.split(" ").filter((scope) => scope.length > 0) : [];
  const allowed = new Set((ctx.oidc.client?.scope ?? "").split(" "));
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
