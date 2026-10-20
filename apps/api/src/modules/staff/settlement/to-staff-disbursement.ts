import { toMinorUnits } from "@yourtal/contracts/money";
import { STAFF_RETRY_FAILURE_CODES } from "@yourtal/contracts/billing/payouts";
import type { StaffDisbursement } from "@yourtal/contracts/billing/payouts";
import type { EconomyProposal } from "@yourtal/contracts/staff/economy";
import type { DisbursementRow } from "../../payouts/disbursement.repository";

const STAFF_CODES: ReadonlySet<string> = new Set(STAFF_RETRY_FAILURE_CODES);

/** A failed row the job will not retry by itself: staff check it again, and retry it once the processor shows nothing moved. */
export function needsStaff(status: string, failureCode: string | null): boolean {
  return status === "failed" && failureCode !== null && STAFF_CODES.has(failureCode);
}

export function toStaffDisbursement(
  row: DisbursementRow,
  retryProposal: EconomyProposal | null,
): StaffDisbursement {
  return {
    ...row,
    amountMinor: toMinorUnits(row.amountMinor),
    needsStaff: needsStaff(row.status, row.failureCode),
    retryProposal,
  };
}
