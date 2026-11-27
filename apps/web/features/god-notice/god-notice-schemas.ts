import * as z from "zod";

/** `GET /api/me/god-consent` (god/TASKS.md 9.1): the caller's own GOD Group Privacy Notice decision. */
export const godConsentStatusSchema = z.object({
  notice: z.object({
    id: z.string(),
    version: z.string(),
    effectiveFrom: z.string(),
    url: z.url(),
    teensUrl: z.url(),
  }),
  ageBand: z.enum(["adult", "teen"]),
  current: z
    .object({
      noticeVersion: z.string(),
      decision: z.enum(["accepted", "declined", "withdrawn"]),
      method: z.enum(["registration", "next_sign_in", "guardian", "request"]),
      track: z.enum(["adult", "teen"]),
      decidedAt: z.string(),
    })
    .nullable(),
  ask: z.boolean(),
  inGod: z.boolean(),
});
export type GodConsentStatus = z.infer<typeof godConsentStatusSchema>;
