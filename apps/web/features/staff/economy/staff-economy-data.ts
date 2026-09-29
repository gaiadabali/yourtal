import "server-only";
import { forbidden } from "next/navigation";
import {
  economyOverviewSchema,
  economyProposalSchema,
  rateScreenSchema,
  settingsScreenSchema,
  type EconomyOverview,
  type EconomyProposal,
  type RateScreen,
  type SettingsScreen,
} from "@yourtal/contracts/staff/economy";
import { killSwitchSchema, type KillSwitch } from "@yourtal/contracts/voucher-internal/kill-switch";
import { z } from "zod";
import type { ApiError } from "@/lib/api/api-fetch";
import { apiFetch } from "@/lib/api/api-fetch";

/**
 * TASKS.md 9.5: the staff console's economy screens -- reads only. Mutations
 * are in `staff-economy-actions.ts`. Same `forbidden()` boundary every other
 * Phase 9 data module follows (9.4's `staff-users-data.ts`): a role Cerbos
 * refuses on `view`/`view_setting` gets a real 403 here, not a 500.
 */
function throwOrForbid(action: string, error: ApiError): never {
  if (error.kind === "http" && error.status === 403) forbidden();
  throw new Error(`Could not ${action}: ${error.message}`);
}

export async function getEconomyOverview(region: "AU" | "ID"): Promise<EconomyOverview> {
  const result = await apiFetch(`/api/staff/economy/${region}/overview`, economyOverviewSchema);
  if (!result.ok) throwOrForbid("load the economy overview", result.error);
  return result.data;
}

/** `null` when the caller cannot see the rate screen at all (ops) -- the page renders that as "not available" rather than a hard 403 crash, since the zone itself is visible to both roles. */
export async function getRateScreen(region: "AU" | "ID"): Promise<RateScreen | null> {
  const result = await apiFetch(`/api/staff/economy/${region}/rate`, rateScreenSchema);
  if (result.ok) return result.data;
  if (result.error.kind === "http" && result.error.status === 403) return null;
  throw new Error(`Could not load the rate screen: ${result.error.message}`);
}

const economyProposalListSchema = z.array(economyProposalSchema);

/** `[]` on a 403 -- same reasoning as `getKillSwitches`: ops shares this page and has no `ledger_adjustment.view` rule. */
export async function getMarketingFundings(
  region: "AU" | "ID",
): Promise<readonly EconomyProposal[]> {
  const result = await apiFetch(
    `/api/staff/economy/${region}/marketing-fundings`,
    economyProposalListSchema,
  );
  if (result.ok) return result.data;
  if (result.error.kind === "http" && result.error.status === 403) return [];
  throw new Error(`Could not load marketing fundings: ${result.error.message}`);
}

/**
 * `[]` on a 403 (ops only, `platform_setting.view` -- finance has no ALLOW
 * rule for it at all) rather than `forbidden()`: this shares a page with
 * marketing funding, which finance CAN see, so a finance-only viewer must
 * still get that page, just with an empty kill-switch section -- same
 * tolerance `getRateScreen` gives ops on the rate screen.
 */
export async function getKillSwitches(): Promise<readonly KillSwitch[]> {
  const result = await apiFetch("/api/staff/economy/kill-switches", z.array(killSwitchSchema));
  if (result.ok) return result.data;
  if (result.error.kind === "http" && result.error.status === 403) return [];
  throw new Error(`Could not load kill switches: ${result.error.message}`);
}

export async function getSettingsScreen(region: "AU" | "ID"): Promise<SettingsScreen> {
  const result = await apiFetch(`/api/staff/economy/${region}/settings`, settingsScreenSchema);
  if (!result.ok) throwOrForbid("load region settings", result.error);
  return result.data;
}
