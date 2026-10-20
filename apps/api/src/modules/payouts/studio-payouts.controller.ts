import { Controller, Get, Inject, NotFoundException, Param, Post } from "@nestjs/common";
import { toMinorUnits } from "@yourtal/contracts/money";
import type { PayoutLink, StudioPayouts } from "@yourtal/contracts/billing/payouts";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { BUSINESS_REGION_LOOKUP } from "../store/persistence/business-region-lookup";
import type { BusinessRegionLookup } from "../store/persistence/business-region-lookup";
import type { PayoutOwner } from "./connected-account.repository";
import { CONNECTED_ACCOUNTS_SERVICE } from "./connected-accounts.service";
import type { ConnectedAccountsService } from "./connected-accounts.service";
import { DISBURSEMENTS } from "./disbursement.repository";
import type { DisbursementRepository } from "./disbursement.repository";
import { linkOrThrow } from "./payout-link";

/**
 * 5.2: where a brand's approved statements are paid. The account is set up,
 * and its bank details changed, on the processor's own page; nothing about
 * the bank but its last four digits reaches this app. Australia only (F104).
 */
@Controller("api/:tenantId/studio/billing/payouts")
export class StudioPayoutsController {
  constructor(
    @Inject(CONNECTED_ACCOUNTS_SERVICE) private readonly accounts: ConnectedAccountsService,
    @Inject(DISBURSEMENTS) private readonly disbursements: DisbursementRepository,
    @Inject(BUSINESS_REGION_LOOKUP) private readonly businesses: BusinessRegionLookup,
  ) {}

  @Authorize({ kind: "billing", action: "view" })
  @NotValueMoving("A read; it may store the processor's newer view of the account.")
  @Get()
  async status(@Param("tenantId") tenantId: string): Promise<StudioPayouts> {
    const owner = await this.owner(tenantId);
    const account = await this.accounts.status(owner);
    const rows = owner === null ? [] : await this.disbursements.listForBusiness(tenantId);
    return {
      account,
      payoutFailed: rows.some((row) => row.status === "failed"),
      waitingForAccount: rows.some((row) => row.status === "awaiting_account"),
      payouts: rows.map((row) => ({
        statementId: row.statementId,
        status: row.status,
        amountMinor: toMinorUnits(row.amountMinor),
        currency: row.currency,
        bankLast4: row.bankLast4,
        paidAt: row.paidAt,
        failureCode: row.failureCode,
      })),
    };
  }

  @Authorize({ kind: "billing", action: "manage_payouts" })
  @NotValueMoving(
    "Opens the processor's page to set up the account or change its bank; no money moves, and " +
      "a repeat only makes another link to the same account.",
  )
  @Post("link")
  async link(@Param("tenantId") tenantId: string): Promise<PayoutLink> {
    const owner = await this.owner(tenantId);
    if (owner === null) {
      throw new NotFoundException({
        code: "payouts_unavailable",
        message: "Payouts to a bank account are not offered in this region.",
      });
    }
    const studio = `/studio/billing?business=${encodeURIComponent(tenantId)}`;
    return linkOrThrow(
      await this.accounts.startLink(owner, {
        returnPath: studio,
        refreshPath: `/studio/billing/payouts/refresh?business=${encodeURIComponent(tenantId)}`,
      }),
      `business ${tenantId}`,
    );
  }

  /** Null outside Australia: F104 leaves Indonesia exactly as it was. */
  private async owner(tenantId: string): Promise<PayoutOwner | null> {
    const business = await this.businesses.findRegionAndCurrency(tenantId);
    if (business === null) throw new NotFoundException({ code: "business_not_found" });
    return business.region === "AU" ? { kind: "business", id: tenantId, region: "AU" } : null;
  }
}
