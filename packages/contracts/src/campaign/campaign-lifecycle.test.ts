import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_LIFECYCLE_STATES,
  CAMPAIGN_LIFECYCLE_TRANSITIONS,
  PUBLIC_STATUSES,
  canTransition,
  isPubliclyVisible,
  publicStatusOf,
  refuseTransition,
} from "./campaign-lifecycle";

/**
 * The lifecycle, including every move it must refuse. YT-0101.
 *
 * A transition table that has only ever been asked about legal moves has not
 * been shown to refuse anything, so the exhaustive pair test below is the
 * point of this file rather than a completeness flourish.
 */

describe("the transition table", () => {
  it("covers every state", () => {
    expect(Object.keys(CAMPAIGN_LIFECYCLE_TRANSITIONS).sort()).toStrictEqual(
      [...CAMPAIGN_LIFECYCLE_STATES].sort(),
    );
  });

  it("only ever names states that exist", () => {
    for (const [from, targets] of Object.entries(CAMPAIGN_LIFECYCLE_TRANSITIONS)) {
      for (const target of targets) {
        expect(CAMPAIGN_LIFECYCLE_STATES, `${from} -> ${target}`).toContain(target);
      }
    }
  });

  it("never lets a state transition to itself", () => {
    // A self-transition is either a no-op dressed as a change or a bug that
    // resets something. Either way the caller should not be asking.
    for (const state of CAMPAIGN_LIFECYCLE_STATES) {
      expect(canTransition(state, state), `${state} -> ${state}`).toBe(false);
    }
  });
});

/**
 * Every ordered pair, stated explicitly. Written out rather than derived
 * from the table, because deriving the expectation from the thing under test
 * is how a test comes to assert only that the code equals itself — the
 * mistake `openapi:go:check` made.
 */
const LEGAL_PAIRS = new Set([
  "draft->in_review",
  "in_review->live",
  "in_review->rejected",
  "in_review->draft",
  "rejected->draft",
  "live->paused",
  "live->ended",
  "paused->live",
  "paused->ended",
]);

describe("every ordered pair of states", () => {
  const pairs = CAMPAIGN_LIFECYCLE_STATES.flatMap((from) =>
    CAMPAIGN_LIFECYCLE_STATES.map((to) => ({ from, to })),
  );

  it.each(pairs)("$from -> $to", ({ from, to }) => {
    expect(canTransition(from, to)).toBe(LEGAL_PAIRS.has(`${from}->${to}`));
  });
});

describe("the refusals that matter most", () => {
  it("refuses draft straight to live, so review cannot be skipped", () => {
    // A campaign that can publish itself makes review advisory, and an
    // advisory review is one a determined advertiser routes around.
    expect(canTransition("draft", "live")).toBe(false);
    expect(refuseTransition("draft", "live").reason).toContain("in_review");
  });

  it("refuses rejected straight to live", () => {
    // Rejection must be answered by an edit, not by a second state write.
    expect(canTransition("rejected", "live")).toBe(false);
    expect(canTransition("rejected", "draft")).toBe(true);
  });

  it("refuses everything out of ended", () => {
    // Re-opening a finished campaign would change what was promised to
    // people who already watched it.
    for (const to of CAMPAIGN_LIFECYCLE_STATES) {
      expect(canTransition("ended", to), `ended -> ${to}`).toBe(false);
    }
    expect(refuseTransition("ended", "live").reason).toContain("historical record");
  });

  it("explains a refusal by naming what IS allowed", () => {
    const refusal = refuseTransition("live", "draft");
    expect(refusal.reason).toContain('"paused"');
    expect(refusal.reason).toContain('"ended"');
  });
});

describe("the public status derived from an authoring state", () => {
  it("hides everything before review has passed", () => {
    // `undefined`, never a default. A default would let a draft appear on
    // the board as a finished campaign: both a disclosure of unpublished
    // work and a lie about its state.
    expect(publicStatusOf("draft")).toBeUndefined();
    expect(publicStatusOf("in_review")).toBeUndefined();
    expect(publicStatusOf("rejected")).toBeUndefined();
  });

  it("maps the visible states onto the viewer-facing contract", () => {
    expect(publicStatusOf("live")).toBe("active");
    expect(publicStatusOf("paused")).toBe("paused");
    expect(publicStatusOf("ended")).toBe("ended");
  });

  it("reaches every public status the viewer contract defines", () => {
    // A public status no authoring state produces is one a campaign can
    // never actually be in — a dead branch in every consumer that handles it.
    const produced = new Set(
      CAMPAIGN_LIFECYCLE_STATES.map(publicStatusOf).filter((status) => status !== undefined),
    );
    expect([...produced].sort()).toStrictEqual([...PUBLIC_STATUSES].sort());
  });

  it("agrees with isPubliclyVisible in both directions", () => {
    for (const state of CAMPAIGN_LIFECYCLE_STATES) {
      expect(isPubliclyVisible(state), state).toBe(publicStatusOf(state) !== undefined);
    }
  });
});
