import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { Idempotent } from "../../shared/idempotency/idempotent.decorator";
import { RateLimit } from "../../shared/rate-limit/rate-limit.decorator";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { PARTNER_RECEIPT_REPOSITORY } from "./persistence/partner-receipt.repository";
import type { PartnerReceiptRepository } from "./persistence/partner-receipt.repository";
import { LINK_CODE_LOOKUP } from "./persistence/link-code-lookup";
import type { LinkCodeLookup } from "./persistence/link-code-lookup";
import { PartnerAuthGuard } from "./partner-auth.guard";
import { verifiedPartnerIdOf } from "./partner-auth";
import { PartnerActionDto } from "./dto/partner-action.schema";
import { grantPartnerAction } from "./use-cases/grant-partner-action.use-case";
import { receiptPointsReader } from "./receipt-points-reader";
import { mapPartnersErrorToHttpException } from "./to-http-exception";

const PARTNER_ACTION_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * TASKS.md 8.4.a: snap-app's receipt-scan integration (docs/16 — a sister
 * company, the first partner). Partner-HMAC authenticated only, never a
 * session and never a Cerbos principal — `@PublicRoute` at the global-guard
 * level (bypasses `PdpGuard`'s session-based check), `PartnerAuthGuard`
 * (8.4.c) does the real check as its own Nest guard, ahead of
 * `IdempotencyInterceptor` — the same split `device-authorize.ts` documents
 * for a different kind of non-session caller, but as an actual guard here
 * rather than an in-handler check, specifically so the interceptor can
 * scope by the verified partner (`scopeBy: "partner"`) instead of falling
 * through to `principal:anonymous` (8.4.c, found by 8.2.h).
 */
@Controller("api/partners")
@UseGuards(PartnerAuthGuard)
export class PartnerActionsController {
  constructor(
    @Inject(PARTNER_RECEIPT_REPOSITORY) private readonly receipts: PartnerReceiptRepository,
    @Inject(LINK_CODE_LOOKUP) private readonly linkCodes: LinkCodeLookup,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
  ) {}

  @Idempotent({ retentionMs: PARTNER_ACTION_RETENTION_MS, scopeBy: "partner" })
  @RateLimit({ routeId: "partners.actions", ip: { max: 120, windowSeconds: 60 } })
  @PublicRoute(
    "partner-HMAC authenticated; verified by PartnerAuthGuard, never a session or Cerbos principal",
  )
  @Post("actions")
  // route-registry.c-partners.ts declares 200 ("the grant", not a created
  // resource) -- Nest's default for @Post is 201, so this makes the two agree.
  @HttpCode(HttpStatus.OK)
  async actions(@Body() body: PartnerActionDto, @Req() request: FastifyRequest) {
    // Unreachable: PartnerAuthGuard already refused an unverified request
    // (401) before this handler, or every interceptor ahead of it, ever ran.
    const partnerId = verifiedPartnerIdOf(request);
    if (partnerId === undefined) {
      throw new InternalServerErrorException("no verified partner id on an authenticated request");
    }

    const result = await grantPartnerAction(
      this.ledger,
      this.linkCodes,
      this.receipts,
      receiptPointsReader(this.ledger),
      { partnerId, linkCode: body.user, externalRef: body.externalRef },
    );
    if (result.isErr()) throw mapPartnersErrorToHttpException(result.error);
    return result.value;
  }
}
