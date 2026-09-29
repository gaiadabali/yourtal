import "server-only";
import { forbidden } from "next/navigation";
import {
  economyProposalSchema,
  type EconomyProposal,
} from "@yourtal/contracts/staff/economy";
import {
  settlementQueueSchema,
  type SettlementQueue,
} from "@yourtal/contracts/staff/settlement";
import { z } from "zod";
import type { ApiError } from "@/lib/api/api-fetch";
import { apiFetch } from "@/lib/api/api-fetch";

/**
 * TASKS.md 10.6.a: the staff console's settlement screens -- reads only.
 * Mutations are in `staff-settlement-actions.ts`. Same `forbidden()`
 * boundary every other Phase 9/10 staff data module follows (9.5's
 * `staff-economy-data.ts`): a role Cerbos refuses on `view_statement_queue`
 * gets a real 403 here, not a 500.
 */
function throwOrForbid(action: string, error: ApiError): never {
  if (error.kind === "http" && error.status === 403) forbidden();
  throw new Error(`Could not ${action}: ${error.message}`);
}

export async function getSettlementQueue(region: "AU" | "ID"): Promise<SettlementQueue> {
  const result = await apiFetch(`/api/staff/settlement/${region}/queue`, settlementQueueSchema);
  if (!result.ok) throwOrForbid("load the settlement queue", result.error);
  return result.data;
}

const payoutProposalListSchema = z.array(economyProposalSchema);

/** `[]` on a 403 -- ops shares this page (it can see the queue) but has no `ledger_adjustment.view` rule, same tolerance `getMarketingFundings` gives ops on the economy marketing screen. */
export async function getPayoutProposals(region: "AU" | "ID"): Promise<readonly EconomyProposal[]> {
  const result = await apiFetch(
    `/api/staff/settlement/${region}/payout-proposals`,
    payoutProposalListSchema,
  );
  if (result.ok) return result.data;
  if (result.error.kind === "http" && result.error.status === 403) return [];
  throw new Error(`Could not load payout proposals: ${result.error.message}`);
}
