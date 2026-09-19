/**
 * Builds the sign-up link an anonymous Open Viewing viewer follows
 * (YT-0432's "sign-up prompt at the point a rewarded viewer would have
 * been paid" + "returns the user to exactly where they were after
 * signup"). `returnTo` carries the user back to the real, rewarded watch
 * route for this exact campaign — threaded through every onboarding step
 * by `apps/web/features/onboarding/onboarding-return-to.ts` — and this
 * campaign's own watch progress is already sitting in the same
 * `resume-position.ts` localStorage entry the rewarded player reads,
 * written by the identical `useWatchSession` hook this feature reuses.
 * Together those two mechanisms are what "exactly where they were" means
 * here: same campaign, same on-screen state, and — if playback stopped
 * before the video ended — the same position.
 */
export function buildOpenViewSignupHref(campaignId: string): string {
  return `/onboarding?returnTo=${encodeURIComponent(`/watch/${campaignId}`)}`;
}
