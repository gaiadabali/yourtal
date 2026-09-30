import * as z from "zod";

/** `GET /api/watch/sessions`: the viewer's unfinished sessions (Continue watching, 11.4.c). */
export const continueWatchingResponseSchema = z.object({
  sessions: z.array(
    z.object({
      sessionId: z.uuid(),
      campaignId: z.uuid(),
      lastProgressAt: z.iso.datetime(),
      coveredSeconds: z.number().int().min(0),
      durationSeconds: z.number().int().positive(),
    }),
  ),
});
export type ContinueWatchingResponse = z.infer<typeof continueWatchingResponseSchema>;
