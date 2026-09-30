import * as z from "zod";
import { pointsSchema } from "../money/money";

/**
 * 7.6.a: a business's own per-campaign report -- aggregates only, never a
 * per-user row (red line 10). `suppressed: true` when the underlying
 * population is below the F12 cohort floor (10, teens 20) -- the Reports
 * zone's entire reason to exist as a SEPARATE surface from the ledger's own
 * per-grant rows.
 *
 * 11.2.d: open views (Open Viewing, anonymous, unauthenticated —
 * `watch.open_view_session`, from 11.2.b) are their OWN metric,
 * independently suppressed below the SAME F12 cohort floor as everything
 * else here, and NEVER summed with `rewardedViews` — the two come from
 * disjoint populations (one claimable, one never claimable) with different
 * denominators, and folding them would answer no question a business
 * actually asked. `openViews` is `null` exactly when this campaign's own
 * open-view count has not itself cleared the floor — independent of
 * whether the rest of the report is `suppressed`, since a campaign can
 * clear one population's floor without the other's.
 */
export const campaignReportSuppressedSchema = z.object({
  campaignId: z.uuid(),
  suppressed: z.literal(true),
  /** The floor this campaign's audience needed to clear (10, or 20 for `teen`). */
  floor: z.number().int().positive(),
  /** `null` below the floor; see this file's header. Present even when the rest of the report is suppressed. */
  openViews: z.number().int().min(0).nullable(),
});
export type CampaignReportSuppressed = z.infer<typeof campaignReportSuppressedSchema>;

export const campaignReportSchema = z.object({
  campaignId: z.uuid(),
  suppressed: z.literal(false),
  /** Sessions on this campaign's own reward track -- never summed with open (anonymous) views. */
  rewardedViews: z.number().int().min(0),
  completions: z.number().int().min(0),
  completionRate: z.number().min(0).max(1),
  /** Average of (completedAt - startedAt) over completed sessions, in seconds. `null` with no completions yet. */
  averageWatchTimeSeconds: z.number().min(0).nullable(),
  /** SUM(times_correct) / SUM(times_asked) across this campaign's questions. `null` if none have been asked yet. */
  questionAccuracy: z.number().min(0).max(1).nullable(),
  pointsSpent: pointsSchema,
  /** docs/23 §1.0b: "your points bought N views and M of your own vouchers were redeemed." */
  merchantVouchersRedeemed: z.number().int().min(0),
  /** `null` below the floor; see this file's header. */
  openViews: z.number().int().min(0).nullable(),
});
export type CampaignReport = z.infer<typeof campaignReportSchema>;

export const campaignReportResultSchema = z.discriminatedUnion("suppressed", [
  campaignReportSchema,
  campaignReportSuppressedSchema,
]);
export type CampaignReportResult = z.infer<typeof campaignReportResultSchema>;
