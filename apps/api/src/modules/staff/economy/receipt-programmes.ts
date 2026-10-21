import { err, ok } from "neverthrow";
import type { Result } from "neverthrow";
import { receiptFunders } from "@yourtal/contracts/billing/receipt-funder";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import { toPoints } from "@yourtal/contracts/money";
import type { Region } from "@yourtal/contracts/region";
import type { ReceiptProgrammeRow } from "@yourtal/contracts/staff/economy";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";

export interface ReceiptProgrammeDeps {
  readonly ledger: Pick<
    LedgerInternalClient,
    "getSettings" | "listAllocations" | "receiptProgrammeStats"
  >;
  readonly funderName: (businessId: string) => Promise<string | null>;
}

/**
 * 2.9.c: SnapApp's receipt programme for the staff console. One row per
 * partner with an approved `receipt_funder.<partnerId>` setting in the region:
 * the funder's receipt packages (left and total), the points they paid (all
 * time and 7 days) and the ten biggest earners over 30 days. Packages come
 * from the ledger's allocation read, the aggregates from its one read-only
 * stats route. A funder with no package shows zeros. The ledger's opaque user
 * ids pass through; no email is looked up. Nothing here names the rate.
 */
export async function buildReceiptProgrammes(
  deps: ReceiptProgrammeDeps,
  region: Region,
): Promise<Result<readonly ReceiptProgrammeRow[], LedgerError>> {
  const settings = await deps.ledger.getSettings(region);
  const raw = settings.find((setting) => setting.key === "receipt_points")?.value;
  const pointsPerReceipt = typeof raw === "number" ? raw : 1;

  const programmes: ReceiptProgrammeRow[] = [];
  for (const funder of receiptFunders(settings, region)) {
    const allocations = await deps.ledger.listAllocations(funder.businessId);
    if (allocations.isErr()) return err(allocations.error);
    const packages = allocations.value
      .filter((allocation) => allocation.programme === "receipts")
      .filter((allocation) => allocation.region === region)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const stats = await deps.ledger.receiptProgrammeStats({
      region,
      allocationIds: packages.map((allocation) => allocation.allocationId),
    });
    if (stats.isErr()) return err(stats.error);
    programmes.push({
      partnerId: funder.partnerId,
      funderBusinessId: funder.businessId,
      funderName: (await deps.funderName(funder.businessId)) ?? "",
      pointsPerReceipt: toPoints(pointsPerReceipt),
      packages: packages.map((allocation) => ({
        allocationId: allocation.allocationId,
        totalPoints: allocation.totalPoints,
        remainingPoints: allocation.remainingPoints,
        boughtAt: allocation.createdAt,
      })),
      paidPoints: stats.value.paidPoints,
      paidLast7Days: stats.value.paidLast7Days,
      topEarners: stats.value.topEarners.slice(0, 10),
    });
  }
  return ok(programmes);
}
