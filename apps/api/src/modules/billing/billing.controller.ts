import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PaymentsDriver } from "@yourtal/drivers/payments";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { PAYMENTS_DRIVER } from "../../shared/drivers/payments-driver.module";
import { BUSINESS_REGION_LOOKUP } from "../store/persistence/business-region-lookup";
import type { BusinessRegionLookup } from "../store/persistence/business-region-lookup";
import { quotePurchaseQuerySchema } from "./dto/quote-purchase-query";
import { PurchasePointsDto } from "./dto/purchase-points.schema";
import { PURCHASE_RETENTION_MS } from "./retention";
import { mapBillingErrorToHttpException } from "./to-http-exception";
import { getBalance } from "./use-cases/get-balance.use-case";
import { getCampaignSpend } from "./use-cases/get-campaign-spend.use-case";
import { purchasePoints } from "./use-cases/purchase-points.use-case";
import { quotePurchase } from "./use-cases/quote-purchase.use-case";

/**
 * 7.5: Studio billing -- buying points. Every route is `/api/:tenantId/studio/billing/*`
 * per Phase 7's own routing rule ("Every Studio route sits under
 * `api/:tenantId/studio/...`").
 *
 * Reuses the `billing` resource kind and its already-built policy
 * (`policies/resource_policies/billing.yaml`): `purchase_points` for the
 * spend, `view` for everything read-only here.
 *
 * Statements and their dispute route needed 10.1 (not built) and are now
 * 10.6.b (F40) -- not this controller's job at all.
 */
@Controller("api/:tenantId/studio/billing")
export class BillingController {
  constructor(
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
    @Inject(PAYMENTS_DRIVER) private readonly payments: PaymentsDriver,
    @Inject(BUSINESS_REGION_LOOKUP) private readonly businessRegionLookup: BusinessRegionLookup,
  ) {}

  @Authorize({ kind: "billing", action: "view" })
  @NotValueMoving("A quote. Nothing moves until POST /purchases.")
  @Get("purchases/quote")
  async quote(
    @Param("tenantId") tenantId: string,
    @Query() query: Record<string, string | string[] | undefined>,
  ) {
    const parsed = quotePurchaseQuerySchema.parse(query);
    const result = await quotePurchase(
      this.ledger,
      this.businessRegionLookup,
      tenantId,
      parsed.points,
    );
    if (result.isErr()) throw mapBillingErrorToHttpException(result.error);
    return result.value;
  }

  @Authorize({ kind: "billing", action: "purchase_points" })
  @Idempotent({ retentionMs: PURCHASE_RETENTION_MS })
  @Post("purchases")
  async purchase(
    @Param("tenantId") tenantId: string,
    @Body() body: PurchasePointsDto,
    @Req() request: FastifyRequest,
  ) {
    // The interceptor behind `@Idempotent` already requires this header and
    // scopes its OWN replay store by principal+route -- this key additionally
    // seeds `ledger-client.purchasePoints`'s own idempotency column, scoped
    // per business so two businesses reusing the same client-chosen key
    // never collide (see purchase-points.use-case.ts).
    const rawKey = request.headers["idempotency-key"];
    const idempotencyKey = `${tenantId}:${Array.isArray(rawKey) ? rawKey[0] : rawKey}`;

    const result = await purchasePoints(this.ledger, this.payments, this.businessRegionLookup, {
      merchantId: tenantId,
      points: body.points,
      currency: body.currency,
      idempotencyKey,
    });
    if (result.isErr()) throw mapBillingErrorToHttpException(result.error);
    return result.value;
  }

  @Authorize({ kind: "billing", action: "view" })
  @NotValueMoving("A read.")
  @Get("balance")
  async balance(@Param("tenantId") tenantId: string) {
    const result = await getBalance(this.ledger, tenantId);
    if (result.isErr()) throw mapBillingErrorToHttpException(result.error);
    return result.value;
  }

  @Authorize({ kind: "billing", action: "view" })
  @NotValueMoving("A read.")
  @Get("campaigns/:campaignId/spend")
  async campaignSpend(
    @Param("tenantId") tenantId: string,
    @Param("campaignId") campaignId: string,
  ) {
    const result = await getCampaignSpend(this.ledger, tenantId, campaignId);
    if (result.isErr()) throw mapBillingErrorToHttpException(result.error);
    return result.value;
  }
}
