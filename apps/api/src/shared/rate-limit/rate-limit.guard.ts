import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { RATE_LIMIT_METADATA, type RateLimitOptions } from "./rate-limit.decorator";
import { RateLimitService } from "./rate-limit.service";

/**
 * Applies `@RateLimit` metadata. YT-0052 AC2.
 *
 * ## Why this runs before `PdpGuard`
 *
 * `app.module.ts` registers it first. `docs/13a`'s order is auth → Cerbos →
 * idempotency → module, and rate limiting belongs in front of all of it for
 * the same reason `PdpGuard` sits in front of `IdempotencyInterceptor`: the
 * cheapest possible refusal. A limiter that ran after authorization would
 * still pay for a principal resolution and a Cerbos round trip per request
 * in a flood — which is to say it would bound the wrong cost, and the
 * remaining one is the one an attacker is actually spending.
 *
 * ## Unannotated routes pass
 *
 * A route with neither `@RateLimit` nor `@NoRateLimit` is allowed through
 * unlimited. That is a deliberate, and temporary, default: making the
 * absence of an annotation a build failure is the right end state — it is
 * exactly what `mutating-routes.test.ts` does for `@Idempotent` — but
 * turning it on in the same change that introduces the mechanism would fail
 * the build for every route in the app at once, including routes owned by
 * other sessions working in this tree right now. The enforcing test is
 * deliberately left for a follow-up so that it lands as its own reviewable
 * change. Until it does, **this guard limits what is declared and is silent
 * about what is not**, which is a weaker claim than the ticket's criterion
 * and is recorded rather than glossed.
 *
 * ## A limiter that cannot reach its store refuses
 *
 * If Valkey errors, this returns 503 rather than allowing the request. See
 * `RateLimitService`'s doc comment: failing open would remove the limits
 * precisely when the system is under the stress that makes them matter.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!options) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();

    // `identityId` is spread in only when there is one, rather than set to
    // `undefined`: `exactOptionalPropertyTypes` is on in this repo, so an
    // explicit `undefined` is not the same as an absent property. That
    // strictness is doing real work here — "no principal" and "a principal
    // whose id is undefined" are genuinely different, and only the first
    // should cause `RateLimitService` to skip the identity dimension.
    const identityId = identityOf(request);
    const verdict = await this.rateLimit
      .consume(
        {
          routeId: options.routeId,
          ip: request.ip,
          ...(identityId === undefined ? {} : { identityId }),
        },
        options,
      )
      .catch((cause: unknown) => {
        throw new ServiceUnavailableException(
          "Rate limiting is unavailable, so this request cannot be served.",
          { cause },
        );
      });

    if (!verdict.blocked) return true;

    // 429 with Retry-After. The body deliberately does NOT name which
    // dimension refused: telling a caller whether they hit the per-IP or
    // the per-route limit tells them whether rotating addresses would help.
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: "Too Many Requests",
        message: "Too many requests. Try again later.",
        retryAfterSeconds: verdict.retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * The authenticated principal id, when the request carries one.
 *
 * Read from whatever earlier stage attached it, and absent for an
 * anonymous request — which is correct rather than a gap: this guard runs
 * BEFORE `PdpGuard` resolves a principal, so on an anonymous route there
 * genuinely is no identity yet and `RateLimitService` skips that dimension
 * rather than inventing a shared one.
 */
function identityOf(request: FastifyRequest): string | undefined {
  const principal = (request as FastifyRequest & { principal?: { id?: unknown } }).principal;
  return typeof principal?.id === "string" ? principal.id : undefined;
}
