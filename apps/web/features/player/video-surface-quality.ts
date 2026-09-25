/**
 * VideoSurface's own quality ladder. Deliberately NOT `quality-tier.ts`
 * (360/480/720p, `DEFAULT_QUALITY_TIER_ID: "480p"`) — that ladder backs
 * `video-player.tsx` and `QualitySelector`, both of which this ticket must
 * not change the behaviour of (TASKS.md 3.5.b). VideoSurface's own default
 * split is 360/540p (docs/08-web-app-and-performance.md §3.3: "start at
 * 360-480p on cellular"; TASKS.md 3.5.b is more specific — 540p off
 * cellular), capped at 720p either way.
 */
export type VideoSurfaceQualityId = "360p" | "540p" | "720p";

export interface VideoSurfaceQualityTier {
  readonly id: VideoSurfaceQualityId;
  readonly label: string;
  readonly resolutionHeight: number;
}

export const VIDEO_SURFACE_QUALITY_TIERS: readonly VideoSurfaceQualityTier[] = [
  { id: "360p", label: "360p", resolutionHeight: 360 },
  { id: "540p", label: "540p", resolutionHeight: 540 },
  { id: "720p", label: "720p", resolutionHeight: 720 },
];

/** Never let ABR (or this component) climb past this without an explicit viewer choice. */
export const MAX_AUTO_HEIGHT = 720;

export function getVideoSurfaceQualityTier(id: VideoSurfaceQualityId): VideoSurfaceQualityTier {
  const found = VIDEO_SURFACE_QUALITY_TIERS.find((tier) => tier.id === id);
  if (!found) {
    // VideoSurfaceQualityId is a closed union matching this table's own ids
    // exactly (asserted in video-surface-quality.test.ts) — unreachable in
    // practice, kept only so the return type stays non-nullable.
    throw new Error(`Unknown video surface quality: ${id}`);
  }
  return found;
}

/** TASKS.md 3.5.b: "starts at 360p on cellular and 540p otherwise". */
export function defaultVideoSurfaceQualityId(isCellular: boolean): VideoSurfaceQualityId {
  return isCellular ? "360p" : "540p";
}
