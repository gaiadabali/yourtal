import { z } from "zod";
import { isFullyWatched, type CoverageInterval } from "./watch-coverage";

/**
 * A viewer's attempt at a campaign. YT-0120.
 *
 * ## Server-side, so resuming is a property of the account
 *
 * The position lives here rather than in the browser. `localStorage` resume
 * is per-device by construction: start on a phone, finish on a laptop, and a
 * client-side model has to either lose the progress or trust whatever the
 * second device claims. Under O-1 that is not a convenience question —
 * losing coverage means losing the entire reward, because there is no
 * partial credit to fall back on.
 *
 * ## One reward-bearing session per user at a time
 *
 * Not one per campaign. A viewer with five campaigns open in five tabs is
 * either confused or farming, and the honest reading is that a person
 * watches one thing at a time. Starting a new session supersedes the old
 * one rather than refusing — refusing would strand somebody who closed a tab
 * and came back, and `superseded` keeps the abandoned attempt's coverage as
 * evidence instead of deleting it.
 *
 * The uniqueness is enforced by a partial unique index on the user, not by a
 * check in a service. Two concurrent requests both reading "no active
 * session" and both inserting is the ordinary race, and only the database
 * can settle it.
 *
 * ## Campaign-level expiry, not session-level
 *
 * A session has no TTL of its own. It stays resumable for as long as the
 * campaign is live, which is what a viewer expects: nothing about walking
 * away for two days should forfeit a reward if the campaign is still
 * running. What ends it is the campaign ending — and that is checked at
 * completion rather than by a sweep, so a session whose campaign ended
 * mid-watch fails at the point it tries to claim, with a reason, rather than
 * vanishing while somebody is watching it.
 */
export const watchSessionStateSchema = z.enum([
  /** In progress, and the one session this user is earning against. */
  "active",
  /** Full coverage reached and the questions answered. Terminal. */
  "completed",
  /** The user started another session. Kept, not deleted — it is evidence. */
  "superseded",
  /** Refused for fraud or an ended campaign. Terminal, and never pays. */
  "void",
]);

export type WatchSessionState = z.infer<typeof watchSessionStateSchema>;

export const watchSessionSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  campaignId: z.uuid(),
  /**
   * The terms version this viewer entered under (YT-0101). The whole reason
   * terms are versioned: an advertiser editing a live campaign cannot change
   * what someone already watching is owed.
   */
  termsVersion: z.number().int().positive(),
  state: watchSessionStateSchema,
  startedAt: z.iso.datetime(),
  /** Server clock at the last ACCEPTED progress report. Drives the rate check. */
  lastProgressAt: z.iso.datetime(),
  /** Set once, when coverage completes and the questions are answered. */
  completedAt: z.iso.datetime().nullable(),
});

export type WatchSession = z.infer<typeof watchSessionSchema>;

export type CompletionRefusal =
  | { readonly kind: "not_active"; readonly state: WatchSessionState }
  | { readonly kind: "coverage_incomplete"; readonly uncoveredSeconds: number }
  | { readonly kind: "questions_unanswered" }
  | { readonly kind: "campaign_not_live" };

export interface CompletionCheck {
  readonly session: WatchSession;
  readonly coverage: readonly CoverageInterval[];
  readonly durationSeconds: number;
  /** Every question required by the terms has an answer recorded. */
  readonly questionsAnswered: boolean;
  /** The campaign is still in a state that can pay. */
  readonly campaignIsLive: boolean;
}

/**
 * Whether this session has earned its reward.
 *
 * Both halves of O-1, in the order that produces the most useful refusal:
 * coverage first, because "you have 47 seconds left" is actionable and
 * "answer the questions" is not, when the questions are not offered yet.
 *
 * **There is no terminal event in this function, deliberately.** It does not
 * ask whether playback `ended`, whether the playhead reached the duration,
 * or whether the client said it finished. It asks what was watched. Risk 43
 * records a player spec that asserted seeking to the end completes a
 * campaign, green only because Chrome declines to fire `ended` on a seek —
 * a browser's incidental behaviour was the only thing standing between that
 * test and the hole. A function that counts seconds cannot be talked into
 * it, because `dispatchEvent(new Event("ended"))` produces no coverage.
 */
export function judgeCompletion(check: CompletionCheck): CompletionRefusal | "earned" {
  if (check.session.state !== "active") {
    return { kind: "not_active", state: check.session.state };
  }
  if (!check.campaignIsLive) {
    // Checked at claim time rather than by a sweep, so a viewer learns why
    // instead of finding the session gone.
    return { kind: "campaign_not_live" };
  }
  if (!isFullyWatched(check.coverage, check.durationSeconds)) {
    return {
      kind: "coverage_incomplete",
      uncoveredSeconds: uncoveredTotal(check.coverage, check.durationSeconds),
    };
  }
  if (!check.questionsAnswered) {
    return { kind: "questions_unanswered" };
  }
  return "earned";
}

function uncoveredTotal(coverage: readonly CoverageInterval[], durationSeconds: number): number {
  let covered = 0;
  for (const interval of coverage) {
    covered += Math.max(
      0,
      Math.min(interval.toSecond, durationSeconds) - Math.max(interval.fromSecond, 0),
    );
  }
  return Math.max(0, durationSeconds - covered);
}

export function describeCompletionRefusal(refusal: CompletionRefusal): string {
  switch (refusal.kind) {
    case "not_active":
      return `This session is ${refusal.state} and cannot be completed.`;
    case "coverage_incomplete":
      return `${String(refusal.uncoveredSeconds)}s of the video have not been watched yet.`;
    case "questions_unanswered":
      return "The video is fully watched; the questions still need answering.";
    case "campaign_not_live":
      return "This campaign is no longer running, so it can no longer pay out.";
  }
}
