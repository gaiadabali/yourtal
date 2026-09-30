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
import { PUBLIC_ROUTE_METADATA } from "../authz/authorize.decorator";
import {
  NO_RATE_LIMIT_METADATA,
  PUBLIC_ROUTE_RATE_LIMIT,
  RATE_LIMIT_METADATA,
  type RateLimitOptions,
} from "./rate-limit.decorator";
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
 * ## Unannotated routes
 *
 * A `@PublicRoute` with neither `@RateLimit` nor `@NoRateLimit` gets
 * `PUBLIC_ROUTE_RATE_LIMIT`, per IP and per handler (13.5.a), so a new
 * anonymous route is never unlimited by omission. A signed-in route with no
 * annotation passes: its caller has an account that can be frozen.
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
    const options = this.policyFor(context);
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

  private policyFor(context: ExecutionContext): RateLimitOptions | undefined {
    const targets = [context.getHandler(), context.getClass()];
    const declared = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_METADATA,
      targets,
    );
    if (declared) return declared;
    if (this.reflector.getAllAndOverride<string | undefined>(NO_RATE_LIMIT_METADATA, targets)) {
      return undefined;
    }
    const isPublic = this.reflector.get<string | undefined>(
      PUBLIC_ROUTE_METADATA,
      context.getHandler(),
    );
    if (isPublic === undefined) return undefined;
    return {
      ...PUBLIC_ROUTE_RATE_LIMIT,
      routeId: `public:${context.getClass().name}.${context.getHandler().name}`,
    };
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
