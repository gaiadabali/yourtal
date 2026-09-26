import { z } from "zod";
import { regionSchema } from "@yourtal/contracts/region";
import { processingPurposeSchema } from "@yourtal/consent/purpose";
import { autoplaySettingSchema } from "@yourtal/contracts/me/autoplay-setting";

/**
 * Response shapes for the me-module endpoints this feature calls (5.4/5.5,
 * 6.7.a). Colocated here rather than in `apps/web/lib/api/**` (Area A's
 * directory — see TASKS.md "stay off their files") since these are B's own
 * module's contracts, not identity's; `me-response-schema.ts`'s sibling in
 * `lib/api` (`meResponseSchema`, the identity `Me` shape) is imported
 * as-is, never edited.
 */

export const consentEntrySchema = z.object({
  purpose: processingPurposeSchema,
  state: z.enum(["granted", "withdrawn"]),
  recordedAt: z.iso.datetime(),
});
export const consentsResponseSchema = z.object({ consents: z.array(consentEntrySchema) });
export type ConsentsResponse = z.infer<typeof consentsResponseSchema>;
export type ConsentEntry = z.infer<typeof consentEntrySchema>;

export const interestsResponseSchema = z.object({ nodeIds: z.array(z.string()) });
export type InterestsResponse = z.infer<typeof interestsResponseSchema>;

export const followEntrySchema = z.object({
  businessId: z.string(),
  region: regionSchema,
  displayName: z.string(),
  handle: z.string(),
  logoUrl: z.string().nullable(),
});
export const followsResponseSchema = z.object({ follows: z.array(followEntrySchema) });
export type FollowsResponse = z.infer<typeof followsResponseSchema>;
export type FollowEntry = z.infer<typeof followEntrySchema>;

export const notificationPreferencesResponseSchema = z.object({
  preferences: z.record(z.string(), z.boolean()),
});
export type NotificationPreferencesResponse = z.infer<
  typeof notificationPreferencesResponseSchema
>;

export const autoplayResponseSchema = z.object({ autoplay: autoplaySettingSchema });
export type AutoplayResponse = z.infer<typeof autoplayResponseSchema>;

export const linkCodeResponseSchema = z.object({
  code: z.string(),
  expiresAt: z.iso.datetime(),
});
export type LinkCodeResponse = z.infer<typeof linkCodeResponseSchema>;

export const dataExportResponseSchema = z
  .object({
    generatedAt: z.iso.datetime(),
  })
  // account.controller.ts's exportData composes several domains plus a
  // catalogue of what ELSE a full deletion would cover — this UI downloads
  // the whole body verbatim rather than re-declaring its every field.
  .loose();
export type DataExportResponse = z.infer<typeof dataExportResponseSchema>;
