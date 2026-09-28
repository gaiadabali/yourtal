import { z } from "zod";
import { audienceSchema, campaignKindSchema } from "@yourtal/contracts/campaign";
import { regionSchema } from "@yourtal/contracts/region";

/**
 * A restated Zod schema for `apps/api`'s `CampaignDraftController` response
 * shape (`apps/api/src/modules/studio/persistence/campaign-draft.repository.ts`'s
 * `CampaignDraft` interface, TASKS.md 7.3.a) — restated, not imported,
 * because a Next.js server component can only import from workspace
 * packages, never another app. `contentCategory` stays a plain non-empty
 * string rather than importing `@yourtal/jurisdiction`'s own enum: that
 * package is not an `apps/web` dependency, and this feature's editor has no
 * category picker yet for the enum to gate client-side anyway (see
 * `campaign-draft-live-mapping.ts`'s doc comment) — the real enum is
 * still enforced server-side on every write.
 */
export const apiCampaignDraftSchema = z.object({
  id: z.string(),
  businessId: z.string(),
  region: regionSchema,
  kind: campaignKindSchema,
  title: z.string(),
  synopsis: z.string(),
  durationSeconds: z.number(),
  contentCategory: z.string().min(1),
  audience: audienceSchema,
  lifecycleState: z.string(),
  rejectionReason: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  openViewing: z.boolean(),
  teaserStartSeconds: z.number(),
  posterFrameSeconds: z.number().nullable(),
  declaredInterests: z.array(z.string()),
  chapters: z.array(
    z.object({
      title: z.string(),
      startSeconds: z.number(),
      rewardWeight: z.number(),
    }),
  ),
  captionsUrl: z.string().nullable(),
  posterUrl: z.string().nullable(),
  teaserUrl: z.string().nullable(),
  hlsUrl: z.string().nullable(),
  rewardPoints: z.number().nullable(),
  questionCount: z.number().nullable(),
  scoringRule: z.enum(["base_only", "base_plus_accuracy_bonus"]).nullable(),
  publishedAt: z.string().nullable(),
});

export type ApiCampaignDraft = z.infer<typeof apiCampaignDraftSchema>;

/**
 * `SetRewardConfigResult` (`apps/api`'s `set-reward-config.use-case.ts`) —
 * the draft's own fields plus the server-priced value for one completion,
 * 7.3.h. `rewardValueMinor`/`currency` are nullable (F61): the reward config
 * itself always saves; the ledger valuation behind these two fields is
 * best-effort DISPLAY data for Studio's risk banner and never blocks or
 * half-commits the save if it fails — `campaign-reward-risk.ts`'s own
 * "ratio pending" state is exactly this `null` case.
 */
export const apiRewardConfigResultSchema = apiCampaignDraftSchema.extend({
  rewardValueMinor: z.number().nullable(),
  currency: z.string().nullable(),
});

export type ApiRewardConfigResult = z.infer<typeof apiRewardConfigResultSchema>;
