import type { FastifyRequest } from "fastify";

/**
 * The session token this module issues travels as a standard
 * `Authorization: Bearer <token>` header — deliberately NOT one of the
 * `x-yt-*` headers `PrincipalService` reads. Those drive the interim,
 * header-trusting principal the PDP reasons about (`PrincipalService`'s own
 * doc comment; untouched by this ticket, see the ticket report for why).
 * This is the real session mechanism, read directly by this module for the
 * one question it needs answered — "which account, if any, is this
 * request's caller" — independently of how the route itself got past
 * `PdpGuard`.
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
