import { Controller, Get, Inject, Param, ServiceUnavailableException } from "@nestjs/common";
import type { BillingAllocation } from "@yourtal/contracts/billing";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";

/**
 * 13.3.b (journey 3): the allocations a campaign's reward can draw from, for
 * whoever authors campaigns. Billing's balance is owner, admin and finance
 * only, so a marketer had no allocation to pick. Partner-funded only: the
 * reward config refuses any other (`allocation_not_partner_funded`).
 */
@Controller("api/:tenantId/studio/campaign-funding")
export class CampaignFundingController {
  constructor(@Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient) {}

  @NotValueMoving("A read.")
  @Authorize({ kind: "campaign", action: "create" })
  @Get()
  async list(@Param("tenantId") tenantId: string): Promise<BillingAllocation[]> {
    const result = await this.ledger.listAllocations(tenantId);
    if (result.isErr()) {
      throw new ServiceUnavailableException({
        code: "ledger_unavailable",
        message: "the business's funded points could not be read",
      });
    }
    return result.value
      .filter((allocation) => allocation.funderType === "partner")
      .map(({ allocationId, region, funderType, totalPoints, remainingPoints, createdAt }) => ({
        allocationId,
        region,
        funderType,
        totalPoints,
        remainingPoints,
        createdAt,
      }));
  }
}
