import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PARTNER_CREDENTIAL_REPOSITORY } from "./persistence/partner-credential.repository";
import type { PartnerCredentialRepository } from "./persistence/partner-credential.repository";
import { VERIFIED_PARTNER_REQUEST_KEY, verifyPartnerSignature } from "./partner-auth";

/**
 * TASKS.md 8.4.c (found by 8.2.h): verifies the partner HMAC signature as a
 * Nest GUARD, not inside the handler body — guards run before every
 * interceptor (`docs/13a`'s fixed order, same reasoning
 * `idempotency.interceptor.ts`'s own header gives), so
 * `IdempotencyInterceptor` never sees an unverified request for
 * `POST /api/partners/actions`. Before this, the signature check ran
 * inside the handler, which is AFTER the interceptor already resolved a
 * scope for it — `partner-actions.controller.ts`'s HMAC scheme
 * (`Authorization: Partner ...`) doesn't match the session resolver's
 * `Bearer` check, so every call fell through to `principal:anonymous`: two
 * different partners reusing one Idempotency-Key would have shared a
 * stored response, with no grant of their own (8.4.c, found by 8.2.h's own
 * fix for the device-route shape of this same class of bug).
 *
 * On success, writes the verified partner id onto the request under
 * `VERIFIED_PARTNER_REQUEST_KEY` (`partner-auth.ts`) — a plain
 * request-property convention, not an import, so `shared/idempotency`
 * never depends on `modules/partners`.
 */
@Injectable()
export class PartnerAuthGuard implements CanActivate {
  constructor(
    @Inject(PARTNER_CREDENTIAL_REPOSITORY)
    private readonly credentials: PartnerCredentialRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const partner = await verifyPartnerSignature(request, this.credentials);
    if (partner === null) {
      throw new UnauthorizedException({
        code: "invalid_partner_signature",
        message: "no valid partner signature presented",
      });
    }
    Reflect.set(request, VERIFIED_PARTNER_REQUEST_KEY, partner.partnerId);
    return true;
  }
}
