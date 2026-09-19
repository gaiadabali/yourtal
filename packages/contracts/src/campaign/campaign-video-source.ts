import { z } from "zod";

/**
 * Where the player finds a campaign's video, without guessing (YT-0503).
 *
 * `campaignSchema` had no such field at all: Phase U's player pointed every
 * single campaign at one shared, publicly hosted HLS reference stream
 * (`apps/web/features/player/video-source.ts`'s `MOCK_HLS_MANIFEST_URL`)
 * because there was nowhere real to read a URL from. A discriminated union
 * of one member today, `hls`, matching docs/02's ABR-encode pipeline and
 * YT-0526's HLS fixture — additive to extend later (a raw `mp4` fallback,
 * say) without breaking the `hls` shape already in use.
 */
export const campaignVideoSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hls"), manifestUrl: z.url() }),
]);

export type CampaignVideoSource = z.infer<typeof campaignVideoSourceSchema>;
