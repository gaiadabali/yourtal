import { z } from "zod";
import { campaignStatusSchema, type CampaignStatus } from "./campaign";

/**
 * A campaign's authoring lifecycle. YT-0101.
 *
 * ## Two enums, on purpose, with one deriving from the other
 *
 * `campaignSchema.status` is `active | paused | ended` — what a **viewer**
 * sees on the Earn board. It has no way to say "draft", and it should not:
 * a draft campaign is not a campaign a viewer can hold an opinion about.
 *
 * This enum is the **authoring** state, which the advertiser console owns.
 * `publicStatusOf` below derives one from the other, and that derivation is
 * the whole reason two enums are safe here. Without it they would be two
 * copies of one fact, which is the shape this codebase keeps finding
 * expensive; with it, "is this visible to viewers?" has exactly one answer
 * and it lives in one function.
 *
 * ## The set is the union of two incomplete ones
 *
 * YT-0101's own criterion says *"draft/review/live/paused/ended"*.
 * `apps/web`'s `campaign-draft-status.ts` — written first, and which
 * explicitly flagged this decision to the architect — says *"draft,
 * in_review, live, paused, rejected"*.
 *
 * **Neither list is complete, and the difference is not cosmetic.**
 * `rejected` means review said no and it never ran; `ended` means it ran and
 * finished. Those are different facts about a campaign, they lead to
 * different next actions, and a model carrying only one of them has to lie
 * about the other. So the set below carries both.
 *
 * ## Why transitions are enumerated rather than validated ad hoc
 *
 * A campaign's state controls whether money can be spent against it.
 * "Anything can become live if the code that sets it says so" is how a
 * rejected campaign goes live, and the review step becomes advisory. The
 * legal moves are a table, the table is exported, and
 * `campaign-lifecycle.test.ts` checks every pair — including every pair that
 * must be refused, because a transition table nobody has seen reject
 * anything has not been shown to work.
 */
export const CAMPAIGN_LIFECYCLE_STATES = [
  "draft",
  "in_review",
  "rejected",
  "live",
  "paused",
  "ended",
] as const;

export const campaignLifecycleStateSchema = z.enum(CAMPAIGN_LIFECYCLE_STATES);
export type CampaignLifecycleState = z.infer<typeof campaignLifecycleStateSchema>;

/**
 * Every legal move. A state's absence from a list is a refusal, not an
 * oversight — see the notes on the entries that look surprising.
 */
export const CAMPAIGN_LIFECYCLE_TRANSITIONS: Record<
  CampaignLifecycleState,
  readonly CampaignLifecycleState[]
> = {
  // An advertiser edits freely until they submit.
  draft: ["in_review"],
  // Review is the only way in to `live`. There is deliberately no
  // `draft -> live`: a campaign that can publish itself makes the review
  // step advisory, and the point of review is that it is not.
  in_review: ["live", "rejected", "draft"],
  // Rejection is not terminal — the advertiser fixes it and resubmits — but
  // it must go back through `draft`, so a rejected campaign cannot be nudged
  // straight to `live` by a single state write.
  rejected: ["draft"],
  live: ["paused", "ended"],
  // A paused campaign resumes without re-review, because pausing is an
  // operational act and nothing about the creative changed. Editing a live
  // campaign is a different operation and is what forces a new terms
  // version (see `campaign-terms.ts`).
  paused: ["live", "ended"],
  // Terminal. A finished campaign is a historical record: re-opening one
  // would change what was promised to people who already watched it, and
  // the honest way to run it again is a new campaign.
  ended: [],
};

export function canTransition(from: CampaignLifecycleState, to: CampaignLifecycleState): boolean {
  return CAMPAIGN_LIFECYCLE_TRANSITIONS[from].some((allowed) => allowed === to);
}

export interface TransitionRefusal {
  readonly from: CampaignLifecycleState;
  readonly to: CampaignLifecycleState;
  readonly reason: string;
}

export function refuseTransition(
  from: CampaignLifecycleState,
  to: CampaignLifecycleState,
): TransitionRefusal {
  const allowed = CAMPAIGN_LIFECYCLE_TRANSITIONS[from];
  return {
    from,
    to,
    reason:
      allowed.length === 0
        ? `A campaign that has ended is a historical record and cannot move to "${to}". Run a new campaign instead.`
        : `A campaign in "${from}" can only move to ${allowed.map((state) => `"${state}"`).join(" or ")}, not "${to}".`,
  };
}

/**
 * States in which a campaign is visible to viewers at all.
 *
 * `live` and `paused` are both visible: a paused campaign that vanished
 * mid-watch would strand anyone already watching it, and `ended` stays
 * visible so a wallet entry can still name what it came from.
 */
export function isPubliclyVisible(state: CampaignLifecycleState): boolean {
  return state === "live" || state === "paused" || state === "ended";
}

/**
 * The viewer-facing status for an authoring state, or `undefined` when the
 * campaign is not visible at all.
 *
 * Returning `undefined` rather than defaulting to `ended` is deliberate. A
 * default would let a draft leak onto the board as a finished campaign,
 * which is both a disclosure of unpublished work and a lie about its state;
 * an absent value forces the caller to decide what to do with a campaign
 * that has no public form, which is the only correct answer.
 */
export function publicStatusOf(state: CampaignLifecycleState): CampaignStatus | undefined {
  switch (state) {
    case "live":
      return "active";
    case "paused":
      return "paused";
    case "ended":
      return "ended";
    case "draft":
    case "in_review":
    case "rejected":
      return undefined;
  }
}

/** Every public status must be reachable; guarded by the lifecycle test. */
export const PUBLIC_STATUSES = campaignStatusSchema.options;
