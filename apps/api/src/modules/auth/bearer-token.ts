import type { FastifyRequest } from "fastify";

/**
 * The session token this module issues travels as a standard
 * `Authorization: Bearer <token>` header, or as the `yt_session` cookie
 * `PrincipalService.resolve` also accepts (1.5.a: the two are the same
 * token, presented either way). This module reads it directly for logout
 * and change-password, which need "which account, if any, is this request's
 * caller" independently of how the route itself got past `PdpGuard`.
 *
 * Returns `""` rather than `undefined` when absent, so every caller
 * (`SessionService.validateAndTouch`) gets a uniform "not found" outcome
 * from a missing header rather than a second code path to test.
 */
export function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (typeof header !== "string") return "";
  const [scheme, token] = header.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || token === undefined || token.length === 0) {
    return "";
  }
  return token;
}

const SESSION_COOKIE = "yt_session";

/**
 * The caller's session token from the `yt_session` cookie or the bearer
 * header, in the order `PrincipalService.resolve` reads them, so a route
 * that checks how the session was signed in to looks at the same session the
 * PDP check did. `""` when there is none.
 */
export function presentedSessionToken(request: FastifyRequest): string {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === SESSION_COOKIE) {
      return part.slice(separator + 1).trim();
    }
  }
  return bearerToken(request);
}
