import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { anonymousPrincipal, principalSchema } from "@yourtal/authz/principal";
import type { Principal } from "@yourtal/authz/principal";
import type { FastifyRequest } from "fastify";
import { bearerToken } from "../../modules/auth/bearer-token";
import { SESSION_VALIDATOR } from "./session-validator";
import type { SessionValidator } from "./session-validator";
import type { PrincipalResolver } from "./principal-resolver";

/**
 * THE one place a `Principal` is assembled (docs/17 sections 2.1, 4.6). Every
 * controller in this app calls `resolve()` exactly once and passes the
 * result to `pdpClient.requireAction` — never builds a principal itself.
 *
 * 1.5.a: reads the REAL session, not a header a caller could name itself
 * through. A presented credential is a `yt_session` cookie or an
 * `Authorization: Bearer` token (either travels the same opaque token
 * `SessionService.issue` mints at login); `SessionService.validateAndTouch`
 * is the only thing that turns one into a user id. `PrincipalService` no
 * longer decides `jurisdiction`, `businessRoles` or `isSuspended` at all —
 * every real account has an `identity.user_profile` row from the moment it
 * registers (1.4.c), and `AsyncPrincipalResolver` (this same directory)
 * overlays the true values from it. What is set here is a safe placeholder
 * for the rare principal `AsyncPrincipalResolver` finds no profile row for.
 *
 * No credential presented at all is `anonymous` — the same outcome an
 * absent `x-yt-user-id` header used to produce. A credential that IS
 * presented but does not validate (expired, revoked, unknown) is refused
 * outright rather than quietly treated as anonymous: a client that thinks
 * it is signed in should be told its session died, not silently
 * downgraded.
 *
 * No production boot guard any more, either — the fail-open surface that
 * guard existed for (anyone naming themselves the owner of any business
 * via a header) is exactly what this ticket removes.
 */
@Injectable()
export class PrincipalService implements PrincipalResolver {
  constructor(@Inject(SESSION_VALIDATOR) private readonly sessions: SessionValidator) {}

  async resolve(request: FastifyRequest): Promise<Principal> {
    const token = sessionCookie(request) ?? bearerToken(request);
    if (token.length === 0) {
      return anonymousPrincipal(DEFAULT_JURISDICTION);
    }

    const validation = await this.sessions.validateAndTouch(token, new Date());
    if (!validation.valid) {
      throw invalidSession();
    }

    return principalSchema.parse({
      id: validation.userId,
      roles: ["user"],
      // Placeholders: AsyncPrincipalResolver overlays the real values from
      // identity.user_profile / business.business_members / identity.staff_role
      // for every principal that has a profile row — see this class's own
      // doc comment.
      attr: { jurisdiction: DEFAULT_JURISDICTION, businessRoles: {}, isSuspended: false },
    });
  }
}

/**
 * No geo-IP or Accept-Language lookup exists yet, so an anonymous visitor's
 * region is unknowable — this is the same fixed default the old
 * `x-yt-jurisdiction` header fell back to, now the only value there is.
 * `policies/_schemas/principal.json`'s own note that "the jurisdiction
 * policy service (YT-0037) owns feature switches" already named this a
 * later concern, not one this ticket introduces.
 */
const DEFAULT_JURISDICTION = "ID";

const SESSION_COOKIE_NAME = "yt_session";

/** A minimal, single-purpose read, the same shape `auth.controller.ts`'s own cookie check uses. */
function sessionCookie(request: FastifyRequest): string | undefined {
  const raw = request.headers.cookie;
  if (raw === undefined) return undefined;
  for (const part of raw.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key === SESSION_COOKIE_NAME) return part.slice(separator + 1).trim();
  }
  return undefined;
}

function invalidSession(): UnauthorizedException {
  return new UnauthorizedException({
    code: "invalid_session",
    message: "this session is no longer valid",
  });
}
