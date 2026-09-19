/**
 * The quality ladder for the player's quality selector.
 *
 * docs/06-longform-video-and-attention.md §2.3 rule 1: "Default to
 * 360–480p. Cap at 720p. Let the user opt up explicitly; never let ABR
 * climb on its own to 1080p on cellular." docs/08-web-app-and-performance.md
 * §3.3 repeats the cap at 720p.
 *
 * `targetBitrateKbps` per tier is an engineering constant for a typical
 * H.264 encode at that resolution, not an invented number: 480p's 800 kbps
 * is the exact figure docs/06 §2.3's own data-cost table uses (its 15-minute
 * row: "90 MB" — `estimateDataCostMb(800, 900)` below reproduces that almost
 * exactly, see quality-tier.test.ts). The MB estimate for every option is
 * always computed from this bitrate and the *current* campaign's own
 * duration — never a hardcoded, one-size-fits-all number.
 */
export type QualityTierId = "360p" | "480p" | "720p";

export interface QualityTier {
  readonly id: QualityTierId;
  readonly label: string;
  readonly resolutionHeight: number;
  readonly targetBitrateKbps: number;
}

export const QUALITY_TIERS: readonly QualityTier[] = [
  { id: "360p", label: "360p", resolutionHeight: 360, targetBitrateKbps: 500 },
  { id: "480p", label: "480p", resolutionHeight: 480, targetBitrateKbps: 800 },
  { id: "720p", label: "720p", resolutionHeight: 720, targetBitrateKbps: 1_500 },
];

/** Defaults to the higher end of the 360–480p band the docs require. */
export const DEFAULT_QUALITY_TIER_ID: QualityTierId = "480p";

export function getQualityTier(id: QualityTierId): QualityTier {
  const found = QUALITY_TIERS.find((tier) => tier.id === id);
  if (!found) {
    // QualityTierId is a closed union matching QUALITY_TIERS' own ids
    // exactly (asserted in quality-tier.test.ts), so this is unreachable —
    // the throw exists only so the return type stays non-nullable without
    // an unchecked `!` assertion (docs/13b-typescript-standards.md §2).
    throw new Error(`Unknown quality tier: ${id}`);
  }
  return found;
}

/** MB = kbps * seconds / 8 (bits->bytes) / 1024 (KB->MB). The exact arithmetic docs/06 §2.3 uses. */
export function estimateDataCostMb(bitrateKbps: number, durationSeconds: number): number {
  return (bitrateKbps * durationSeconds) / 8 / 1_024;
}

export interface QualityOption extends QualityTier {
  readonly estimatedMb: number;
}

/** Builds the full option list with each tier's own MB estimate for THIS video's duration. */
export function buildQualityOptions(durationSeconds: number): QualityOption[] {
  return QUALITY_TIERS.map((tier) => ({
    ...tier,
    estimatedMb: estimateDataCostMb(tier.targetBitrateKbps, durationSeconds),
  }));
}
