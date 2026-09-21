import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { anonymousPrincipal, principalSchema } from "@yourtal/authz/principal";
import type { Principal } from "@yourtal/authz/principal";
import { businessRoleSchema } from "@yourtal/authz/roles";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";

/**
 * THE one place a `Principal` is assembled (docs/17 sections 2.1, 4.6). Every
 * controller in this app calls `resolve()` exactly once and passes the
 * result to `pdpClient.requireAction` — never builds a principal itself.
 *
 * INTERIM, by design, pending YT-0500 and the Zitadel integration (YT-0032):
 * there is no session or verified JWT to read yet, so this trusts a small
 * set of headers instead of a cookie/token. That is a placeholder for WHERE
 * identity comes from, not for HOW authorization is asked — the PDP call
 * downstream of this is the real thing and does not change when YT-0500
 * lands. When it does, only the body of `resolve()` changes (header reads
 * become session/JWT reads); every call site stays identical, which is the
 * property the coordinator asked this seam to have.
 *
 * Not safe past local development and tests: these headers are trusted
 * verbatim, so a deployment that exposes this app before YT-0500 replaces
 * this method is a spoofable-identity bug, not a hardening gap.
 *
 * Which is why the constructor REFUSES TO BOOT in production rather than
 * relying on the paragraph above being read. docs/14 section 8 (A10) is
 * categorical that value operations fail closed, and an identity layer that
 * trusts `x-yt-user-id` is the most fail-open thing that could exist here:
 * anyone could name themselves the owner of any business. A comment is
 * documentation, not a control, and the failure mode it guards against is
 * someone deploying this without reading it.
 *
 * ## This class's shape is deliberately untouched by YT-0582
 *
 * `resolve()` is synchronous and reads only the request — it cannot ask
 * anything of stored state, which is why `valueFrozenUntil` and three other
 * `policies/_schemas/principal.json` attributes were never populatable
 * (`principal-attribute-coverage.test.ts` proves that generically). The fix
 * is `AsyncPrincipalResolver` (this same directory), a SEPARATE class that
 * composes this one with a database read, rather than a new method added
 * here. That is deliberate, not a style choice: `apps/api/src/modules/store/**`
 * and `apps/api/src/modules/watch/**` (other work in flight, out of this
 * ticket's reach) duck-type `PrincipalService` directly in their own tests —
 * `{ resolve: vi.fn() }` passed where a `PrincipalService` is expected, with
 * no cast — so any new public member on this class breaks their structural
 * typing without a line of theirs being touched. Composing instead of
 * widening keeps this class's type exactly as it was.
 */
@Injectable()
export class PrincipalService {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (config.nodeEnv === "production") {
      throw new Error(
        "PrincipalService trusts x-yt-* headers verbatim and cannot run in production. " +
          "It is an interim seam pending YT-0500 (PDP enforcement) and YT-0032 (Zitadel). " +
          "Replace the body of resolve() with a verified session or JWT read before deploying.",
      );
    }
  }

  resolve(request: FastifyRequest): Principal {
    // A malformed interim header is a client mistake in a dev-only path, not
    // an expected domain failure — throwing matches docs/13b section 4. One
    // try/catch covers every parse below (JSON.parse throws a bare
    // SyntaxError, Zod throws ZodError; both collapse to the same 401).
    try {
      const userId = firstHeaderValue(request.headers["x-yt-user-id"]);
      const jurisdiction = jurisdictionSchema.parse(
        firstHeaderValue(request.headers["x-yt-jurisdiction"]) ?? "ID",
      );

      if (userId === undefined) {
        return anonymousPrincipal(jurisdiction);
      }

      const businessRoles = parseBusinessRolesHeader(
        firstHeaderValue(request.headers["x-yt-business-roles"]),
      );
      const isSuspended = firstHeaderValue(request.headers["x-yt-suspended"]) === "true";
      const roles =
        Object.keys(businessRoles).length > 0
          ? (["user", "business_user"] as const)
          : (["user"] as const);

      return principalSchema.parse({
        id: userId,
        roles,
        attr: { jurisdiction, businessRoles, isSuspended },
      });
    } catch {
      throw invalidPrincipalHeaders();
    }
  }
}

function invalidPrincipalHeaders(): UnauthorizedException {
  return new UnauthorizedException({
    code: "invalid_principal_headers",
    message: "could not assemble a principal from the request",
  });
}

const jurisdictionSchema = z.enum(["ID", "AU"]);
const businessRolesHeaderSchema = z.record(z.string().min(1), businessRoleSchema);

function parseBusinessRolesHeader(
  raw: string | undefined,
): Record<string, z.infer<typeof businessRoleSchema>> {
  if (raw === undefined) {
    return {};
  }
  const candidate: unknown = JSON.parse(raw);
  return businessRolesHeaderSchema.parse(candidate);
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
