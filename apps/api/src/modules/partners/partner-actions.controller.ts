import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type {
  PartnerLinkResult,
  PartnerLinkRevokeResult,
} from "@yourtal/contracts/device/partner-action";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { Idempotent } from "../../shared/idempotency/idempotent.decorator";
import { RateLimit } from "../../shared/rate-limit/rate-limit.decorator";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { PARTNER_RECEIPT_REPOSITORY } from "./persistence/partner-receipt.repository";
import type { PartnerReceiptRepository } from "./persistence/partner-receipt.repository";
import { LINK_CODE_LOOKUP } from "./persistence/link-code-lookup";
import type { LinkCodeLookup } from "./persistence/link-code-lookup";
import { PARTNER_LINK_REPOSITORY } from "./persistence/partner-link.repository";
import type { PartnerLinkRepository } from "./persistence/partner-link.repository";
import { ACCOUNT_AGE_LOOKUP } from "./persistence/account-age-lookup";
import type { AccountAgeLookup } from "./persistence/account-age-lookup";
import { PartnerAuthGuard } from "./partner-auth.guard";
import { verifiedPartnerIdOf } from "./partner-auth";
import { PartnerActionDto, PartnerLinkDto } from "./dto/partner-action.schema";
import { grantPartnerAction } from "./use-cases/grant-partner-action.use-case";
import type { GrantPartnerActionDeps } from "./use-cases/grant-partner-action.use-case";
import { linkPartnerAccount, revokePartnerLink } from "./use-cases/partner-link.use-case";
import { receiptPointsReader } from "./receipt-points-reader";
import { mapPartnersErrorToHttpException } from "./to-http-exception";
import { EARNING_IDENTITY_CHECK } from "../auth/earning-check/earning-identity-check";
import type { EarningIdentityCheck } from "../auth/earning-check/earning-identity-check";

const PARTNER_RETENTION_MS = 24 * 60 * 60 * 1000;
const linkIdParam = z.uuid();
const PUBLIC_REASON =
  "partner-HMAC authenticated; verified by PartnerAuthGuard, never a session or Cerbos principal";

/**
 * TASKS.md 8.4.a, 14.3: a partner app's (SnapApp's) integration. Partner-HMAC
 * authenticated only, never a session and never a Cerbos principal —
 * `@PublicRoute` at the global-guard level (bypasses `PdpGuard`'s
 * session-based check), and `PartnerAuthGuard` (8.4.c) does the real check
 * as its own Nest guard, ahead of `IdempotencyInterceptor`, so the
 * interceptor scopes by the verified partner (`scopeBy: "partner"`) instead
 * of falling through to `principal:anonymous`.
 *
 * Both routes are idempotent per partner: the link code is single-use, so a
 * retry with the same Idempotency-Key is how a partner gets the link id back
 * after a dropped response.
 */
@Controller("api/partners")
@UseGuards(PartnerAuthGuard)
export class PartnerActionsController {
  private readonly deps: GrantPartnerActionDeps;

  constructor(
    @Inject(PARTNER_RECEIPT_REPOSITORY) receipts: PartnerReceiptRepository,
    @Inject(LINK_CODE_LOOKUP) linkCodes: LinkCodeLookup,
    @Inject(PARTNER_LINK_REPOSITORY) links: PartnerLinkRepository,
    @Inject(ACCOUNT_AGE_LOOKUP) ages: AccountAgeLookup,
    @Inject(LEDGER_INTERNAL_CLIENT) ledger: LedgerInternalClient,
    @Inject(EARNING_IDENTITY_CHECK) identityCheck: EarningIdentityCheck,
  ) {
    this.deps = {
      ledger,
      receipts,
      linkCodes,
      links,
      ages,
      receiptPoints: receiptPointsReader(ledger),
      identityVerdict: (userId, region) => identityCheck.verdictFor(userId, region),
    };
  }

  @Idempotent({ retentionMs: PARTNER_RETENTION_MS, scopeBy: "partner" })
  @RateLimit({ routeId: "partners.links", ip: { max: 60, windowSeconds: 60 } })
  @PublicRoute(PUBLIC_REASON)
  @Post("links")
  @HttpCode(HttpStatus.OK)
  async link(
    @Body() body: PartnerLinkDto,
    @Req() request: FastifyRequest,
  ): Promise<PartnerLinkResult> {
    const partnerId = requirePartnerId(request);
    const result = await linkPartnerAccount(this.deps, { partnerId, code: body.code });
    if (result.isErr()) throw mapPartnersErrorToHttpException(result.error);
    const link = result.value;
    return { linkId: link.id, region: link.region, createdAt: link.createdAt };
  }

  @Idempotent({ retentionMs: PARTNER_RETENTION_MS, scopeBy: "partner" })
  @RateLimit({ routeId: "partners.links.revoke", ip: { max: 60, windowSeconds: 60 } })
  @PublicRoute(PUBLIC_REASON)
  @Post("links/:linkId/revoke")
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param("linkId") linkId: string,
    @Req() request: FastifyRequest,
  ): Promise<PartnerLinkRevokeResult> {
    const partnerId = requirePartnerId(request);
    // A malformed id names no link; answered like any other unknown one.
    if (!linkIdParam.safeParse(linkId).success) {
      throw mapPartnersErrorToHttpException({ type: "unknown_link" });
    }
    const result = await revokePartnerLink(this.deps.links, { partnerId, linkId });
    if (result.isErr()) throw mapPartnersErrorToHttpException(result.error);
    return result.value;
  }

  @Idempotent({ retentionMs: PARTNER_RETENTION_MS, scopeBy: "partner" })
  @RateLimit({ routeId: "partners.actions", ip: { max: 120, windowSeconds: 60 } })
  @PublicRoute(PUBLIC_REASON)
  @Post("actions")
  // route-registry.c-partners.ts declares 200 ("the grant", not a created
  // resource) -- Nest's default for @Post is 201, so this makes the two agree.
  @HttpCode(HttpStatus.OK)
  async actions(@Body() body: PartnerActionDto, @Req() request: FastifyRequest) {
    const partnerId = requirePartnerId(request);
    const result = await grantPartnerAction(this.deps, {
      partnerId,
      linkCode: body.user,
      linkId: body.linkId,
      externalRef: body.externalRef,
    });
    if (result.isErr()) throw mapPartnersErrorToHttpException(result.error);
    return result.value;
  }
}

function requirePartnerId(request: FastifyRequest): string {
  // Unreachable: PartnerAuthGuard already refused an unverified request
  // (401) before this handler, or every interceptor ahead of it, ever ran.
  const partnerId = verifiedPartnerIdOf(request);
  if (partnerId === undefined) {
    throw new InternalServerErrorException("no verified partner id on an authenticated request");
  }
  return partnerId;
}
