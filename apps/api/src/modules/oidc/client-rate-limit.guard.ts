import { Injectable, InternalServerErrorException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { RATE_LIMIT_METADATA } from "../../shared/rate-limit/rate-limit.decorator";
import type { RateLimitOptions } from "../../shared/rate-limit/rate-limit.decorator";
import { enforceRateLimit } from "../../shared/rate-limit/rate-limit.guard";
import { RateLimitService } from "../../shared/rate-limit/rate-limit.service";
import { VERIFIED_OIDC_CLIENT_KEY } from "./teen-invite-client.guard";

/**
 * 4.10.b: counts the `identity` window a route declares in `@RateLimit` against
 * the client id that `OidcClientGuard` verified. List it AFTER that guard. The
 * global limiter runs first and has no client yet, so it only ever applies the
 * route's `ip` window; keep that one loose, because every app's server calls
 * through one address and the `ip` window is shared by all of them.
 */
@Injectable()
export class OidcClientRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const clientId: unknown = Reflect.get(request, VERIFIED_OIDC_CLIENT_KEY);
    const options = this.reflector.get<RateLimitOptions | undefined>(
      RATE_LIMIT_METADATA,
      context.getHandler(),
    );
    // Misordered or unannotated routes must fail loudly, not run unlimited.
    if (typeof clientId !== "string" || options?.identity === undefined) {
      throw new InternalServerErrorException(
        "OidcClientRateLimitGuard needs a verified client and an identity window",
      );
    }
    await enforceRateLimit(
      this.rateLimit,
      { routeId: options.routeId, ip: request.ip, identityId: clientId },
      { identity: options.identity },
    );
    return true;
  }
}
