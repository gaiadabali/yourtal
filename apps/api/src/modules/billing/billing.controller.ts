import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { PaymentsDriver } from "@yourtal/drivers/payments";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { LedgerNotFoundError } from "../../shared/ledger-client/ledger-not-found";
import { PAYMENTS_DRIVER } from "../../shared/drivers/payments-driver.module";
import { BUSINESS_REGION_LOOKUP } from "../store/persistence/business-region-lookup";
import type { BusinessRegionLookup } from "../store/persistence/business-region-lookup";
import { quotePurchaseQuerySchema } from "./dto/quote-purchase-query";
import { PurchasePointsDto } from "./dto/purchase-points.schema";
import { RaiseStatementDisputeDto } from "./dto/raise-statement-dispute.schema";
import { PURCHASE_RETENTION_MS } from "./retention";
import { mapBillingErrorToHttpException } from "./to-http-exception";
import { getBalance } from "./use-cases/get-balance.use-case";
import { getCampaignSpend } from "./use-cases/get-campaign-spend.use-case";
import { listStatements, toBillingStatement } from "./use-cases/list-statements.use-case";
import { purchasePoints } from "./use-cases/purchase-points.use-case";
import { quotePurchase } from "./use-cases/quote-purchase.use-case";
import { statementsToCsv } from "./statements-csv";

/**
 * 7.5: Studio billing -- buying points. Every route is `/api/:tenantId/studio/billing/*`
 * per Phase 7's own routing rule ("Every Studio route sits under
 * `api/:tenantId/studio/...`").
 *
 * Reuses the `billing` resource kind and its already-built policy
 * (`policies/resource_policies/billing.yaml`): `purchase_points` for the
 * spend, `view` for everything read-only here, and -- now that 10.1 exists
 * -- `view_statement`/`raise_dispute` for the statements below (10.6.b).
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

  // -- 10.1.b/10.6.b: statements -----------------------------------------

  @Authorize({ kind: "billing", action: "view_statement" })
  @NotValueMoving("A read.")
  @Get("statements")
  async statements(
    @Param("tenantId") tenantId: string,
    @Query("from") fromQuery: string | undefined,
    @Query("to") toQuery: string | undefined,
    @Query("format") format: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    // A year back by default -- generous enough to show every statement a
    // business is likely to want without asking every caller to state a
    // range just to see "the recent ones".
    const to = toQuery ?? new Date().toISOString().slice(0, 10);
    const from = fromQuery ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const result = await listStatements(this.ledger, tenantId, from, to);
    if (result.isErr()) throw mapBillingErrorToHttpException(result.error);

    if (format === "csv") {
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="statements-${tenantId}.csv"`);
      return statementsToCsv(result.value);
    }
    return result.value;
  }

  @Authorize({ kind: "billing", action: "raise_dispute" })
  @Idempotent({ retentionMs: PURCHASE_RETENTION_MS })
  @Post("statements/:id/dispute")
  async disputeStatement(
    @Param("tenantId") tenantId: string,
    @Param("id") id: string,
    @Body() body: RaiseStatementDisputeDto,
  ) {
    // Tenancy checked BEFORE the mutation below, not after: a business
    // proves it may raise_dispute on `billing` AT ALL above, but a
    // statement id is not scoped to a tenant by the route itself, and
    // disputing first and rejecting on ownership second would still have
    // moved another business's statement. `statements()` is scoped to
    // `tenantId` by the ledger itself, so a match here is the real proof
    // this id belongs to this tenant.
    const owned = await listStatements(this.ledger, tenantId, "1970-01-01", "9999-12-31");
    if (owned.isErr()) throw mapBillingErrorToHttpException(owned.error);
    if (!owned.value.some((statement) => statement.id === id)) {
      throw new NotFoundException({ code: "statement_not_found", message: `no statement ${id}` });
    }

    try {
      const result = await this.ledger.disputeStatement({ statementId: id, reason: body.reason });
      if (result.isErr()) {
        throw mapBillingErrorToHttpException({
          type: "ledger_refused",
          code: result.error.code,
          message: result.error.message,
        });
      }
      return toBillingStatement(result.value);
    } catch (cause) {
      if (cause instanceof LedgerNotFoundError) {
        throw new NotFoundException({ code: "statement_not_found", message: `no statement ${id}` });
      }
      throw cause;
    }
  }
}
