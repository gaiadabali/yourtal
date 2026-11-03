import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PartnerVoucherOwnerResult } from "@yourtal/contracts/device/partner-action";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { RateLimit } from "../../shared/rate-limit/rate-limit.decorator";
import { VOUCHER_INTERNAL_CLIENT } from "../../shared/voucher-client/voucher-internal-client";
import type { VoucherInternalClient } from "../../shared/voucher-client/voucher-internal-client";
import { PARTNER_LINK_REPOSITORY } from "./persistence/partner-link.repository";
import type { PartnerLinkRepository } from "./persistence/partner-link.repository";
import { ACCOUNT_AGE_LOOKUP } from "./persistence/account-age-lookup";
import type { AccountAgeLookup } from "./persistence/account-age-lookup";
import { PartnerAuthGuard } from "./partner-auth.guard";
import { PUBLIC_REASON, requirePartnerId } from "./partner-actions.controller";
import { PartnerVoucherOwnerDto } from "./dto/partner-action.schema";
import { voucherOwner } from "./use-cases/voucher-owner.use-case";
import type { VoucherOwnerDeps } from "./use-cases/voucher-owner.use-case";
import { mapPartnersErrorToHttpException } from "./to-http-exception";

/**
 * 2.8 T4 (docs/28 4.2): the partner's voucher reads. Authenticated exactly as
 * `PartnerActionsController` is: partner HMAC via `PartnerAuthGuard`, never a
 * session or a Cerbos principal.
 */
@Controller("api/partners/vouchers")
@UseGuards(PartnerAuthGuard)
export class PartnerVouchersController {
  private readonly deps: VoucherOwnerDeps;

  constructor(
    @Inject(PARTNER_LINK_REPOSITORY) links: PartnerLinkRepository,
    @Inject(ACCOUNT_AGE_LOOKUP) ages: AccountAgeLookup,
    @Inject(VOUCHER_INTERNAL_CLIENT) vouchers: VoucherInternalClient,
  ) {
    this.deps = { links, ages, vouchers };
  }

  @NotValueMoving("A read: it moves no points or vouchers and changes nothing.")
  @RateLimit({ routeId: "partners.vouchers.owner", ip: { max: 60, windowSeconds: 60 } })
  @PublicRoute(PUBLIC_REASON)
  @Post("owner")
  @HttpCode(HttpStatus.OK)
  async owner(
    @Body() body: PartnerVoucherOwnerDto,
    @Req() request: FastifyRequest,
  ): Promise<PartnerVoucherOwnerResult> {
    const partnerId = requirePartnerId(request);
    const result = await voucherOwner(this.deps, {
      partnerId,
      linkId: body.linkId,
      codeSha256: body.codeSha256,
    });
    if (result.isErr()) throw mapPartnersErrorToHttpException(result.error);
    return result.value;
  }
}
