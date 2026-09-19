import { z } from "zod";
import { pointsSchema } from "../money/money";

/**
 * What a campaign is allowed to spend, and where the points come from.
 * YT-0101.
 *
 * ## "Draws from a funded point allocation and hard-stops at zero"
 *
 * The hard stop already exists and is not in TypeScript. `ledger.allocation`
 * (migration 0007) holds `remaining_points` with a
 * `CHECK (remaining_points >= 0)`, and drawdown is
 * `UPDATE ... WHERE remaining_points >= $n` — an exhausted allocation simply
 * matches no row. That is the real enforcement, in the value zone, owned by
 * the ledger role, and nothing in this file weakens or duplicates it.
 *
 * What is missing, and what this adds, is the **link**: a campaign that
 * names no allocation has nothing to hard-stop against. Until a campaign
 * points at an allocation, "hard-stops at zero" is a property of a table
 * nobody consults.
 *
 * ## Why the remaining balance is deliberately NOT stored here
 *
 * The tempting field is `remainingPoints`, so a console can render a budget
 * bar without asking the ledger. It would be a second copy of a number the
 * ledger owns, updated by a different process, and the two would disagree
 * the first time a grant landed between reads — with the copy being the one
 * shown to the advertiser.
 *
 * `docs/13`'s rule is to derive rather than store, and the derivation here
 * is a read against `ledger.allocation`. A campaign's config says *which*
 * allocation funds it and *how much of it* this campaign may use; how much
 * is left is always a question for the ledger.
 *
 * ## `maxPointsForCampaign` is a cap, not a reservation
 *
 * One allocation can fund several campaigns, so a per-campaign ceiling stops
 * one campaign draining a partner's whole block. It does **not** reserve
 * points: two campaigns sharing an allocation can still race it to zero, and
 * the ledger's conditional drawdown is what makes that safe rather than
 * corrupting. Calling it a reservation would promise an exclusivity nothing
 * enforces.
 */
export const campaignFunderTypeSchema = z.enum(["partner", "marketing"]);
export type CampaignFunderType = z.infer<typeof campaignFunderTypeSchema>;

export const campaignRewardConfigSchema = z
  .object({
    campaignId: z.uuid(),
    /** The `ledger.allocation` row funding this campaign. */
    allocationId: z.string().min(1),
    /**
     * Mirrors the allocation's own funder kind. Denormalised deliberately:
     * a partner-funded campaign and a marketing-funded one post to different
     * contra accounts, and the console must be able to show which without a
     * value-zone read on every list render.
     */
    funderType: campaignFunderTypeSchema,
    /** Ceiling for this campaign against a possibly shared allocation. */
    maxPointsForCampaign: pointsSchema,
    /** Per completion, under O-1. The base half of the reward. */
    rewardPointsPerCompletion: pointsSchema,
    /** Added once, at the end, when the scoring rule allows it (YT-0124). */
    accuracyBonusPoints: pointsSchema,
  })
  .refine((config) => config.rewardPointsPerCompletion > 0, {
    message: "A campaign that pays nothing on completion is not an earn campaign",
    path: ["rewardPointsPerCompletion"],
  })
  .refine(
    (config) =>
      config.rewardPointsPerCompletion + config.accuracyBonusPoints <= config.maxPointsForCampaign,
    {
      // A single completion that cannot fit inside the campaign's own
      // ceiling is a campaign that can never pay anybody — better to refuse
      // it at authoring than to discover it when the first viewer finishes.
      message:
        "One completion (reward plus bonus) must fit within maxPointsForCampaign, or the campaign can never pay out",
      path: ["maxPointsForCampaign"],
    },
  );

export type CampaignRewardConfig = z.infer<typeof campaignRewardConfigSchema>;

/**
 * The most a single viewer can earn from this campaign.
 *
 * Under O-1 the reward is one grant at completion, so this is the base plus
 * the bonus and nothing else — there is no per-chapter accrual to add up.
 */
export function maxPointsPerViewer(config: CampaignRewardConfig): number {
  return config.rewardPointsPerCompletion + config.accuracyBonusPoints;
}

/**
 * How many completions this campaign could still pay, given what the ledger
 * says is left.
 *
 * Takes `remainingAllocationPoints` as an argument rather than reading it,
 * because the ledger owns that number and this package must not pretend to.
 * The answer is a floor: a partially-affordable completion is not payable,
 * since O-1 makes the reward all or nothing.
 */
export function affordableCompletions(
  config: CampaignRewardConfig,
  remainingAllocationPoints: number,
): number {
  const perViewer = maxPointsPerViewer(config);
  if (perViewer <= 0) return 0;
  const withinCampaignCap = Math.floor(config.maxPointsForCampaign / perViewer);
  const withinAllocation = Math.floor(Math.max(0, remainingAllocationPoints) / perViewer);
  return Math.min(withinCampaignCap, withinAllocation);
}
