/**
 * A chapter is a segment of a long-form campaign's video with its own
 * reward checkpoint (docs/06-longform-video-and-attention.md §3, §5).
 *
 * KNOWN GAP — flag for a follow-up ticket: `packages/contracts`'
 * `campaignSchema` (packages/contracts/src/campaign/campaign.ts) has no
 * chapter field. Chapters were explicitly out of scope for YT-0403 (the
 * mock data layer). This type is therefore local to `apps/web`, not a
 * `packages/contracts` schema, and is never parsed from an external
 * boundary — it is derived, in-process, from a `Campaign` that IS already
 * Zod-validated (see `derive-chapters.ts`). It should move into
 * `packages/contracts/src/campaign/` once a real backend produces
 * per-campaign chapter data (encode-time scene detection, per
 * docs/06 §6's ingest pipeline), at which point this becomes a Zod schema
 * like every other contracts type instead of a plain TS interface.
 */
export interface Chapter {
  readonly index: number;
  readonly label: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  /** Points released at this chapter's checkpoint. Plain number, not the
   * branded `Points` type — see derive-chapters.ts for why. */
  readonly rewardPoints: number;
}
