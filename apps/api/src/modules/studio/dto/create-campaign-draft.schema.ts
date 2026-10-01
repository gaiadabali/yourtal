import { interestTagsSchema } from "@yourtal/contracts/interest/tags";
import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { campaignKindSchema, audienceSchema } from "@yourtal/contracts/campaign";
import { contentCategorySchema } from "@yourtal/jurisdiction/content-category";

/** TASKS.md 7.3.a. `region`/`currency`/`merchantName` are never client fields — the business's own row decides them, same reasoning `create-business.schema.ts` documents for `currency`. */
export const createCampaignDraftSchema = z
  .object({
    kind: campaignKindSchema,
    title: z.string().min(1).max(140),
    synopsis: z.string().min(1).max(500),
    durationSeconds: z
      .number()
      .int()
      .positive()
      .max(3 * 60 * 60),
    contentCategory: contentCategorySchema,
    audience: audienceSchema,
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    /** F8: off by default; only an all_ages campaign may opt in — checked in the use-case, not here (needs the resolved audience). */
    openViewing: z.boolean().default(false),
    teaserStartSeconds: z.number().int().min(0).default(0),
    declaredInterests: interestTagsSchema.default([]),
  })
  .refine((draft) => draft.kind !== "quick" || draft.durationSeconds <= 60, {
    // 13.9.d: a 400 here, not the database CHECK's 503.
    message: "A Short must be 60 seconds or less.",
    path: ["durationSeconds"],
  });

export type CreateCampaignDraftRequest = z.infer<typeof createCampaignDraftSchema>;

export class CreateCampaignDraftDto extends createZodDto(createCampaignDraftSchema) {}
