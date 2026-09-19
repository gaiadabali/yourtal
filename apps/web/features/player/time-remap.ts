/**
 * Placeholder-asset time remap.
 *
 * Phase U has no real per-campaign video encode — see video-source.ts's
 * "KNOWN GAP" note. Every campaign currently plays the same shared public
 * HLS test asset, whose real runtime has nothing to do with any given
 * campaign's advertised `durationSeconds`. Playing it back at its own real
 * length would show a seek bar, chapter markers and time display that
 * silently disagree with the duration the entry card (YT-0411) already
 * promised the user — the opposite of the honesty this whole ticket is
 * about.
 *
 * These two pure functions remap between "real seconds into the placeholder
 * asset" and "virtual seconds into the campaign's advertised timeline", so
 * everything shown to the user stays consistent with the campaign's stated
 * duration. Delete this file the moment real per-campaign assets exist —
 * at that point `campaign.durationSeconds` equals the asset's own duration
 * and both functions become the identity function.
 */
export function toVirtualSeconds(realSeconds: number, realDurationSeconds: number, campaignDurationSeconds: number): number {
  if (realDurationSeconds <= 0) {
    return 0;
  }
  return (realSeconds / realDurationSeconds) * campaignDurationSeconds;
}

export function toRealSeconds(virtualSeconds: number, realDurationSeconds: number, campaignDurationSeconds: number): number {
  if (campaignDurationSeconds <= 0) {
    return 0;
  }
  return (virtualSeconds / campaignDurationSeconds) * realDurationSeconds;
}
