/**
 * A chapter is a segment of a long-form campaign's video, used for
 * progress display and seek navigation only.
 *
 * Superseded by decision O-1 (docs/16-decisions.md, 2026-09-20): the
 * reward is granted only if the user watches the FULL video AND answers
 * the checkpoint questions, all or nothing. `docs/06-longform-video-and-
 * attention.md` §3 and §5 described a per-chapter accrual checkpoint —
 * "own reward checkpoint" — that model is superseded; there is exactly one
 * checkpoint, at the end. `rewardPoints` below survives only as the input
 * to the back-loaded pacing curve (derive-chapters.ts) that decides how
 * much of the progress bar each chapter fills — it is never a discrete
 * grant and is deliberately not rendered as a per-chapter figure anywhere
 * (chapter-track.tsx).
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
  /** Pacing weight for the progress bar only — never a discrete grant.
   * Plain number, not the branded `Points` type — see derive-chapters.ts
   * for why. */
  readonly rewardPoints: number;
}
