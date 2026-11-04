import { Injectable, InternalServerErrorException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { enforceRateLimit } from "../../shared/rate-limit/rate-limit.guard";
import type { RateLimitPolicy } from "../../shared/rate-limit/rate-limit.service";
import { RateLimitService } from "../../shared/rate-limit/rate-limit.service";
import { verifiedPartnerIdOf } from "./partner-auth";

/**
 * 2.8.f: one budget per partner across ALL `/api/partners/*` routes, summed.
 * 1200/min (20 per second) is above anything SnapApp can reach today: the
 * per-IP limits it shares through one server address already cap it at 360
 * a minute in total (60 links + 60 revoke + 60 status + 120 actions + 60 owner),
 * so this never refuses legitimate traffic, and only bites a leaked key
 * spread over many addresses. Not measured from production traffic.
 */
export const PARTNER_RATE_LIMIT: RateLimitPolicy = {
  identity: { max: 1200, windowSeconds: 60 },
};
const PARTNER_RATE_LIMIT_ROUTE_ID = "partners.all";

/**
 * Runs AFTER `PartnerAuthGuard` (list it second in `@UseGuards`), so the key
 * is the partner id that guard verified, never anything the caller sent, and
 * an unauthenticated flood is refused with 401 before it reaches here and only
 * ever meets the global per-IP limit. Counted on the shared limiter's
 * `identity` dimension, so a refusal is the same 429 as the per-IP one.
 */
@Injectable()
export class PartnerRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const identityId = verifiedPartnerIdOf(request);
    // Misordered guards must fail loudly, not silently leave a route unlimited.
    if (identityId === undefined) {
      throw new InternalServerErrorException("PartnerRateLimitGuard ran before PartnerAuthGuard");
    }
    await enforceRateLimit(
      this.rateLimit,
      { routeId: PARTNER_RATE_LIMIT_ROUTE_ID, ip: request.ip, identityId },
      PARTNER_RATE_LIMIT,
    );
    return true;
  }
}
