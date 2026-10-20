import { BadRequestException, Controller, Get, Inject, Param } from "@nestjs/common";
import { toMinorUnits } from "@yourtal/contracts/money";
import type { StaffDisbursements } from "@yourtal/contracts/billing/payouts";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import { DISBURSEMENTS } from "../../payouts/disbursement.repository";
import type { DisbursementRepository } from "../../payouts/disbursement.repository";
import { StaffAction } from "../staff-action.decorator";

/**
 * 5.2.b: what became of each approved payout -- queued, waiting for the
 * brand's account, sent to its account, paid to its bank, or failed. Read
 * beside the payout proposals (staff-settlement.controller.ts), with the same
 * authorisation. Indonesia has no real payouts (F104), so its list is empty.
 */
@Controller("api/staff/settlement")
export class StaffDisbursementsController {
  constructor(@Inject(DISBURSEMENTS) private readonly disbursements: DisbursementRepository) {}

  @Authorize({
    kind: "ledger_adjustment",
    action: "view",
    idFrom: () => "payout",
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("settlement.view_disbursements")
  @NotValueMoving("A read.")
  @Get(":region/disbursements")
  async list(@Param("region") region: string): Promise<StaffDisbursements> {
    if (region !== "AU" && region !== "ID") {
      throw new BadRequestException({
        code: "unknown_region",
        message: `unknown region ${region}`,
      });
    }
    const rows = await this.disbursements.listForRegion(region);
    return {
      region,
      disbursements: rows.map((row) => ({
        ...row,
        amountMinor: toMinorUnits(row.amountMinor),
      })),
    };
  }
}
