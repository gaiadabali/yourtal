import * as z from "zod";

/** 14.3.c: one active partner link, as Me → Linked apps lists it. */
export const linkedAppSchema = z.object({
  linkId: z.uuid(),
  /** The partner's id, such as `snap-app`; the web app maps it to a display name. */
  partnerId: z.string().min(1),
  linkedAt: z.iso.datetime(),
});
export type LinkedApp = z.infer<typeof linkedAppSchema>;

/** `GET /api/me/linked-apps`. */
export const linkedAppsResponseSchema = z.object({ linkedApps: z.array(linkedAppSchema) });
export type LinkedAppsResponse = z.infer<typeof linkedAppsResponseSchema>;

/** `DELETE /api/me/linked-apps/:linkId`. */
export const unlinkAppResponseSchema = z.object({ linkId: z.uuid(), unlinked: z.literal(true) });
export type UnlinkAppResponse = z.infer<typeof unlinkAppResponseSchema>;
