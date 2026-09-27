import { z } from "zod";
import { pointsSchema } from "../money/money";

/**
 * 7.6.a: a business's own per-campaign report -- aggregates only, never a
 * per-user row (red line 10). `suppressed: true` when the underlying
 * population is below the F12 cohort floor (10, teens 20) -- the Reports
 * zone's entire reason to exist as a SEPARATE surface from the ledger's own
 * per-grant rows.
 *
 * Open views (Open Viewing, anonymous, unauthenticated) are deliberately
 * NOT a field here: nothing in this codebase counts them yet (7.7/Open
 * Viewing's own view-tracking is a separate, not-yet-built piece), and a
 * placeholder `0` would misrepresent "not tracked" as "tracked and zero" --
 * see reports.module's own doc comment.
 */
export const campaignReportSuppressedSchema = z.object({
  campaignId: z.uuid(),
  suppressed: z.literal(true),
  /** The floor this campaign's audience needed to clear (10, or 20 for `teen`). */
  floor: z.number().int().positive(),
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
});
export type CampaignReport = z.infer<typeof campaignReportSchema>;

export const campaignReportResultSchema = z.discriminatedUnion("suppressed", [
  campaignReportSchema,
  campaignReportSuppressedSchema,
]);
export type CampaignReportResult = z.infer<typeof campaignReportResultSchema>;
