import { interestTagsSchema } from "@yourtal/contracts/interest/tags";
import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { audienceSchema } from "@yourtal/contracts/campaign";
import { campaignChapterSchema } from "@yourtal/contracts/campaign/chapter";
import { contentCategorySchema } from "@yourtal/jurisdiction/content-category";
import {
  MAX_DISTRICT_LENGTH,
  MAX_TARGET_DISTRICTS,
  cleanTargetDistricts,
  normaliseDistrict,
} from "@yourtal/contracts/campaign/target-districts";

/** TASKS.md 7.3.a: a patch. Every field optional; `chapters`/`declaredInterests` replace the whole set when present. */
export const updateCampaignDraftSchema = z.object({
  title: z.string().min(1).max(140).optional(),
  synopsis: z.string().min(1).max(500).optional(),
  durationSeconds: z
    .number()
    .int()
    .positive()
    .max(3 * 60 * 60)
    .optional(),
  contentCategory: contentCategorySchema.optional(),
  audience: audienceSchema.optional(),
  startsAt: z.iso.datetime({ offset: true }).optional(),
  endsAt: z.iso.datetime({ offset: true }).optional(),
  openViewing: z.boolean().optional(),
  teaserStartSeconds: z.number().int().min(0).optional(),
  posterFrameSeconds: z.number().int().min(0).nullable().optional(),
  declaredInterests: interestTagsSchema.optional(),
  chapters: z.array(campaignChapterSchema).optional(),
  captionsUrl: z.url().nullable().optional(),
  /** 14.2: replaces the whole set; normalised and de-duplicated. Empty is every district. */
  targetDistricts: z
    .array(z.string().transform(normaliseDistrict).pipe(z.string().min(1).max(MAX_DISTRICT_LENGTH)))
    .max(MAX_TARGET_DISTRICTS)
    .transform(cleanTargetDistricts)
    .optional(),
});

export type UpdateCampaignDraftRequest = z.infer<typeof updateCampaignDraftSchema>;

export class UpdateCampaignDraftDto extends createZodDto(updateCampaignDraftSchema) {}
