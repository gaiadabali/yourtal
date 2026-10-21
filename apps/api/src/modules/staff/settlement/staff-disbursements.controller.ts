import { BadRequestException, Controller, Get, Inject, Param } from "@nestjs/common";
import type { StaffDisbursements } from "@yourtal/contracts/billing/payouts";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import { DISBURSEMENTS } from "../../payouts/disbursement.repository";
import type { DisbursementRepository } from "../../payouts/disbursement.repository";
import { StaffAction } from "../staff-action.decorator";
import { STAFF_DIRECTORY, emailsOf } from "../persistence/staff-directory";
import type { StaffDirectory } from "../persistence/staff-directory";
import {
  ECONOMY_PROPOSAL_REPOSITORY,
  toEconomyProposalWithEmail,
} from "../economy/persistence/economy-proposal.repository";
import type { EconomyProposalRepository } from "../economy/persistence/economy-proposal.repository";
import { toStaffDisbursement } from "./to-staff-disbursement";

/**
 * 5.2.b: what became of each approved payout -- queued, waiting for the
 * brand's account, sent to its account, paid to its bank, or failed. Read
 * beside the payout proposals (staff-settlement.controller.ts), with the same
 * authorisation. Indonesia has no real payouts (F104), so its list is empty.
 * 5.2.c: each row says whether staff must look at it (`needsStaff`) and carries
 * its pending retry proposal, if any; the actions are in
 * staff-disbursement-recovery.controller.ts.
 */
@Controller("api/staff/settlement")
export class StaffDisbursementsController {
  constructor(
    @Inject(DISBURSEMENTS) private readonly disbursements: DisbursementRepository,
    @Inject(ECONOMY_PROPOSAL_REPOSITORY) private readonly proposals: EconomyProposalRepository,
    @Inject(STAFF_DIRECTORY) private readonly directory: StaffDirectory,
  ) {}

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
    // 5.2.c: a retry waiting for a second staff member shows on its row.
    const pending = await this.proposals.listPending(region, "retry_disbursement");
    // The retry line names its proposer by email; one lookup per distinct staff member.
    const emails = await emailsOf(
      this.directory,
      pending.map((row) => row.proposedBy),
    );
    const retries = new Map(
      pending.map((row) => [
        String(row.payload["disbursementId"]),
        toEconomyProposalWithEmail(row, emails.get(row.proposedBy) ?? null),
      ]),
    );
    return {
      region,
      disbursements: rows.map((row) => toStaffDisbursement(row, retries.get(row.id) ?? null)),
    };
  }
}
